//! When to check for updates, and the guards around installing one. GUI-agnostic, so every
//! decision here is reachable from `cargo test` without the Tauri toolchain.
//!
//! One task, [`run_updates`], performs every feed check, one at a time: a launch check, then a
//! wake-up every [`WAKE_TICK`] that checks once [`CHECK_INTERVAL_SECS`] of wall-clock time have
//! passed since the last check that reached the feed, plus tray requests. A monotonic sleep stops
//! while the machine sleeps, so the persisted wall-clock time is what makes the cadence survive it.
//!
//! Release builds abort on panic, and crash recovery would turn a startup panic into a crash loop,
//! so this module denies the lints below. They cannot see panics inside library calls; the one
//! reachable here, a zero `tick` in [`run_updates`], is excluded by its contract.
#![deny(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::arithmetic_side_effects
)]

use std::convert::Infallible;
use std::future::Future;
use std::io::Read as _;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use semver::Version;
use serde::{Deserialize, Serialize};
use tokio::time::{Instant, MissedTickBehavior};

use crate::updater_state::CLOCK_SKEW_TOLERANCE_SECS;

/// Wall-clock gap between checks that reached the feed.
pub const CHECK_INTERVAL_SECS: u64 = 6 * 60 * 60;
/// How often the update task wakes to ask whether a check is due; bounds post-sleep latency.
pub const WAKE_TICK: Duration = Duration::from_secs(15 * 60);
/// Delay before the unconditional launch check.
pub const LAUNCH_DELAY: Duration = Duration::from_secs(5);
/// How long "Later" silences one version.
pub const SNOOZE_SECS: u64 = 24 * 60 * 60;
/// A download that delivers no bytes for this long is abandoned. Idle, never total, so a slow but
/// progressing link is never cut off.
pub const STALL_LIMIT: Duration = Duration::from_secs(60);
/// How often an automatic install re-samples the prover before installing.
pub const IDLE_POLL: Duration = Duration::from_secs(10);
/// An automatic install stops waiting for the prover after this, so continuous proving cannot
/// strand a user on an old build.
pub const IDLE_WAIT_CAP: Duration = Duration::from_secs(30 * 60);

const SCHEMA: u32 = 1;
const MAX_FILE_BYTES: usize = 4096;
/// Bounds how long "Later", which runs on the main thread, can wait on another process's write (a
/// stopped holder never releases). A write that times out fails, and the mirror carries the session.
const LOCK_WAIT: Duration = Duration::from_secs(1);
/// One byte past the cap, so an oversized file is detected rather than silently truncated.
const READ_LIMIT: u64 = 4097;

/// Is a check due? A broken clock (`now == 0`) or a last check dated beyond the skew tolerance
/// (the clock went back) makes one due, so bad time costs extra checks, never missing ones.
pub fn check_due(last_checked_at: Option<u64>, now: u64) -> bool {
    if now == 0 {
        return true;
    }
    match last_checked_at {
        None => true,
        Some(t) if t > now.saturating_add(CLOCK_SKEW_TOLERANCE_SECS) => true,
        Some(t) => now.saturating_sub(t) >= CHECK_INTERVAL_SECS,
    }
}

/// The last check to judge due-ness by. A file value beyond the skew tolerance is dropped, so an
/// unwritable future-dated file cannot force a check on every tick while the mirror holds a sane one.
pub fn effective_last_check(file: Option<u64>, mem: Option<u64>, now: u64) -> Option<u64> {
    let file = file.filter(|&t| t <= now.saturating_add(CLOCK_SKEW_TOLERANCE_SECS));
    match (file, mem) {
        (Some(f), Some(m)) => Some(f.max(m)),
        (f, m) => f.or(m),
    }
}

/// "Later" on one exact version (SemVer equality, build metadata included).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Snooze {
    pub version: Version,
    pub until: u64,
}

impl Snooze {
    /// A snooze for `version` lasting [`SNOOZE_SECS`] from `now`.
    pub fn starting(version: Version, now: u64) -> Self {
        Self {
            version,
            until: now.saturating_add(SNOOZE_SECS),
        }
    }
}

/// Does `snooze` silence `candidate` at `now`? A snooze reaching further than one snooze plus the
/// skew tolerance could not have been written by this clock, so it is void.
pub fn is_snoozed(snooze: Option<&Snooze>, candidate: &Version, now: u64) -> bool {
    snooze.is_some_and(|s| {
        s.version == *candidate
            && now < s.until
            && s.until
                <= now
                    .saturating_add(SNOOZE_SECS)
                    .saturating_add(CLOCK_SKEW_TOLERANCE_SECS)
    })
}

/// The persisted schedule. Every load failure yields the default, which means more checks and
/// prompts, never fewer.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ScheduleState {
    pub last_checked_at: Option<u64>,
    /// The app version whose check wrote `last_checked_at`.
    pub last_checked_by: Option<String>,
    pub snooze: Option<Snooze>,
}

/// Soft state: unknown fields are ignored rather than rejected.
#[derive(Serialize, Deserialize)]
struct FileV1 {
    schema: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    last_checked_at: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    last_checked_by: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    snooze: Option<FileSnooze>,
}

#[derive(Serialize, Deserialize)]
struct FileSnooze {
    version: String,
    until: u64,
}

/// Sole owner of the last-check time and the snooze: the file plus in-memory mirrors, so a failed
/// write still holds for the session. `writer` is the desktop app's version, injected because this
/// crate's own version is a 0.0.0 placeholder. A file timestamp written by another version is
/// ignored for due-ness, so two resident instances on different versions cannot postpone each
/// other's checks forever; the file's snooze applies to every version.
pub struct ScheduleStore {
    path: Option<PathBuf>,
    writer: String,
    write: Mutex<()>,
    mem_checked: Mutex<Option<u64>>,
    mem_snooze: Mutex<Option<Snooze>>,
    #[cfg(test)]
    fail_writes: AtomicBool,
    #[cfg(test)]
    between_read_and_write: Mutex<Option<Box<dyn Fn() + Send + Sync>>>,
}

impl ScheduleStore {
    /// `path: None` keeps everything in memory.
    pub fn new(path: Option<PathBuf>, writer: impl Into<String>) -> Self {
        Self {
            path,
            writer: writer.into(),
            write: Mutex::new(()),
            mem_checked: Mutex::new(None),
            mem_snooze: Mutex::new(None),
            #[cfg(test)]
            fail_writes: AtomicBool::new(false),
            #[cfg(test)]
            between_read_and_write: Mutex::new(None),
        }
    }

    /// The file's state; the default on any failure.
    pub fn load(&self) -> ScheduleState {
        self.path.as_deref().map(load_file).unwrap_or_default()
    }

    /// The last check this app version made, for [`check_due`].
    pub fn last_checked(&self, now: u64) -> Option<u64> {
        let file = self.load();
        let own = file
            .last_checked_at
            .filter(|_| file.last_checked_by.as_deref() == Some(self.writer.as_str()));
        effective_last_check(own, *self.mem_checked.lock(), now)
    }

    /// Records a check that reached the feed. The mirror is set before the write, and to `now`
    /// rather than to a maximum, so a mirror dated in the future by a since-corrected clock is
    /// replaced. `now == 0` is an unreadable clock and records nothing.
    pub fn record_checked(&self, now: u64) -> std::io::Result<()> {
        if now == 0 {
            return Ok(());
        }
        *self.mem_checked.lock() = Some(now);
        let writer = self.writer.clone();
        self.update(move |state| {
            state.last_checked_at = Some(now);
            state.last_checked_by = Some(writer);
        })
    }

    /// Records "Later"; the mirror applies for the session even if the write fails.
    pub fn record_snooze(&self, snooze: Snooze) -> std::io::Result<()> {
        *self.mem_snooze.lock() = Some(snooze.clone());
        self.update(move |state| state.snooze = Some(snooze))
    }

    /// When the snooze covering `candidate` ends, if one does. Either the file's snooze or this
    /// session's latest "Later" covers it, so an older, expired or other-version snooze on disk can
    /// never mask the one the user just gave.
    pub fn snoozed_until(&self, candidate: &Version, now: u64) -> Option<u64> {
        let mirror = self.mem_snooze.lock().clone();
        [mirror, self.load().snooze]
            .into_iter()
            .flatten()
            .filter(|s| is_snoozed(Some(s), candidate, now))
            .map(|s| s.until)
            .max()
    }

    pub fn is_snoozed(&self, candidate: &Version, now: u64) -> bool {
        self.snoozed_until(candidate, now).is_some()
    }

    /// Read-modify-write under an in-process mutex and a cross-process file lock, so a second
    /// resident instance cannot erase this one's field. The file lock is held for this one small
    /// write and never nested with another lock.
    fn update(&self, change: impl FnOnce(&mut ScheduleState)) -> std::io::Result<()> {
        let Some(path) = self.path.as_deref() else {
            return Ok(());
        };
        let _in_process = self.write.lock();
        // The lock file lives beside the schedule, so its directory must exist first.
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let _cross_process =
            crate::file_lock::lock_exclusive_within(&path.with_extension("json.lock"), LOCK_WAIT)?;
        let mut state = load_file(path);
        change(&mut state);
        #[cfg(test)]
        if let Some(hook) = self.between_read_and_write.lock().as_ref() {
            hook();
        }
        #[cfg(test)]
        if self.fail_writes.load(Ordering::SeqCst) {
            return Err(std::io::Error::other("test: schedule write failure"));
        }
        crate::updater_state::write_private_atomic(path, &encode(&state)?, ".update-schedule-")
    }
}

fn encode(state: &ScheduleState) -> std::io::Result<Vec<u8>> {
    Ok(serde_json::to_vec(&FileV1 {
        schema: SCHEMA,
        last_checked_at: state.last_checked_at,
        last_checked_by: state.last_checked_by.clone(),
        snooze: state.snooze.as_ref().map(|s| FileSnooze {
            version: s.version.to_string(),
            until: s.until,
        }),
    })?)
}

fn load_file(path: &Path) -> ScheduleState {
    let bytes = match read_capped(path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return ScheduleState::default(),
        Err(e) => {
            tracing::warn!(error = %e, path = %path.display(), "Ignoring unreadable update schedule");
            return ScheduleState::default();
        }
    };
    match decode(&bytes) {
        Some(state) => state,
        None => {
            tracing::warn!(path = %path.display(), "Ignoring malformed update schedule");
            ScheduleState::default()
        }
    }
}

/// Opens without blocking (a FIFO at the path would otherwise hang the update task), refuses
/// anything but a regular file on the opened handle, and reads at most [`MAX_FILE_BYTES`].
fn read_capped(path: &Path) -> std::io::Result<Vec<u8>> {
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;
        options.custom_flags(libc::O_NONBLOCK);
    }
    let file = options.open(path)?;
    if !file.metadata()?.is_file() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "not a regular file",
        ));
    }
    let mut bytes = Vec::new();
    file.take(READ_LIMIT).read_to_end(&mut bytes)?;
    if bytes.len() > MAX_FILE_BYTES {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "larger than 4 KiB",
        ));
    }
    Ok(bytes)
}

fn decode(bytes: &[u8]) -> Option<ScheduleState> {
    let file: FileV1 = serde_json::from_slice(bytes).ok()?;
    if file.schema != SCHEMA {
        return None;
    }
    let snooze = match file.snooze {
        None => None,
        Some(s) => Some(Snooze {
            version: parse_canonical(&s.version)?,
            until: s.until,
        }),
    };
    Some(ScheduleState {
        last_checked_at: file.last_checked_at,
        last_checked_by: file.last_checked_by,
        snooze,
    })
}

fn parse_canonical(s: &str) -> Option<Version> {
    Version::parse(s).ok().filter(|v| v.to_string() == s)
}

/// In-process install ownership, shared by the automatic install and the prompt's "Update Now".
/// `updater.lock` stays the cross-process authority.
#[derive(Debug, Default)]
pub struct InstallGate(AtomicBool);

/// Holding one means this process is installing; dropping it, including by cancelling the future
/// that owns it, frees the gate.
#[derive(Debug)]
pub struct InstallClaim(Arc<InstallGate>);

impl InstallGate {
    pub fn try_claim(self: &Arc<Self>) -> Option<InstallClaim> {
        self.0
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .ok()
            .map(|_| InstallClaim(Arc::clone(self)))
    }

    pub fn is_busy(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }
}

impl Drop for InstallClaim {
    fn drop(&mut self) {
        self.0 .0.store(false, Ordering::Release);
    }
}

/// Runs `fut` owning `claim`. The claim lives in the returned future, so dropping it at any point,
/// before its first poll included, releases the gate.
pub async fn run_claimed<F: Future>(claim: InstallClaim, fut: F) -> F::Output {
    let _claim = claim;
    fut.await
}

/// Download no-progress watchdog: the chunk callback calls [`StallWatch::touch`], and
/// [`StallWatch::stalled`] resolves once `limit` passes without one. `tokio::time` pauses while the
/// machine sleeps, so a download interrupted by sleep is judged on awake time.
#[derive(Debug)]
pub struct StallWatch {
    base: Instant,
    last_ms: AtomicU64,
}

impl Default for StallWatch {
    fn default() -> Self {
        Self::new()
    }
}

impl StallWatch {
    pub fn new() -> Self {
        Self {
            base: Instant::now(),
            last_ms: AtomicU64::new(0),
        }
    }

    pub fn touch(&self) {
        let elapsed = u64::try_from(self.base.elapsed().as_millis()).unwrap_or(u64::MAX);
        self.last_ms.fetch_max(elapsed, Ordering::Relaxed);
    }

    pub async fn stalled(&self, limit: Duration) {
        loop {
            let last = Duration::from_millis(self.last_ms.load(Ordering::Relaxed));
            let Some(deadline) = self
                .base
                .checked_add(last)
                .and_then(|t| t.checked_add(limit))
            else {
                return std::future::pending().await;
            };
            if Instant::now() >= deadline {
                return;
            }
            tokio::time::sleep_until(deadline).await;
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum IdleWait {
    Idle,
    CapReached,
}

/// Resolves once `idle()` holds, sampled every `poll`, or after `cap`.
pub async fn wait_until_idle(idle: impl Fn() -> bool, poll: Duration, cap: Duration) -> IdleWait {
    let sampled = async {
        loop {
            if idle() {
                return;
            }
            tokio::time::sleep(poll).await;
        }
    };
    match tokio::time::timeout(cap, sampled).await {
        Ok(()) => IdleWait::Idle,
        Err(_) => IdleWait::CapReached,
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct InstallOpts {
    pub wait_for_idle_prover: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InstallCaller {
    /// Installed without a click; waits up to [`IDLE_WAIT_CAP`] for running proofs to finish.
    Auto,
    /// "Update Now" is explicit consent, so it does not wait.
    UpdateNow,
}

pub fn install_opts(caller: InstallCaller) -> InstallOpts {
    InstallOpts {
        wait_for_idle_prover: caller == InstallCaller::Auto,
    }
}

#[derive(Debug)]
pub enum GuardedError<E> {
    Download(E),
    Stalled,
}

/// The only way an install obtains its artifact bytes: `download` races the stall watchdog, then an
/// automatic install waits for `idle`. Both happen before any install state is written, so
/// abandoning here leaves nothing behind. The watchdog stops when the download completes, so the
/// idle wait can never trip it.
pub async fn download_guarded<F, E>(
    download: impl FnOnce(Arc<StallWatch>) -> F,
    idle: impl Fn() -> bool,
    opts: InstallOpts,
) -> Result<Vec<u8>, GuardedError<E>>
where
    F: Future<Output = Result<Vec<u8>, E>>,
{
    let watch = Arc::new(StallWatch::new());
    let bytes = tokio::select! {
        biased;
        result = download(Arc::clone(&watch)) => result.map_err(GuardedError::Download)?,
        () = watch.stalled(STALL_LIMIT) => {
            tracing::warn!("Update download stalled; aborting");
            return Err(GuardedError::Stalled);
        }
    };
    if opts.wait_for_idle_prover
        && wait_until_idle(idle, IDLE_POLL, IDLE_WAIT_CAP).await == IdleWait::CapReached
    {
        tracing::warn!("Prover still busy after 30 min; installing the update anyway");
    }
    Ok(bytes)
}

/// Why a check runs. `Manual` carries the tray's reply channel, `None` once the tray gave up.
pub enum CheckReason<R> {
    Launch,
    Scheduled,
    Manual(Option<R>),
}

/// The tray's reply channel; closed once the tray's own timeout dropped the receiver.
pub trait Reply {
    fn is_closed(&self) -> bool;
}

impl<T> Reply for tokio::sync::oneshot::Sender<T> {
    fn is_closed(&self) -> bool {
        tokio::sync::oneshot::Sender::is_closed(self)
    }
}

/// A check's result, as far as scheduling cares.
pub trait Observation: Sized {
    /// Whether the check got an answer from the feed, including "nothing new" and a refused
    /// candidate; only those count as a check.
    fn reached_feed(&self) -> bool;
    /// What `act` receives, without a fetch, while an install is running.
    fn in_progress() -> Self;
}

#[cfg(test)]
thread_local! {
    static LOOP_WAKEUPS: std::cell::Cell<u64> = const { std::cell::Cell::new(0) };
}

/// The single update task: every feed check in the process runs here, one at a time.
///
/// The launch check always runs, whatever the file says, so no stored state can suppress it. Then
/// each tick checks iff one is due, and each tray request checks at once. A due tick outranks
/// queued clicks (`biased`), so clicks cannot starve the schedule. The timestamp is recorded between
/// `check` and `act`, so acting (an install may exit the process) never skips or moves it. While
/// `busy()` (an install holds the gate), requests reach `act` as [`Observation::in_progress`]
/// without a fetch. Returns [`Infallible`]: the loop has no exit, and adding one fails to compile.
/// `tick` must be nonzero (tokio's interval panics on zero).
#[allow(clippy::too_many_arguments)]
pub async fn run_updates<R, O, C, CF, A, AF>(
    store: &ScheduleStore,
    clock: impl Fn() -> u64,
    launch_delay: Duration,
    tick: Duration,
    mut manual: tokio::sync::mpsc::Receiver<R>,
    busy: impl Fn() -> bool,
    mut check: C,
    mut act: A,
) -> Infallible
where
    R: Reply,
    O: Observation,
    C: FnMut(&CheckReason<R>) -> CF,
    CF: Future<Output = O>,
    A: FnMut(CheckReason<R>, O) -> AF,
    AF: Future<Output = ()>,
{
    tokio::time::sleep(launch_delay).await;
    run_one(
        CheckReason::Launch,
        store,
        &clock,
        &busy,
        &mut check,
        &mut act,
    )
    .await;

    // `interval_at`, not `interval`: a plain interval fires at once, which would retry a failed
    // launch check immediately.
    let start = Instant::now()
        .checked_add(tick)
        .unwrap_or_else(Instant::now);
    let mut ticks = tokio::time::interval_at(start, tick);
    ticks.set_missed_tick_behavior(MissedTickBehavior::Delay);
    // A closed receiver is always ready, so it must leave the `select!` or the loop would spin.
    let mut manual_open = true;
    loop {
        #[cfg(test)]
        LOOP_WAKEUPS.with(|n| n.set(n.get().saturating_add(1)));
        tokio::select! {
            biased;
            _ = ticks.tick() => {
                let now = clock();
                if check_due(store.last_checked(now), now) {
                    run_one(CheckReason::Scheduled, store, &clock, &busy, &mut check, &mut act).await;
                }
            }
            request = manual.recv(), if manual_open => match request {
                Some(reply) if reply.is_closed() => {}
                Some(reply) => {
                    let reason = CheckReason::Manual(Some(reply));
                    run_one(reason, store, &clock, &busy, &mut check, &mut act).await;
                }
                None => manual_open = false,
            },
        }
    }
}

async fn run_one<R, O, C, CF, A, AF>(
    reason: CheckReason<R>,
    store: &ScheduleStore,
    clock: &impl Fn() -> u64,
    busy: &impl Fn() -> bool,
    check: &mut C,
    act: &mut A,
) where
    R: Reply,
    O: Observation,
    C: FnMut(&CheckReason<R>) -> CF,
    CF: Future<Output = O>,
    A: FnMut(CheckReason<R>, O) -> AF,
    AF: Future<Output = ()>,
{
    if busy() {
        act(reason, O::in_progress()).await;
        return;
    }
    let observation = check(&reason).await;
    if observation.reached_feed() {
        if let Err(e) = store.record_checked(clock()) {
            tracing::warn!(error = %e, "Could not persist the update-check time; it holds for this session");
        }
    }
    // The tray gave up during the check: keep manual provenance (never an install) but stop
    // treating the request as live.
    let reason = match reason {
        CheckReason::Manual(Some(reply)) if reply.is_closed() => CheckReason::Manual(None),
        other => other,
    };
    act(reason, observation).await;
}

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::arithmetic_side_effects
)]
mod tests;

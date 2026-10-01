---
plan: update-check-schedule
tier: mid (escalated from light at the approval gate, 2026-09-30)
driver: claude-code
claude_model: opus
eli5_mode: artifact
code_review: off
status: delivered 2026-09-30 as a bootstrap PR (#79) plus two stacked arcs, awaiting merge; seeds retired
created: 2026-09-30
worktree: .claude/worktrees/update-check-schedule
branch: worktree-update-check-schedule
base: main @ da476fa
---

## Outcome

**Delivered 2026-09-30, pending the owner's merge.** The bootstrap merged as #79 (`77b5f50`). Arc 1
(`worktree-update-check-schedule`, #80) and arc 2 (`update-check-schedule-tray`, #81) were opened as a stack
with `gh stack submit`. This plan's `/goal` and `/loop` seeds are retired; do not re-run them. Per
Post-implementation step 5, the archive move waits until both PRs merge.

**Shipped:**
- **Arc 1:**
  - One update task that checks at launch, then every 6 h of wall-clock time; it wakes every 15 min, so sleep no longer stretches the cadence.
  - "Later" as a persisted 24 h per-version snooze.
  - An install gate, a 60 s download stall watchdog, and an automatic install that waits (up to 30 min) for an idle prover.
  - A classify-only check with a separate decision; the pending slot keeps its single extractor.
- **Arc 2:**
  - The tray **Check for Updates…** item: generation-checked labels posted to the main thread, a 90 s reply timeout, a 5 min revert, and "Installing update…" whenever an install holds the gate.
  - The WebDriver-only tray E2E through the production menu dispatch.
  - Static guards plus a release-binary scan that keep the hooks out of shipped builds.
  - Outside the plan, by owner decision (2026-10-01): a one-line fix to the playground live-node
    test, which since #73 could not reach an http node. Without it the bundle gate can never go
    green (`lessons/tray-click.md`).

**Evidence:**
- Phase 5 smokes on three OSes, in positive, negative, prompt and stall modes.
- Phase 4 at `1bcfd2a`: presto.yml 36788162010, with the tray spec on four legs; positive smokes 36788164952 and 36788167545, with the hook scan on six release binaries.
- A real tray click in the shipped Linux AppImage (owner request): the prompt smoke 36794011299 clicks **Check for Updates…** over D-Bus during a snoozed launch and gets the prompt (`lessons/tray-click.md`).
- The production menu variant, run locally.
- Every 🧬 test was shown red against its mutant; see `lessons/`.
- Codex: the arc 1 loop converged at round 3. The arc 2 loop hit its 3-round cap, and its last finding concerned only a reverted change. The fresh cross-arc pass converged at round 3 with "No new material findings".

**Dropped:**
- The same-length tamper follow-up (L7). Its premise was wrong: the plugin verifies the signature inside `download()`.
- One cross-arc finding was declined with Codex's agreement: an instant-long "Installing update…" after "Update Now" on a withdrawn prompt. It is listed as a residual in `follow-ups.md`.

# Update checks that survive sleep, a 6 h cadence, and a tray "Check for Updates…"

Presto 1.1.3 is released. It checks for updates 5 s after launch and then every 12 h through `tokio::time::sleep`. That clock stops while the machine sleeps, so a laptop that sleeps overnight can go days without a check. This plan:

1. Wakes every 15 min and compares against a persisted wall-clock time of the last successful check.
2. Checks when 6 h have passed.
3. Adds a tray item, "Check for Updates…", that reports through its own label.

"Remind Me Later" now snoozes that exact version for 24 h, and the snooze survives restarts.

## Outcome & Quality Bar

**For whom:** someone running the released Presto from the tray, usually on a laptop that sleeps for most of the day. They never think about updates and occasionally want to force a check.

**What excellent looks like:**

1. **Never worse than 1.1.3.**
   - No new state (missing, corrupt, future-dated, unwritable, a FIFO) can:
     - suppress the launch check;
     - crash the app;
     - delay a due check by more than one 15 min tick.
   - The only exception is an explicit, version-bound "Later", capped at 24 h.
   - The new code, built as the N-1 baseline, auto-updates on all three OSes before merge.
2. **Honest tray feedback.**
   - A click shows "Checking…" at once with the item disabled.
   - It ends in "Up to date", "Couldn't check — try again", or a visible, focused update prompt within 30 s when no other check is running. A click during a check waits for it, so the worst case on a responsive network is about 60 s. At 90 s the label gives up with "Couldn't check — try again".
   - The 30 s bound covers the feed fetch only. Signature verification, the schedule-file write and the window call run outside it.
   - During an install already in progress the item reads "Installing update…" and shows no prompt. That is the one exception to "a manual click always shows the prompt".
   - Double-clicks cause a single check, and the label returns to "Check for Updates…" on its own.
3. **Respectful prompting.**
   - "Later" silences that exact version for 24 h across restarts; a newer version prompts at once.
   - A manual click always shows the prompt, for auto-update users and snoozed versions too.
   - An open prompt always shows the version that would install.

4. **Updates never interrupt work or hang.** An auto-install waits (up to 30 min) for in-flight proofs to finish, and a download that makes no progress for 60 s is abandoned cleanly and retried later.

**Good enough:** no OS resume hook (a check lands within 15 min of waking), no jitter or backoff beyond "retry on the next tick while due", and no new prompt copy.

## Scope

**In:**
- Wall-clock scheduling and the 6 h cadence.
- The persisted per-version snooze.
- The tray item.
- The feed-fetch timeout.
- Install safety (A5, A6): an auto-install waits for an idle prover (30 min cap); every download has a 60 s no-progress watchdog. Both sit before `record_pending`, outside `perform_update`'s transaction.
- Prompt presentation fixes: focus on a manual check, keep the displayed version current, order candidates by fetch, and clear a withdrawn pending version.
- Tests at every layer below:
  - a WebDriver-only tray driver;
  - a pre-merge ephemeral updater smoke for macOS and Linux (Windows has one);
  - a `prompt` smoke mode.

**Out:**
- Any change to F-004 verification, the floor, or `perform_update`'s transaction (the lock, `record_pending`, quiesce, marker and install steps keep their order).
- Feed hosting.
- Prompt HTML/JS.
- A release (the user chose merged PRs only).

## Architecture & Implementation

### Shape

```
presto-core  update_schedule.rs   pure due/snooze math · ScheduleStore (file + two mirrors, cross-process lock) · InstallGate
                                  · StallWatch · InstallOpts · download_guarded · run_updates (the one update task)
             server.rs            HeadlessState::prover_idle() (the admission semaphore)
src-tauri    updater.rs           check_for_update(app) -> CheckOutcome (never installs); pure decide(); 30 s feed timeout; spawn_install
             commands.rs          PendingUpdateSlot: + clear(); handle_later ("later") with version matching inside the slot module
             update_menu.rs (lib) ManualCheck label state machine; label transitions run on the main thread
             main.rs / tray.rs    wiring: poller → run_updates; act(); presenter; tray item + on_tray_menu dispatch
             e2e_tray.rs (bin, cfg(feature = "webdriver") only)  every test hook: stub check, reply queue, 2 s revert, the driver
```

**One update task does all checking** (codex round 3). Scheduled ticks and tray clicks both queue into `run_updates`, which fetches, records, and acts one request at a time. Checks are therefore sequential, and the slot's latest write is always the latest completed fetch. That removes the concurrent-check races from rounds 1–3 without fetch sequences, watermarks or presentation tokens. Presentation stays on that worker task, as in 1.1.3, so window creation never runs on the main thread, which deadlocks on Windows (Tauri's `WebviewWindowBuilder` docs). Only menu-label writes are posted to the main thread (F16).

Decision logic is pure, takes `now`, and lives where `cargo test` reaches it without a GUI, following recon's `updater_state` idiom. Tauri-coupled code stays thin.

### Key types (sketch; names may change, semantics may not)

```rust
// presto-core/src/update_schedule.rs
pub const CHECK_INTERVAL_SECS: u64 = 6 * 60 * 60;
pub const WAKE_TICK: Duration = Duration::from_secs(15 * 60);
pub const LAUNCH_DELAY: Duration = Duration::from_secs(5);          // unchanged
pub const SNOOZE_SECS: u64 = 24 * 60 * 60;

pub struct ScheduleState { pub last_checked_at: Option<u64>, pub last_checked_by: Option<String>, pub snooze: Option<Snooze> }
pub struct Snooze { pub version: semver::Version, pub until: u64 }
pub fn check_due(last_checked_at: Option<u64>, now: u64) -> bool;
pub fn effective_last_check(file: Option<u64>, mem: Option<u64>, now: u64) -> Option<u64>;
pub fn is_snoozed(snooze: Option<&Snooze>, candidate: &Version, now: u64) -> bool;

/// Sole owner of the last-successful-check time and the snooze: the file plus in-memory mirrors.
/// `writer` is the desktop app's version, injected because core's own package version is 0.0.0; a file
/// timestamp by another writer is ignored for due-ness, while the file's snooze applies to every version.
pub struct ScheduleStore { path: Option<PathBuf>, writer: String, write: Mutex<()>,
    mem_checked: Mutex<Option<u64>>, mem_snooze: Mutex<Option<Snooze>> }
impl ScheduleStore {
    pub fn new(path: Option<PathBuf>, writer: String) -> Self;         // infallible
    pub fn load(&self) -> ScheduleState;                               // infallible, see Algorithms
    pub fn last_checked(&self, now: u64) -> Option<u64>;               // effective_last_check(file_if_own_writer, mem, now)
    pub fn record_checked(&self, now: u64) -> io::Result<()>;          // sets mem first; keeps snooze
    pub fn record_snooze(&self, s: Snooze) -> io::Result<()>;          // keeps last_checked_*; mirrored like the timestamp
    pub fn is_snoozed(&self, candidate: &Version, now: u64) -> bool;   // the file's snooze OR the session mirror's
}
pub enum CheckReason<R> { Launch, Scheduled, Manual(Option<R>) }   // R: the tray's reply; None once the tray gave up
pub trait Reply { fn is_closed(&self) -> bool; }                   // oneshot::Sender: the tray's 90 s timeout drops the receiver
/// In-process install ownership, shared by the auto-install and the prompt's "Update Now".
/// `updater.lock` stays the cross-process authority.
pub struct InstallGate(AtomicBool);
pub struct InstallClaim(Arc<InstallGate>);                 // Drop releases, including on cancellation
impl InstallGate { pub fn try_claim(self: &Arc<Self>) -> Option<InstallClaim>; pub fn is_busy(&self) -> bool; }
/// Runs `fut` owning `claim`: `async move { let _claim = claim; fut.await }`. Dropping the future at any
/// point, including before its first poll, releases the claim.
pub fn run_claimed<F: Future>(claim: InstallClaim, fut: F) -> impl Future<Output = F::Output>;
/// Download no-progress watchdog: `touch()` from the chunk callback; `stalled(limit)` resolves after
/// `limit` without a touch. Idle, never total, so a slow link is never cut off.
pub struct StallWatch { base: tokio::time::Instant, last_ms: AtomicU64 }
/// Resolves once `idle()` holds (polled every `poll`) or after `cap`, whichever is first; returns which.
pub async fn wait_until_idle(idle: impl Fn() -> bool, poll: Duration, cap: Duration) -> IdleWait;
/// The only way `perform_update` obtains the artifact bytes: races `download` against the stall
/// watchdog, then (if `opts.wait_for_idle_prover`) waits for `idle`. `perform_update` calls
/// `record_pending` only after this returns `Ok`, so the safeguards cannot be bypassed without
/// losing the bytes.
/// The watchdog covers only the download; it stops when the download completes, before any idle wait.
pub async fn download_guarded<F, E>(download: impl FnOnce(Arc<StallWatch>) -> F, idle: impl Fn() -> bool,
    opts: InstallOpts) -> Result<Vec<u8>, GuardedError<E>> where F: Future<Output = Result<Vec<u8>, E>>;
pub struct InstallOpts { pub wait_for_idle_prover: bool }
pub enum InstallCaller { Auto, UpdateNow }
pub fn install_opts(caller: InstallCaller) -> InstallOpts;           // Auto → wait; UpdateNow → no wait
pub trait Observation { fn reached_feed(&self) -> bool; }
/// The single update task. It records between `check` and `act`, so acting (for example, an
/// install that exits the process) can never skip or move the timestamp. `Infallible`: no exit path.
pub async fn run_updates<R, O, C, CF, A, AF>(store: &ScheduleStore, clock: impl Fn() -> u64,
    launch_delay: Duration, tick: Duration, manual: tokio::sync::mpsc::Receiver<R>,
    busy: impl Fn() -> bool, check: C, act: A) -> Infallible
where R: Reply, O: Observation, C: FnMut(&CheckReason<R>) -> CF, CF: Future<Output = O>,
      A: FnMut(CheckReason<R>, O) -> AF, AF: Future<Output = ()>;
// Observation gains `fn in_progress() -> Self`: while `busy()`, the loop hands `act` that value
// without calling `check` or recording anything.

// src-tauri/src/updater.rs — checking never installs; the caller acts after recording
pub enum CheckOutcome { UpToDate, Available(VerifiedUpdate), Rejected, Failed, InstallInProgress }
/// Spawns `run_claimed(claim, perform_update(u) then after)`. Takes a claim the caller already holds;
/// it never claims itself, so each install claims exactly once.
pub fn spawn_install(app: &AppHandle, claim: InstallClaim, u: VerifiedUpdate, opts: InstallOpts,
    after: impl FnOnce(&AppHandle) + Send + 'static);
pub enum CheckMode { Launch, Scheduled, Manual { live: bool } }   // live: Manual(Some(reply)) still open
pub enum OutcomeKind { UpToDate, Available, Rejected, Failed, InstallInProgress }  // payload-free, for the table test
pub enum Decision { Clear, Unchanged, InProgress, SetOnly, SetAndPresent { focus: bool }, ClearAndInstall }
pub fn decide(kind: OutcomeKind, pref: Option<bool>, mode: CheckMode, snoozed: bool, busy: bool) -> Decision; // pure, table-tested
pub fn should_present(mode: CheckMode, snoozed_now: bool, busy: bool) -> bool;
pub enum PromptAction { Open, FocusOnly, Repoint, Nothing }
pub fn prompt_action(open_version: Option<&str>, target: &str, focus: bool) -> PromptAction;
```

### Algorithms

- **`check_due`**:
  - `now == 0` (a clock before the epoch, or unreadable) → due, and `record_checked(0)` records nothing. A broken clock then costs one check per 15 min tick, never zero checks.
  - `None` → due.
  - A value more than `CLOCK_SKEW_TOLERANCE_SECS` (reused, 15 min) in the future → due, because the clock went back.
  - Otherwise due iff `now.saturating_sub(t) >= 6 h`.
- **`effective_last_check`** first drops a file value that lies beyond `now + tolerance`, **or that another app version wrote** (`last_checked_by != writer`), then takes the max with `mem`. An unwritable, future-dated file therefore cannot force a check every tick. The version filter stops a second instance on a different version (F21) from refreshing the timestamp just after this one's tick and postponing its checks forever; each version then keeps its own 6 h cadence through its mirror. Instances on the same version share the file as before.
- **`ScheduleStore::is_snoozed(candidate, now)`** is `is_snoozed(file_snooze) || is_snoozed(mirror_snooze)`. The mirror always holds this process's latest "Later", written or not, so an older, expired or other-version snooze in the file can never mask it.
- **`is_snoozed`**: all of these must hold:
  - the snooze exists;
  - its version equals the candidate (SemVer);
  - `now < until`;
  - `until <= now + SNOOZE_SECS + tolerance`, so a snooze stretched by a backwards clock is void.
- **`run_updates`**, the only code that fetches the feed:
  1. Sleep `launch_delay`, then run `Launch` **unconditionally**. This is F2's recovery path, and no file content can skip it.
  2. Then loop on `tokio::select! { biased; … }` over two sources, the tick first, so a due scheduled check is never starved by queued clicks (a click waits at most one check):
     - `tokio::time::interval_at(now + tick, tick)` with `MissedTickBehavior::Delay`. A plain `interval` completes its first tick at once, which would retry a failed launch check immediately. On each tick, run `Scheduled` iff `check_due(store.last_checked(now), now)`.
     - the manual-request channel, guarded by `if manual_open`. Each request runs `Manual(Some(reply))`. When `recv()` returns `None` (every sender dropped), the loop sets `manual_open = false` and keeps running scheduled checks. A closed receiver is always ready, so without the guard the loop would spin.

     A manual request that arrives during launch or during another check waits its turn, and the tray shows "Checking…" meanwhile.
     - Expiry needs no deadline field: the tray task's 90 s timeout drops its receiver, so `reply.is_closed()` is the signal.
     - A request whose reply is closed before its check starts is dropped without a fetch. Its tray label already says "Couldn't check".
     - A request whose reply closes during its check is handed to `act` as `Manual(None)` and **keeps manual provenance**. It is presented like any manual check (never an install, snooze ignored), without focus, because the tray already gave up. Expiry changes only the feedback, never what may install, and a found update is never hidden behind a tray timeout.
     - The loop has no `return` or `break`, and `run_updates` returns `Infallible`, so adding one is a compile error. It ends only when the task is aborted at app exit.
  3. For each request: if `busy()` (an install holds the gate), `act(reason, O::in_progress())` with no fetch and no record. Otherwise `let o = check(&reason).await`; if `o.reached_feed()`, call `store.record_checked(clock())`; then `act(reason, o).await`. A successful manual check counts as a check, so it postpones the next scheduled one.
  4. **The store is the single owner of the timestamp.** It sets the mirror before writing, and a failed write is logged while the mirror still suppresses re-checks. A long or failing install cannot move the timestamp, because it is recorded before `act` runs. This answers codex round 2, finding 7.
  5. On a failed check, nothing is recorded. Retries therefore happen on each tick **while a check is due**. A failed launch check shortly after a success **by this app version** does not start retries, because that success still counts. After an upgrade, the previous version's timestamp does not count: if N's launch check fails, N retries on its first tick; if it succeeds, its mirror holds the next check off for 6 h. Either way this is never worse than 1.1.3's 12 h.
  6. Requests are strictly sequential. `act` never awaits an install (see Acting), so the task stays responsive to the network. It is not bounded against a stalled disk or window call; those stall it the same way they stall 1.1.3's poller.
  7. The file also records `last_checked_by`, the injected app version. The smoke test uses it to attribute the write to N rather than to N-1.
- **`ScheduleStore::load`**:
  - Opens with `O_NONBLOCK` on unix and requires `fstat` of the *opened* handle to be a regular file. A FIFO or directory cannot block or be read, which answers codex finding 9.
  - Reads at most 4 KiB + 1 byte.
  - Missing, oversized, invalid UTF-8 or JSON, `schema != 1`, bad types, or a non-SemVer snooze version all give `ScheduleState::default()`, logged at `warn` except Missing.
  - Unknown extra fields are ignored; there is no `deny_unknown_fields`, because this is soft state.
  - Every failure direction means more checks and prompts, never fewer.
- **Writes** go through `write_private_atomic(path, bytes, prefix)`, a **strictly mechanical** move of `updater_state::write_state`'s body: create the parent 0700, a same-directory temp file 0600, write, **fsync the file, rename, then fsync the directory** (the existing order at `updater_state.rs:363-384`, which the floor's crash durability depends on). `write_state` keeps its signature and calls the helper. Reviewed with `git diff --color-moved`; pinned by B13 and B16.
- **Read-modify-write is locked across processes.** macOS and Linux can run two instances (F21), and a lost snooze would let the other instance auto-install against A4. Every `record_*` holds an exclusive lock on the sibling `update-schedule.json.lock` across read → modify → write, using the flock / `LockFileEx` primitive extracted mechanically from `config.rs:467` (`acquire_config_write_lock`, which then delegates to it). It is held for one small write, as config's is, and **released before any config, updater-lock or UI operation**; no code path nests it with `config.json.lock` or `updater.lock`. The in-process mutex stays; lock poisoning is recovered with `into_inner`, never `unwrap`. A lock that cannot be acquired returns `Err`, which is logged, and the mirror still applies.
- **Both fields are mirrored in memory.** The timestamp mirror already existed; the snooze gains one. So a failed snooze write still defers that version for the session, instead of silently doing nothing. It is logged, and it does not survive a restart.
- **File**: `~/.presto/update-schedule.json`, `{"schema":1,"last_checked_at":u64,"last_checked_by":"1.1.4","snooze":{"version":"1.2.0","until":u64}}`. It sits beside `updater-state.json`, following the `dirs::home_dir()` convention (recon).
- **`check_for_update(app) -> CheckOutcome`** (codex finding 5):
  - `updater.check()` is wrapped in `tokio::time::timeout(30 s)` → `Failed` (F9).
  - `Ok(None)` → `UpToDate`; `Err` → `Failed`; a gate refusal → `Rejected`; otherwise `Available`.
  - It no longer reads the preference and never calls `perform_update`.
  - `Rejected` and `UpToDate` count as a reached feed. So a replayed, stale but validly signed manifest (rejected by Layer B) buys at most 6 h of silence per replay, the same power a feed host already has; the manifest carries no freshness signature.
  - 30 s, not 60 s: a click queued behind a scheduled check waits for at most two fetches, and 2 × 30 s stays inside the tray's 90 s ceiling.
- **`decide(outcome, pref, mode, snoozed, busy)`** (one pure function; `route` is folded in). `Launch` behaves exactly like `Scheduled`:

  | outcome | mode | pref | snoozed | busy | → |
  |---|---|---|---|---|---|
  | `UpToDate` / `Rejected` | any | any | any | any | `Clear` |
  | `Failed` | any | any | any | any | `Unchanged` |
  | `InstallInProgress`, or `Available` while busy | any | any | any | yes | `InProgress` |
  | `Available` | Manual, live | any | any | no | `SetAndPresent { focus: true }` |
  | `Available` | Manual, expired | any | any | no | `SetAndPresent { focus: false }` |
  | `Available` | Launch / Scheduled | `Some(true)` | no | no | `ClearAndInstall` |
  | `Available` | Launch / Scheduled | `Some(true)` | yes (A4) | no | `SetOnly` |
  | `Available` | Launch / Scheduled | `None` / `Some(false)` | no | no | `SetAndPresent { focus: false }` |
  | `Available` | Launch / Scheduled | `None` / `Some(false)` | yes | no | `SetOnly` |
- **Acting on a check** (`act` in `main.rs`, run inside `run_updates`, so one request at a time):
  - `UpToDate` or `Rejected` → `slot.clear()`. **The latest fetch finding nothing clears a pending version**, so after a `promote-only <prev>` rollback a withdrawn release can no longer be installed from a prompt left open. A manual request replies `UpToDate` or `Failed`.
  - `InstallInProgress` → nothing; a manual request replies `Installing`. `run_updates` produces it without calling `check` while `busy()` (C15), so a scheduled tick records nothing.
  - `Available(u)` while `gate.is_busy()` (the user clicked "Update Now" during this fetch) → handled as `InstallInProgress`.
  - `Available(u)` → `decide(…, is_snoozed(u), gate.is_busy())`:
    - **`ClearAndInstall`** → `gate.try_claim()`. `None` → treated as `InstallInProgress`. `Some(claim)` → `slot.clear()`, then `spawn_install(app, claim, u, install_opts(InstallCaller::Auto), …)`.
      - **Each install path claims exactly once, then hands the claim to `spawn_install`**: this one, and `respond_update_prompt`'s "Update Now" through `handle_update_now` (below), which today spawns `perform_update` on its own (`commands.rs:1089`). `run_claimed` binds the claim inside the spawned future, so it is released on every return of `perform_update` (lock held, marker live, download, size cap, floor, persistence) and whenever the future is dropped, even before its first poll. Neither caller can release the other's claim.
      - `perform_update`'s lock and marker ordering are untouched, and it never runs under a timeout. The update task does not await it, so a hung download cannot freeze the tray.
      - **A4 boundary:** the decision reads the snooze once, then claims and spawns. A "Later" recorded after that read does not stop this install; it affects only later decisions.
    - **`SetAndPresent { focus }`** → `slot.set(u)`, then present `u.version()` (below). A live manual request replies `Presented`, or `Failed` if the window call failed.
    - **`SetOnly`** (snoozed) → `slot.set(u)`, so an open prompt re-points to it on Update, and log `Update snoozed; prompt suppressed version=… until=…` (the line the `prompt` smoke waits for). Nothing is presented.
  - `Failed` → the slot is unchanged, and a manual request replies `Failed`.

  `perform_update` returns early on any failure: lock held, Windows marker live, size cap, the floor re-check, download error, **download stall**, or persistence. Each is logged. The timestamp is already recorded, so the retry comes at the next due check (≤ 6 h, versus 12 h today) or the next launch.
- **Install safety** (A5, A6). `perform_update` obtains the bytes only through `download_guarded(...)`, which wraps `update.download()`, before the size re-check and `record_pending`, where the code already aborts with a plain `return` (only the updater lock is held). So neither safeguard can be dropped without also dropping the bytes, and the orchestration is tested in core:
  - **Stall watchdog (every install), around the download only:** `update.download()` races `StallWatch::stalled(60 s)` in a `select!`, with the watch shared as an `Arc`. The existing chunk callback calls `touch()`. The race ends when the download completes, so the idle wait that follows can never trip it. On a stall the download future is dropped, `Update download stalled; aborting` is logged, and the function returns. Idle, never total, so a slow but progressing link is never cut off. `tokio::time::Instant` pauses during suspend on macOS and Linux, so a laptop sleeping mid-download is judged on awake time: after waking, a dead connection is abandoned 60 s later.
  - **Idle-prover wait (auto-install only, `install_opts(InstallCaller::Auto)`), after the download completes:** `wait_until_idle(|| state.prover_idle(), 10 s, 30 min)`. `prover_idle()` is `prove_waiters.available_permits() == MAX_INFLIGHT_PROVE`: both `/prove` and `/prove/ultra-honk` hold one of those permits for the whole request, including until a killed bb is reaped (`prove.rs:382`, `ultra_honk.rs:321`). The tray's status flag is **not** usable, because each finishing request sets it to Idle while others may still run (`prove.rs:30-36`). After 30 min the install proceeds, logged, so continuous proving cannot strand the user. `SharedAppState` missing (it never is after setup) → no wait, 1.1.3 behaviour.
  - While either runs, the install gate stays claimed, so the tray says "Installing update…" and checks do not fetch. Quitting during either writes nothing.
  - **Residual:** a proof admitted between the last idle sample and `begin_quiesce` is killed, as in 1.1.3; the window is one file write.
  - **A redundant instance** (macOS or Linux, lost the bind, F21) sees its own idle semaphore while the serving instance proves. Its install still interrupts nothing there: `terminate_and_confirm` reaps only its own process's bb tree (the tracking state is a per-process `static`, `core/src/bb.rs:691`), and replacing the bundle or AppImage on disk does not stop a running process. The assurance covers the already-running proof only. The serving instance keeps checking on its own cadence (A7b guarantees the check) and then follows its own preference and snooze rules: a prompt-mode user still has to consent.
- **Pending slot** (`commands.rs` `pending_update` module):
  - It gains only `clear()`. `set` stays unconditional; with sequential checks, the last write is the latest completed fetch.
  - **The latest fetch wins, never the highest version**, so the rollback lever displaces a withdrawn version. Codex round 1 proposed "keep the newer candidate"; that part is rejected.
  - **No new accessor exposes the pending version.** The B2 seal is unchanged: `take_or_reprompt` stays the only extractor, and `commands` never sees the pending version.
- **Presentation** (`main.rs` plus `windows.rs`). It runs on the update task, a worker thread as in 1.1.3, and never on the main thread: creating a window there deadlocks on Windows (codex round 3, finding 1). It presents **the version it just verified**, never one read out of the slot.
  1. Skip if `gate.is_busy()` (the user clicked "Update Now" after `slot.set`). For launch and scheduled checks, also re-read the snooze from the store and skip if it now covers the version (the user clicked "Later"). Both are one pure `should_present(mode, snoozed_now, busy)`.
  2. Log `Showing update prompt`, the existing line, which the `_e2e-webdriver.yml:130` guard still matches.
  3. `show_update_prompt_window(app, current, version, focus) -> bool` executes the pure `prompt_action(open_version, target, focus)`:
     - `Open` when absent (focused on create, as today);
     - `Repoint` when the open prompt's URL `version` differs, through the URL rewrite shared with `Reprompt::navigate`;
     - `FocusOnly` when the same version is open and `focus`; `Nothing` otherwise. The same version is never re-navigated, because a reload resets the prompt's click-steal guard.
  4. Only when the window call succeeds, log `Update prompt presented version=…`; on failure a live manual request replies `Failed`.

  No lock is held across a window call. Prompt commands run on the main thread and touch the slot's mutex briefly; "Later" also performs one small locked write (`record_snooze`) there, normally brief, the same blocking that config writes from commands already do, and subject to the same stalled-filesystem residual (there is no timeout).
  **Runtime guard:** setup records the main thread's `ThreadId` in a `OnceLock`. `show_update_prompt_window` refuses to run on it: it logs an error and returns `false` (a live manual request then replies `Failed`), instead of risking the Windows deadlock. `panic = "abort"` rules out an assert.
- **"Update Now"**: the arm's logic moves into `handle_update_now(gate, slot, displayed) -> UpdateNowOutcome { Busy, Install(InstallClaim, T), Reprompt(cap), Empty }`.
  - It claims **before** `take_or_reprompt`, so a busy gate returns `Busy` and leaves the pending item in place; the arm logs and closes the prompt.
  - On `Reprompt` or `Empty` the claim is dropped inside `handle_update_now`, before the arm does any window work.
  - On `Install(claim, u)` the arm persists the preference as today, then `spawn_install(app, claim, u, install_opts(InstallCaller::UpdateNow), close_update_prompt)`. Explicit consent keeps 1.1.3's behaviour of not waiting for the prover.
- **`respond_update_prompt` gains no `State<` parameter.** An unmanaged `State` fails the whole command (`state.rs:60-69`), and no lane runs this command against a real app. It reads `ScheduleStore` and `InstallGate` through `app.try_state`. If either is missing: "Later" just closes the prompt (1.1.3), and "Update Now" uses a fresh local gate (no coordination, `updater.lock` still guards). Both are managed in the `Builder` chain next to `PendingUpdate` (`main.rs:865`), not in `setup`, pinned by a static guard.
- **"Later"**: the command's logic moves into a testable `handle_later(slot, store, displayed, now) -> LaterOutcome`, and the command becomes a thin `require_label` wrapper.
  - If `displayed` equals the pending version (compared inside the slot module), the outcome is `Snoozed`: `record_snooze` runs, where a failed write is logged, and the prompt closes.
  - If a different version is pending, the outcome is `Reprompt(cap)`: the prompt is re-pointed at it, so "a newer version prompts at once".
  - If nothing is pending, the prompt closes.
  - Only a version that Rust verified and the prompt is displaying can be snoozed. The pending item is not consumed, and the IPC shape does not change.
  - **Residual:** an answer ("Later" or "Update Now") that lands after Presentation step 1 but before the window call can reopen the prompt once. The window is one file read plus one window call, wider if either stalls. The cost is a redundant prompt: "Later" there just persists again, and "Update Now" finds the gate busy or the slot empty and closes it. Neither path installs anything unapproved or suppresses a future check.
- **Manual controller** (`update_menu.rs`):
  - States: `Idle`, `Checking`, `UpToDate`, `Failed`, `Installing`.
  - Labels:
    - `Check for Updates…`
    - `Checking…`
    - `Up to date`
    - `Couldn't check — try again`
    - `Installing update…`, a fourth result label for a click during a detached install. It is the only truthful answer there, and it is an addition to the user's three labels.
  - Only `Checking` is disabled.
  - A click (main thread) runs `try_begin`: single-flight, raise the generation, and write "Checking…". The write is inline, since the handler is already on the main thread.
  - Then `manual_tx.try_send(reply_tx)`. A full or closed channel means `Failed`.
  - A task on `tauri::async_runtime::spawn` awaits the reply, with a 90 s ceiling that also maps to `Failed`; the timeout drops the receiver, which is how the update task learns the request expired. The menu callback has no Tokio context, and `tokio::spawn` there panics, which aborts the app (a static guard forbids it).
  - The manual channel holds 4 requests. Single-flight allows one live request; expired ones still queued behind a stalled task are skipped cheaply. A full channel means the task is stalled, and `Failed` is the truthful answer.
  - **Every later label transition is posted with `run_on_main_thread`**: the result, and the 5 min revert. The posted closure checks the generation and writes the label in one step. Nothing holds a lock across a menu call, because menu setters block on the main thread (F16).
  - `Presented` ends at Idle.
  - Posting errors are logged and never unwrapped.
  - For tests, a small `UiThread` trait stands in for posting: production uses `run_on_main_thread`, and tests use a queue they drain in a chosen order.
- **Tray**:
  - A pure `menu_layout(dev_mode, has_check) -> Vec<&'static str>` gives the item order, and `build_tray_menu` follows it. `check_updates` sits after the version line in both variants.
  - The item is created once in `setup_desktop` and passed into every build, including the dev rebuild (F7).
  - **Creation failure is logged and the tray is built without it.** It never propagates with `?` into the setup `expect` (codex finding 9).
  - The item exists iff `should_poll_for_updates()`, evaluated once, or the build has the `webdriver` feature.
  - Native menu events route through one `on_tray_menu(app, id)` dispatch function.
- **WebDriver builds**:
  - `should_poll_for_updates`, the floor tracker and the real `check_for_update` path stay compiled out (F4).
  - **`run_updates` runs with the real `decide`, `act` and controller, and a stub `check`** that pops outcomes from a queue (default `UpToDate`) and never returns `Available`. So the whole path (click → channel → task → `decide` → reply → label) runs in a real app, while no prompt can open and no network is touched. The store is `ScheduleStore::new(None, …)`, mirror only, so a WebDriver run never writes `~/.presto`. The `act` arm for `Available` calls a presenter that is compiled out under `webdriver` and logs an error instead.
  - All of it (stub `check`, queue, the 2 s revert passed to `ManualCheck::new`) lives in `e2e_tray.rs`, so one `cfg` gates every test hook.
  - `e2e_tray.rs` (`#[cfg(feature = "webdriver")] mod e2e_tray;`) runs only when `PRESTO_E2E_TRAY_REPORT` is set:
    1. It queues outcomes and posts **`on_tray_menu(app, "check_updates")`** through `run_on_main_thread`, so the production dispatch runs against the managed controller on the same thread as a native click.
    2. It reads back `text()`, `is_enabled()` and `Menu::get("check_updates")` from the native item, **polling each expected state with a deadline** rather than sleeping a fixed time.
    3. It writes the report JSON.
  - There is no IPC command and no ACL change (F8).

### File-level change map

| File | Change |
|---|---|
| `packages/presto/core/src/update_schedule.rs` (+ `lib.rs`) | **new**: constants, pure functions, store, `InstallGate`, `run_claimed`, `StallWatch`, `wait_until_idle`, `InstallOpts`, `install_opts`, `download_guarded`, `run_updates`, tests; the panic-free `deny` lints |
| `packages/presto/core/src/server.rs` | `HeadlessState::prover_idle()` + test |
| `packages/presto/core/src/config.rs` | the flock / `LockFileEx` body moved into a shared exclusive-lock helper; `acquire_config_write_lock` delegates (mechanical) |
| `packages/presto/core/src/updater_state.rs` | `write_state` body → `pub(crate) write_private_atomic` |
| `packages/presto/src-tauri/src/updater.rs` | `CheckOutcome`, `CheckMode`, `OutcomeKind`, `Decision`, `decide`, `should_present`, `prompt_action`, feed timeout, `spawn_install`, `perform_update` obtaining its bytes through core's `download_guarded`, `update_schedule_path()`, module doc |
| `packages/presto/src-tauri/src/commands.rs` | slot: `clear()` and snooze matching; shared prompt URL rewrite; `handle_later` and `handle_update_now`, each behind a thin arm |
| `packages/presto/src-tauri/src/update_menu.rs` (+ `lib.rs`) | **new**: `ManualCheck`, `UiThread`, labels, tests; the panic-free `deny` lints |
| `packages/presto/src-tauri/src/main.rs` | poller → `run_updates`; `check` and `act` closures; the managed `InstallGate`; the manual channel; managed store and controller; tray item; `on_tray_menu`; `e2e_tray` hook |
| `packages/presto/src-tauri/src/tray.rs` | `menu_layout`; `build_tray_menu(..., check_updates: Option<&MenuItem>)` |
| `packages/presto/src-tauri/src/windows.rs` | the prompt helper takes `focus_if_open` |
| `packages/presto/src-tauri/src/e2e_tray.rs` | **new**, webdriver-only |
| `packages/presto/e2e-webdriver/tray-update.spec.ts` + `packages/presto/wdio.conf.ts` | **new** spec, added to the explicit spec list before `autostart.spec.ts` |
| `packages/presto/scripts/webdriver-only-hooks.test.ts` | **new** static guard (K1–K4) |
| `packages/presto/scripts/update-wiring.test.ts` | **new** static guard (G7, H7, I12) |
| `packages/presto/scripts/release-contract.test.ts` | pins L1 and L2 for both manual smoke workflows |
| `packages/presto/scripts/assert-update-schedule.ts` + test | **new** smoke assertion |
| `packages/presto/scripts/updater-feed-server.ts` + test | `--stall-after <bytes>` for the `stall` mode |
| `packages/presto/scripts/updater-smoke.sh`, `-linux.sh`, `-windows.ps1` | schedule assertion (positive); N-1 alive at the end of negative; new `prompt` mode; `stall` mode (unix scripts) |
| `.github/workflows/_e2e-webdriver.yml` | Launch step exports `PRESTO_E2E_TRAY_REPORT`; a step asserts the WebDriver binary **contains** that string (K5's teeth) |
| `.github/workflows/smoke-updater-unix.yml` | **new**. The bootstrap PR adds it with modes `positive` and `negative`; arc 1 adds `prompt` and `stall` to its allowlist; arc 2 adds K5's binary check |
| `.github/workflows/smoke-updater-windows.yml` | bootstrap PR: `mode` becomes `type: string` with a first-step allowlist; arc 1: `prompt` added to that allowlist and to the `.ps1`'s own mode allowlist; arc 2: K5's binary check |
| `CLAUDE.md`, `packages/presto/UPDATER_TESTING.md`, `implementations-plan/follow-ups.md` | docs |

### Alternatives not taken

- **New fields in `updater-state.json`.** `deny_unknown_fields` means a downgraded build would quarantine the anti-rollback floor (F5).
- **A launch check conditional on due-ness.** Rejected: a buggy file could then suppress the recovery path.
- **Concurrent manual and scheduled checks, ordered by fetch sequence, a watermark and presentation tokens** (rounds 1–3). Rejected: each round found another check-then-act race. One update task that runs checks one at a time removes the class. An install is spawned rather than awaited, so a hung download still cannot freeze the tray.
- **Highest-version-wins in the pending slot** (codex round 1). Rejected: it defeats the rollback lever. Fetch order wins instead.
- **A test-only IPC command.** Rejected: it needs a feature-conditional ACL across `build.rs`, the capabilities and a pinned guard (F8).
- **An OS resume hook.** Rejected: three platform APIs to save at most 15 min.
- **The minimal outline (`plan-alt-minimal.md`: one check lock held across the check and the install).** Rejected by both reviewers: a hung download would hold the lock, so the tray could never check again and would say "Couldn't check" when the truth is "installing", and checking would keep its install side effect. Its useful trims were adopted: no deadline field (`reply.is_closed()`), and `route` folded into `decide`.
- **The tray's busy flag as the idle-prover signal.** Rejected: each finishing request sets it to Idle while up to 8 may be admitted.
- **A runtime check that N ignores `PRESTO_E2E_TRAY_REPORT`.** Rejected: on Windows, N is relaunched by NSIS or crash recovery and may not inherit the variable, so the check could pass without testing anything. K5's binary check is deterministic.
- **A 60 s feed timeout** (Opus). Rejected: two queued fetches would exceed the tray's 90 s ceiling.
- **`updater_builder().timeout()`.** Rejected in favour of `tokio::time::timeout` on the fetch alone, which cannot leak into downloads if a future plugin version forwards the timeout.
- **New jobs in `smoke-updater-windows.yml`.** Rejected: it would misname the file, and dispatching new inputs through it is unverified. A separately bootstrapped workflow is used instead (Delivery).

## Security & Adversarial Considerations

- **Threat model.** Attackers are a network attacker against the feed, a local process running as the user, and a compromised prompt webview.
  - The trust anchors are F-004 Layer A (signed manifest) and Layer B (floor), both untouched.
  - Every install still goes `check → verify_and_gate → VerifiedUpdate → perform_update`. `check_for_update` now only classifies, and the install decision moves to the caller's pure `decide`.
- **Feed stalling and denial.**
  - A black-holed fetch fails after 30 s instead of pinning the loop forever (F9).
  - Failures retry every 15 min while a check is due.
  - A refused candidate counts as reached (≤ 1 fetch per 6 h).
  - A download that stops making progress is abandoned after 60 s (A6), so it can no longer hang the install gate. A slow link is never cut off. The pre-existing hang is fixed rather than filed.
  - A replayed, stale but validly signed manifest is `Rejected` and counts as reached: ≤ 6 h of silence per replay, the same as a feed host that stops updating.
- **The prompt webview.**
  - "Later" can snooze only the version Rust verified and the prompt displays (`handle_later`, with the match done inside the slot module). A forged or stale `displayed_version` snoozes nothing and re-points the prompt.
  - The `require_label` gate and the capability are unchanged.
  - The B2 seal is unchanged. No new accessor returns the pending version; presenters show the version they verified themselves; `take_or_reprompt` stays the only extractor.
- **Withdrawn releases.** The latest successful fetch finding nothing clears the pending slot, so after a `promote-only <prev>` rollback a withdrawn version can no longer be installed from a prompt left open. Before this change it could.
- **Main-thread discipline.** Menu setters block until the main thread runs them (F16), and the prompt commands run on the main thread. So these rules hold:
  - No code holds the slot lock or any controller lock across a window or menu call.
  - Every tray label transition after the click runs as a closure posted to the main thread. Window creation never does; it stays on the update task, because creating a window on the main thread deadlocks on Windows.
  - The scripted E2E driver posts its dispatch the same way.
- **Local tampering with `update-schedule.json`** (0600, same user). A single write can:
  - postpone checks by at most 6 h (a future value makes a check due, and launches always check);
  - hide one version's prompt, or its auto-install if A4 holds, for at most 24 h + 15 min.

  Repeated rewrites by a same-user process can extend both indefinitely. Such a process can equally replace the app binary, so this grants nothing new.
- **Hostile file content.** Non-blocking open, a regular-file check on the handle, a 4 KiB cap and panic-free parsing mean no content aborts the app or hangs it on a FIFO. This matters because release builds abort on panic (F1), and crash recovery turns a deterministic startup panic into a crash loop. **Residual:** a regular file on a stalled network filesystem can still block a read. The load is ≤ 4 KiB and happens once per 15 min tick, which is the same exposure the floor file already has.
- **Test hooks in shipped binaries.** `webdriver-only-hooks.test.ts` fails CI if any of these hold:
  - `mod e2e_tray;` lacks `#[cfg(feature = "webdriver")]`;
  - `PRESTO_E2E_`, the stub queue or the short revert appears outside `e2e_tray.rs`;
  - `[features] default` enables `webdriver`, directly or through another feature;
  - a `release-presto.yml` artifact build passes `--features webdriver`.

  On the artifacts themselves (K5), the ephemeral smokes assert the N-1 and N release binaries do not contain the bytes `PRESTO_E2E_TRAY_REPORT`: the installed executable on Windows and macOS, and the extracted payload on Linux (`--appimage-extract`). `_e2e-webdriver.yml` asserts the WebDriver binary does contain them, so the check has teeth.
- **Panics.** `panic = "abort"` makes any panic a crash, and a deterministic one at startup a crash loop. The new modules deny `unwrap`, `expect`, `panic!`, indexing and unchecked arithmetic by lint (J1). `run_updates` returns `Infallible`, so the only update task has no ordinary return path. A panic is covered by the lints above, and a permanent await by the feed timeout, the stall watchdog and the idle-wait cap (C14).
- **CI least privilege.**
  - `smoke-updater-unix.yml`: `permissions: contents: read`, dispatch only, SHA-pinned actions, and a run-local throwaway signing key, as in `smoke-updater-windows.yml`. The production key never enters it. It never uploads a bundle: they carry the throwaway key, so an installed copy could never update (pinned in `release-contract.test.ts`).
  - Free-form inputs reach shell only through `env:` (L1).
  - Reports and logs go under `$RUNNER_TEMP`.
- **Supply chain.** No new crates or npm packages. `libc`, `semver` and `tempfile` are existing dependencies.

## Assumptions

### Facts (verified)

- **F1.** `src-tauri/Cargo.toml:125` sets `panic = "abort"`, and crash recovery relaunches the app.
- **F2.** `spawn_update_poller` (`main.rs:383-391`) sleeps 5 s, checks, then sleeps 12 h in a loop. The release-gating smokes depend on that launch check: `updater-smoke.sh:217-234`, the Linux script, and `updater-smoke-windows.ps1:329-332,352-357` each give it 300 s with `auto_update: true`. `release-presto.yml:815` makes `release` need all of them.
- **F3.** `check_for_update` (`updater.rs:233-289`) returns `None` for no update, a check error, a gate refusal, and after an auto-install. `run_update_check` (`main.rs:276`) is its only caller.
- **F4.** In `webdriver` builds the *automatic update entry points* are compiled out: `should_poll_for_updates`, `run_update_check`, `spawn_update_poller`, `spawn_floor_tracker` and `start_background_tasks` (`main.rs:254,275,382,406,763`), and `show_update_prompt_window` (`windows.rs:334`). The updater module and plugin remain (`lib.rs:18`, `main.rs:850`). `_e2e-webdriver.yml:122-135` fails on the log line `Showing update prompt`, and it launches the app once for all specs (`:76-93`).
- **F5.** `StateFile` is `#[serde(deny_unknown_fields)]` (`core/src/updater_state.rs:84-95`); an unknown field loads as `Corrupt`. `candidate_allowed` admits a candidate equal to the recorded pending version, so a retry succeeds (`:223`). Recon's fact 10 said otherwise and is corrected.
- **F6.** "Later" (`commands.rs:1107-1110`) persists nothing. The frontend sends `{action: "later", autoUpdate, displayedVersion}` (`src-tauri/frontend-src/update-prompt.js:23-27`), asserted by `e2e/update-prompt.spec.ts`.
- **F7.** The tray `status` item is built once (`main.rs:781`) and passed into every `build_tray_menu`; the rebuild happens only in dev mode (`main.rs:519`). `status_callback` calls `set_text` off the main thread (`main.rs:549`), and `report_missing_bb` calls it on the main thread during setup.
- **F8.** The IPC ACL is all-or-nothing and pinned: `build.rs:143-165`, `main.rs:866`, and `scripts/tauri-trust-boundary.test.ts:201,243,276`.
- **F9.** tauri-plugin-updater 2.11.0 (locked) builds `app.updater()` with `timeout: None` (`src/updater.rs:205,504-505`), and `Update` carries `timeout: None` (`:595`). reqwest has no default total timeout.
- **F10.** `smoke-updater-windows.yml` (dispatch; modes `barrier`, `copy-initiator`, `positive`, `negative`) builds N-1 = 0.0.1 and N = 9.9.9 from the ref with a throwaway key, and signs the feed with `sign-smoke-feed.sh`. `positive` exercises download, restart and marker recovery. The macOS and Linux scripts take the N-1 artifact path and an N directory with a pre-signed feed as arguments (`updater-smoke-linux.sh:40-44`).
- **F11.**
  - `bun run test` runs no cargo tests.
  - CI runs `cargo test --locked --manifest-path packages/presto/{src-tauri,core,server}/Cargo.toml` and `bun run lint:clippy`, both without `--features webdriver` (`presto.yml:68,89-91`).
  - A `presto.yml` dispatch bypasses the filter and runs WebDriver in **dev** mode on three OSes (`:630-647`) plus Linux **built-debug** (`:653-660`). Both use `debug_assertions`, so the dev menu.
  - The **production** menu variant with WebDriver runs only in the release pipeline's `mode: release` gate.
- **F12.** GitHub's `workflow_dispatch` requires the workflow file to exist on the default branch. The run then uses the file at the dispatched ref (codex round 1, citing GitHub docs).
- **F13.** `open_or_focus_window` returns immediately for an existing window, focusing it only if `focus_if_open` (`windows.rs:113-118`). The update prompt passes `false` (`windows.rs:350`). `PendingUpdateSlot::set` replaces unconditionally (`commands.rs:183`).
- **F14.** `libc` is a unix-only dependency of core (`core/Cargo.toml:82-84`) and a **Linux-only** one of src-tauri (`src-tauri/Cargo.toml:91-93`). So `O_NONBLOCK` lives in core, and src-tauri must not use `libc` (it would break the macOS build). `[features] default = []` (`src-tauri/Cargo.toml`).
- **F15.** The released app is Presto 1.1.3; the source is at `1.1.4-rc.1`. `log_dir()` is `~/Library/Application Support/presto/logs` on macOS, `~/.local/share/presto/logs` on Linux, and `%LOCALAPPDATA%/build.presto.presto/logs` on Windows (`core/src/lib.rs:95-104`).

- **F16.** In tauri 2.11.5 (locked), every menu-item setter goes through `run_item_main_thread!`: it calls `run_on_main_thread(task)` and then blocks on `rx.recv()` until the main thread runs that task (`src/menu/mod.rs:25-39`). A worker thread that holds a lock the main thread needs while it calls `set_text` therefore deadlocks. **On the main thread itself the post runs inline**: tauri-runtime-wry 2.11.4 (locked) `send_user_message` calls `handle_user_message` directly when `current_thread().id() == main_thread_id` (`src/lib.rs:235-255`; both `run_on_main_thread` impls route there, `:1604`, `:2777`). So the click handler's inline "Checking…" write cannot self-deadlock.
- **F17.** An unmanaged `tauri::State` fails the whole command with an `InvokeError` (`tauri 2.11.5 src/state.rs:60-69`). `PendingUpdate` is managed in the `Builder` chain (`main.rs:865`); `SharedAppState` is managed in `setup` (`main.rs:808`).
- **F18.** `wdio.conf.ts:19-27` lists its specs explicitly; a new spec file that is not listed never runs.
- **F19.** `perform_update` downloads first (`updater.rs:376-394`), then records the intent (`:432`), then quiesces and kills any in-flight bb (`:460-461`). Between the download and `record_pending`, an abort is a plain `return` holding only `updater.lock`.
- **F20.** Both prove routes admit through `prove_waiters` (a `Semaphore` of `MAX_INFLIGHT_PROVE = 8`), holding the permit for the whole request (`prove.rs:382`, `ultra_honk.rs:321`). The tray's status flag is set to Idle by each finishing request (`prove.rs:30-36`), so it is not an any-in-flight signal.
- **F21.** On macOS and Linux a second instance that loses the `:59833` bind stays resident; only Windows bows out (`main.rs:343-360`). Two update tasks can therefore run; `updater.lock` serialises installs (`updater.rs:47-60`).

### Inferences (unverified — attack these)

- **I1.** `tokio::time::sleep` stops during suspend on macOS and Linux. The 15 min tick bounds post-wake latency either way.
- **I2.** `set_text`, `set_enabled`, `text()` and `is_enabled()` work on all three OSes, including under Xvfb with no StatusNotifier host. This proves native item state, not that the tray is visible or clickable.
- **I3.** An in-job macOS build with no `APPLE_*` secrets is unsigned or ad-hoc signed, and `updater-smoke.sh` installs and updates it; the script checks no signature (`:165-167`). Developer ID and notarization remain covered only by the release lanes.
- **I4.** `Menu::get(id)` finds a top-level item (codex confirmed from the Tauri source).
- **I5.** Local src-tauri cargo builds need `bun run --cwd packages/presto frontend:build` and the bb sidecar placeholder, as `setup-presto` provides in CI.
- **I6.** Retired in round 3. The bootstrap makes `mode` a free-form `string` input in both manual smoke workflows, each validated by a first step against the modes that ref's scripts support. Whether GitHub validates a `choice` against the default branch or the dispatched ref no longer matters.

### Asks (resolved by the user, 2026-09-30: A1 no snooze, A2 auto-merge, A3 no `/harden`, A4 defer, A5 wait for an idle prover, A6 stall watchdog)

- **A1. Closing the prompt with ✕.** Default: it does **not** snooze; the prompt may return at the next due check (≤ 6 h). Recommendation: keep the default.
- **A2. The bootstrap PR.** It adds `smoke-updater-unix.yml` (modes `positive` and `negative`), so the workflow can later be dispatched against the feature branch (F12), and turns `smoke-updater-windows.yml`'s `mode` input from a `choice` into a validated `string`. Both are manual workflows that no release lane calls. It is the cleanest way to run the new code as N-1 on macOS and Linux before merge; the alternative is extra jobs in an existing, differently named workflow.
  - A new dispatch workflow **cannot run before it merges**. Before merge it is checked only by actionlint and a codex review of the concrete file. Its first real run is a dispatch on `main` after merge, which proves the harness against current code.
  - It changes no shipped code and no release lane.
  - Recommendation: authorize **auto-merge of this one PR once its checks are green and the codex review is clean**.
- **A3. `/harden`.** Not needed; the trust anchors are untouched.
- **A4. "Later" for auto-update users.** Should it also defer the *auto-install* of that version for 24 h? Recommendation: **yes**. A user who clicked Later explicitly declined now, and an auto-install restarts the app. The deferral is bounded and version-bound, and only reachable through the manual check. A snooze applies to decisions that read it after it is recorded: the auto-install decision reads it once, then claims the install and spawns it, and a "Later" landing between that read and the claim does not stop it. An install already started is never cancelled. If no, `decide` ignores `snoozed` for `Some(true)`.
- **A5. Auto-installs and in-flight proofs.** Resolved **yes**: an auto-install waits for an idle prover (10 s polls, 30 min cap) after the download and before any install state is written. "Update Now" is unchanged.
- **A6. Download stalls.** Resolved **yes**: a 60 s no-progress watchdog on every download, before any install state is written.
- **A7. Delivery.** Resolved at approval: two stacked arcs after the bootstrap PR (see Delivery). The snooze moved into arc 1 so that arc 1 alone never prompts more often than 1.1.3.

## Failure modes & test matrix

This is the canonical test list. Phase **Tests** sections cite row IDs instead of repeating them.

**How to read it:**
- **Layer:** `U` is a unit test; `P` is a paused-time tokio test; `I` is an integration test against real files, a real slot or a real gate; `S` is a static guard (a TypeScript test over source or workflow files, or a clippy lint); `W` is WebDriver on a real app; `X` is an updater smoke on real release binaries on three OSes.
- **🧬** means the row names the mutation it must fail against (see Phases → Mutation rule).
- **Residual** marks a row that is documented but not tested, with the reason.

### A. Schedule math (`update_schedule.rs`, pure)

| # | Situation | Required behaviour | Test |
|---|---|---|---|
| A1 | Never checked (`None`) | due | U |
| A2 | 6 h − 1 s and exactly 6 h since the last check | not due, then due | U 🧬 `>=` → `>` |
| A3 | Clock moved back days, so the last check sits beyond `now + 15 min` | due | U 🧬 drop the future branch |
| A4 | Forward skew within 15 min | not due | U |
| A5 | `u64::MAX`; a clock stuck at 0 (pre-epoch, `now_unix` → 0) across a launch and many ticks | no panic; due on every tick; `record_checked(0)` records nothing | U + P (the full lifecycle, not one call) 🧬 record at 0 |
| A6 | The mirror holds a future time (clock since corrected), then a check succeeds | `record_checked(now)` **sets** the mirror to `now`, so the next check is 6 h later, not every tick | U 🧬 mirror = max(mirror, now) |
| A7 | Unwritable file with a far-future value, plus a mirror | effective = mirror; checks every 6 h, not every tick | U 🧬 skip the file-value drop |
| A7b | Two loops with **different** writers sharing one file, ticks offset by a few minutes | each checks on its own 6 h cadence; neither postpones the other | P 🧬 honour a foreign writer's timestamp (the other loop then never checks) |
| A7c | Two stores with different writers: store 1 records a check and a snooze for v2 | store 2 ignores the timestamp but honours the v2 snooze | I 🧬 filter the snooze by writer too |
| A8 | Snooze: same version inside 24 h / newer / **older (rollback lever)** / expired / `until` stretched beyond 24 h + 15 min / `until = u64::MAX` | snoozed / not / not / not / void / void | U 🧬 drop the stretch bound |
| A9 | `1.2.0` vs `1.2.0-rc.1` vs `1.2.0+build` | distinct SemVer versions; a snooze for one never covers another | U |

### B. Schedule file (`ScheduleStore`)

| # | Situation | Required behaviour | Test |
|---|---|---|---|
| B1 | Missing | default, no warning | I |
| B2 | Each of: empty, `{}`, `[]`, `null`, invalid UTF-8, `schema` 2, `schema` missing, wrong types, negative or float numbers, non-SemVer or `v`-prefixed snooze version | default, one warning, no panic | I (table) |
| B2b | **Valid** schedule JSON with a non-default snooze, padded with whitespace past 4 KiB | default | I 🧬 remove the cap (the valid fixture then loads, so the test fails; a garbage fixture would not) |
| B3 | Directory at the path | default within 1 s | I |
| B4 | FIFO at the path, no writer (unix) | default within 1 s | I 🧬 drop `O_NONBLOCK`. Harness: `load()` on a thread reporting on a channel; on `recv_timeout(1 s)` expiry, rescue by opening the write end with `O_WRONLY \| O_NONBLOCK` (which fails with `ENXIO` instead of blocking if the reader already left), then join. The test fails either way; nothing hangs or leaks |
| B5 | FIFO at the path holding valid, non-default schedule JSON, with **no writer left** (Linux): the test keeps a separate non-reading `O_RDONLY \| O_NONBLOCK` handle so the buffered bytes survive, writes the fixture through `O_WRONLY`, closes every writer, then calls `load()` | default (the `fstat` regular-file check rejects it before any read) | I 🧬 drop the regular-file check: the reader then gets the JSON and EOF, and loads it. (`/dev/zero` cannot catch this, since the size cap rejects it anyway) |
| B6 | Unknown extra fields in schema 1 | loads | I 🧬 add `deny_unknown_fields` |
| B7 | Round trip | file 0600, `~/.presto` 0700 (pins `write_state`'s existing chmod side effect) | I |
| B8 | `record_checked` then `record_snooze`, and the reverse | neither field lost | I 🧬 write only the field being recorded |
| B9 | Two threads doing 100 alternating records | both fields survive | I |
| B10 | Write fails (`#[cfg(test)]` switch) | `Err` logged; the mirror still suppresses re-checks | I 🧬 set the mirror after the write |
| B11 | Parent path is a regular file | `record_*` → `Err`, no panic | I |
| B12 | `last_checked_by` | equals the injected writer (`"9.9.9"`), not core's `0.0.0` | I 🧬 use `CARGO_PKG_VERSION` |
| B13 | The floor file after the `write_private_atomic` split | byte-identical; every existing `updater_state` test unmodified and green | I |
| B14 | Two stores on the same path, each with its **own open** of the lock file (instances; macOS and Linux keep a second resident one, `main.rs:343`). Store 1 pauses between its read and its write on a `#[cfg(test)]` barrier | while store 1 is paused, a non-blocking probe (a third independent open, `LOCK_EX \| LOCK_NB`) reports contention; after release, store 2's snooze and store 1's timestamp both survive | I 🧬 drop the file lock (the probe then acquires the lock). Independent opens conflict even in one process; cloned descriptors would not |
| B15 | `record_snooze` fails (write switch), with the file holding (a) nothing, (b) an expired snooze, (c) a snooze for another version, (d) an older snooze for the same version | the new snooze applies for the session in every case (the mirror is OR-ed, never masked); logged | I 🧬 "file snooze, else mirror" precedence |
| B16 | The directory fsync fails after the rename (a `#[cfg(test)]` switch in `write_private_atomic`) | `Err`, and the file already holds the new content: pins file fsync → rename → dir fsync | I 🧬 move the dir fsync before the rename |

### C. The update task (`run_updates`, paused time)

| # | Situation | Required behaviour | Test |
|---|---|---|---|
| C1 | Launch with a fresh file / one checked a minute ago / future-dated / FIFO | launch check at 5 s every time | P 🧬 make the launch check conditional on due-ness |
| C2 | The launch check fails | no immediate retry; the first tick is at 5 s + 15 min | P 🧬 `interval` instead of `interval_at` |
| C3 | Ticks with the clock in step | exactly one scheduled check, at the first tick ≥ 6 h | P |
| C4 | One tick passes while the wall clock jumps 9 h (sleep) | a check fires | P 🧬 a `sleep(6 h)` loop |
| C5 | A due check fails, then succeeds | retried every tick while due; the success is recorded | P |
| C6 | The launch check fails an hour after a success recorded **by this version** | no retries until 6 h after that success | P |
| C6b | Upgrade: the file holds N-1's recent timestamp; N's launch check fails / succeeds | N retries on its first tick / N's next check is 6 h after its own success | P 🧬 honour the foreign timestamp |
| C7 | `act` sleeps an hour of paused time, or never completes | the timestamp equals the clock when `check` returned; already on disk | P 🧬 record after `act` |
| C8 | A check or act slower than a tick | never overlaps (a counter stays ≤ 1) | P 🧬 spawn per tick |
| C9 | A manual request during the launch delay / during a slow scheduled check | runs after it, never concurrently | P 🧬 |
| C10 | A manual request and a due tick both ready in the same poll | the scheduled check runs first (`biased`, tick branch first) and a click waits at most one check; a successful manual check postpones the next scheduled check; failed or expired ones never starve it | P 🧬 reverse the branch order (deterministic, unlike removing `biased`) |
| C11 | The reply was dropped before the request's turn (the tray gave up) | no fetch for it | P 🧬 skip the closed check |
| C12 | The reply is dropped during its check | `act` gets `Manual { live: false }`, never `Scheduled` | P 🧬 |
| C13 | Every sender dropped | scheduled checks continue; the loop neither exits nor spins | P 🧬 `None => return`; 🧬 drop the `if manual_open` guard (after the drop, 1,000 `yield_now`s see a handful of wake-ups on a `#[cfg(test)]` counter; this relies on `mpsc::recv`'s cooperative budget, stated in the test) |
| C14 | Any code path adds a `return` or `break` to the loop | compile error (`run_updates` returns `Infallible`). This does not cover a panic (J1 does) or a permanent await (the timeouts and the watchdog do) | S (the compiler) |
| C15 | `busy()` is true (an install holds the gate) | `act` gets `in_progress()`; `check` is not called; nothing is recorded; a manual request replies `Installing` | P 🧬 call `check` anyway |

**Paused-time rule:** every wait in C tests is bounded by `advance` or a paused-time `timeout`. Under `start_paused`, an idle runtime auto-advances to the next timer, so an unbounded await can silently skip to a mutant's 6 h sleep and pass.

### D. Checking the feed (`check_for_update`)

| # | Situation | Required behaviour | Test |
|---|---|---|---|
| D1 | The feed never answers | `Failed` at 30 s | P 🧬 remove the timeout |
| D2 | 404, 5xx, TLS error, garbage JSON | `Failed`; retried every tick while due | thin mapping; covered by C5 |
| D3 | `Ok(None)` | `UpToDate`, counts as reached | U (`reached_feed`) |
| D4 | Signature failure or rollback below the floor | `Rejected`, counts as reached (≤ 1 fetch per 6 h). A replayed, stale but validly signed manifest therefore buys ≤ 6 h of silence, the same power a feed host already has | U (`reached_feed`) |
| D5 | `app.updater()` fails to build | `Failed`, no network; retried per tick | thin mapping |
| D6 | An install holds the gate | no fetch, no record | covered by C15 (in the core loop) and E10 (in `decide`) |

### E. Deciding and the pending slot (`decide`, pure; the slot)

`decide(outcome, pref, mode, snoozed, busy)` replaces `route`. Its table test enumerates outcome × pref (`None`, `false`, `true`) × mode (`Launch`, `Scheduled`, `Manual { live }` both ways) × snoozed × busy. The rows below are the ones that matter:

| # | Situation | Required behaviour | Test |
|---|---|---|---|
| E1 | `UpToDate` or `Rejected` | `Clear` (a withdrawn release can no longer be installed from an open prompt) | U 🧬 |
| E2 | `Failed` | slot unchanged | U |
| E3 | Live manual, any pref, snoozed or not | `SetAndPresent { focus: true }` | U 🧬 route manual like scheduled |
| E4 | Expired manual, pref `true` | `SetAndPresent { focus: false }`, **never** an install | U 🧬 |
| E5 | Scheduled or launch, pref `true`, not snoozed, not busy | `ClearAndInstall` | U |
| E6 | Scheduled or launch, pref `true`, snoozed (A4) | `SetOnly` | U 🧬 ignore the snooze for auto |
| E7 | Scheduled or launch, pref `None`/`false`, not snoozed | `SetAndPresent { focus: false }` | U |
| E8 | Scheduled or launch, snoozed | `SetOnly` | U |
| E9 | **Launch** with a snooze | same as scheduled: `SetOnly` (restarting must not re-prompt) | U 🧬 treat `Launch` as manual |
| E10 | `busy` with `Available` | `InProgress` in every mode | U 🧬 |
| E11 | `set(v2)`, `clear()`, `take_or_reprompt("v2")` | `Empty` | I 🧬 |
| E12 | `set(v3)` then `set(v2)` (rollback lever) | holds v2 | I 🧬 keep the highest |
| E13 | Existing `take_or_reprompt` test | unchanged and green | I |

### F. Installing (gate, claim, watchdog, idle wait)

| # | Situation | Required behaviour | Test |
|---|---|---|---|
| F1 | A second `try_claim` | `None`; dropping the first frees it | U 🧬 |
| F2 | `run_claimed` returns normally / is aborted before its first poll / is aborted mid-await | the claim is released each time | P 🧬 capture the claim without binding it |
| F3 | "Update Now" while the gate is busy | `Busy`; the pending item stays | I 🧬 take before claiming |
| F4 | "Update Now": matching / mismatching / empty | `Install` with the gate busy / `Reprompt` with the gate free / `Empty` with the gate free | I |
| F5 | Full handoff: `Install(claim, u)` → `run_claimed(claim, fake)` spawned | busy while the fake is pending; free after it returns or is aborted | P 🧬 |
| F6 | Every early return of `perform_update` (lock held, marker live, size cap, floor, download error, stall, persistence) | the claim is released (a return drops the future) | covered by F2 |
| F7 | `download_guarded` with a fake download that sends one chunk and then never completes | `Err(Stalled)` at 60 s | P 🧬 remove the watchdog from `download_guarded` |
| F8 | A slow but progressing download (a chunk every 30 s for 10 min) | never aborted | P 🧬 a total timeout instead of an idle one |
| F9 | A chunk at 59 s | resets the watchdog | P |
| F10 | A real download over the smoke's local HTTPS feed | completes; no false stall | X (positive mode, three OSes) |
| F10b | **The production wiring:** the feed sends a genuine partial body and then holds the connection open with no EOF | N-1 logs `Update download stalled; aborting` 60–120 s after the server's **last chunk**, in this launch's log; the **same process** (PID) still answers `/health` as N-1; `updater-state.json` has no `pending` | X (new `stall` mode, `smoke-updater-unix.yml`; `updater-feed-server.ts --stall-after <bytes>` disables Bun's default 10 s idle timeout for that response and logs the last-chunk time) 🧬 bypass `download_guarded` in `perform_update` |
| F11 | `download_guarded` with `install_opts(Auto)` while a real `HeadlessState` holds an admission permit for **5 min** | does not resolve until the permit is released, then within one poll; the 60 s watchdog never fires during the wait | P 🧬 skip the wait; 🧬 `install_opts(Auto)` returns no-wait; 🧬 keep the watchdog running into the wait |
| F12 | Two proofs admitted, one finishes | still busy: the signal is the admission semaphore, not the tray's status flag, which each finishing request sets to Idle (`prove.rs:30-36`) | U (core: `prover_idle` on a real `HeadlessState`) 🧬 read the tray flag |
| F13 | Proofs never pause | install proceeds after 30 min (logged), so continuous use cannot strand the user | P 🧬 remove the cap |
| F14 | "Update Now" | never waits for the prover (explicit consent, as in 1.1.3); it gets the stall watchdog like the auto path | U (`install_opts` for each caller) |
| F15 | A proof admitted between the last idle sample and `begin_quiesce` | killed, as in 1.1.3; a window of one file write | **Residual** |
| F16 | Quit or restart during the download or the wait | nothing recorded (both sit before `record_pending`) | structural; stated in code |
| F17 | Two instances both auto-install | `updater.lock` makes one return early; its claim is released | covered by F2; `updater.lock` is unchanged |
| F18 | A redundant instance (lost the bind) auto-installs while the serving instance proves | the serving instance's running proof continues: bb reaping is per process (`bb.rs:691`), and the locked plugin renames the old AppImage and `.app` aside rather than signalling anyone (plugin `updater.rs:1074`, `:1326`) | **Residual**, reasoned in Algorithms; codex confirmed |

### G. Presenting the prompt

| # | Situation | Required behaviour | Test |
|---|---|---|---|
| G1 | The gate became busy after `slot.set` ("Update Now" was clicked) | not presented | U (`should_present`) 🧬 |
| G2 | A scheduled check and a snooze recorded after `decide` | not presented | U |
| G3 | A live manual check and a snooze | presented | U |
| G4 | `prompt_action(open_version, target, focus)`: absent / same version / different version | `Open` / `FocusOnly` if focus, else `Nothing` / `Repoint` | U 🧬 always re-point (a reload resets the prompt's click-steal guard) |
| G5 | The re-point URL | keeps the live scheme and path; rewrites only `current` and `version`, URL-encoded; one function shared with `Reprompt::navigate` | U 🧬 |
| G6 | The window call fails | no "presented" log; a live manual request replies `Failed` | U (the reply mapping) |
| G7 | Window creation on the main thread | refused at runtime: the presenter compares the current thread with the recorded main `ThreadId`, logs, and returns `false` | U (`presenter_allowed(current, main)`) 🧬; the real Windows presentation runs in the Windows `prompt` smoke (L9). `update-wiring.test.ts` keeps a lexical tripwire only (it cannot see through a helper) |
| G8 | Real focus on each OS | **Residual**: no lane observes focus; it reuses Settings' `set_focus` path, which is already shipped |

### H. Answering the prompt

| # | Situation | Required behaviour | Test |
|---|---|---|---|
| H1 | "Later" on the pending version | snooze persisted, item retained, prompt closes | I (real slot, real file) |
| H2 | "Later" with a forged future or stale older version | `Reprompt`, nothing written | I 🧬 |
| H3 | "Later" with an empty slot | closes | I |
| H4 | "Later" with a failing write | closes; logged; no panic; the session mirror still defers that version (B15) | I |
| H5 | Restart chain: `set(v2)` → Later(v2) → new store on the same path → `decide(Available(v2), None, Launch, …)` and v3 | `SetOnly` for v2; present for v3 | I 🧬 |
| H6 | ✕ | nothing persisted (A1); the prompt may return at the next due check | unchanged path; `update-prompt.spec.ts` |
| H7 | `ScheduleStore` or `InstallGate` somehow not managed | the command still works: `try_state` falls back to 1.1.3 behaviour ("Later" closes; "Update Now" uses a local, uncoordinated gate) | S 🧬 the `.manage()` calls sit in the `Builder` chain beside `PendingUpdate`; `respond_update_prompt` gains no `State<` parameter (an unmanaged `State` fails the whole command, `state.rs:60-69`) |
| H8 | Frontend IPC shape | unchanged | `update-prompt.spec.ts` green, unedited |
| H9 | Clicking Later in a release binary | **Residual**: no lane can click a prompt in a release binary; H1–H5 and H8 cover the logic and the IPC contract |

### I. Tray item and label controller

| # | Situation | Required behaviour | Test |
|---|---|---|---|
| I1 | Click | "Checking…", disabled, before the backend is polled | U |
| I2 | Replies `UpToDate`, `Failed`, `Installing`, `Presented` | the matching label and enabled state; `Presented` ends at Idle | U |
| I3 | Double click | one backend call | U 🧬 drop the single-flight check |
| I4 | Channel full or closed | `Failed` at once | U |
| I5 | No reply | `Failed` at 90 s; the dropped receiver makes the task skip or unfocus the request (C11, C12) | P 🧬 |
| I6 | Revert after 5 min | back to "Check for Updates…" | P |
| I7 | A stale revert and a new click, drained in both orders | "Checking…" wins | U 🧬 check the generation outside the posted closure |
| I8 | Label writes after the click | always posted via `run_on_main_thread`; the click's inline write is safe because runtime-wry runs a main-thread post inline (F16) | U (queue `UiThread`) |
| I9 | `menu_layout(dev, has_check)` | `check_updates` after `version_info` iff `has_check`, in both variants | U 🧬 |
| I10 | `tray_item_enabled(poll_allowed, webdriver)` | table; `PRESTO_NO_UPDATE` removes the item | U |
| I11 | Item creation fails | logged; tray built without it | code review; no `?` on that path |
| I12 | `tokio::spawn` from the menu callback (no runtime context: a panic, then an abort) | never used | S: a lexical tripwire (`tokio::spawn(` absent from `update_menu.rs` and the tray handler); the real safety net is I14, whose click would abort the WebDriver app |
| I13 | `on_tray_menu` | routes `check_updates`; existing ids unchanged | U |
| I14 | The whole path in a real app: click → channel → `run_updates` → `decide` → reply → label | exercised end to end with a stub `check`. Each stubbed outcome is held behind a handshake the driver releases only after it has observed "Checking…" and dispatched the duplicate click, so the transient state is always observable | W 🧬 remove the `check_updates` arm |

### J. Wiring, lifecycle, panics

| # | Situation | Required behaviour | Test |
|---|---|---|---|
| J1 | Any `unwrap`, `expect`, `panic!`, indexing or unchecked arithmetic in the new modules (`panic = "abort"` makes one a crash, and a startup one a crash loop) | rejected | S: `#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::indexing_slicing, clippy::arithmetic_side_effects)]` at the top of `update_schedule.rs` and `update_menu.rs` (their `#[cfg(test)] mod tests` re-allow them); clippy runs in CI 🧬 insert an `unwrap` |
| J2 | `PRESTO_NO_UPDATE` / debug builds | no update task, no tray item (unchanged kill switch) | U (I10) |
| J3 | WebDriver builds | `run_updates` runs with a stub `check` and `ScheduleStore::new(None, …)`, so it never touches `~/.presto`; the stub never returns `Available`, so the prompt never opens and the `Showing update prompt` guard stays green | W; S (the stub lives in `e2e_tray.rs`) |
| J4 | Two instances on macOS and Linux | two update tasks, pre-existing; installs serialised by `updater.lock`; the schedule file locked (B14); proofs unaffected (F18) | B14; F18 residual |

### K. Test hooks never reach users

| # | Situation | Required behaviour | Test |
|---|---|---|---|
| K1 | `mod e2e_tray;` | `#[cfg(feature = "webdriver")]` | S 🧬 delete the cfg |
| K2 | `PRESTO_E2E_` literal, the stub queue, the 2 s revert | only in `e2e_tray.rs` | S 🧬 |
| K3 | `[features] default` | never enables `webdriver`, directly or transitively | S 🧬 |
| K4 | `release-presto.yml` artifact builds | never pass `--features webdriver` | S 🧬 |
| K5 | Shipped binaries | the N and N-1 release binaries built by the ephemeral smokes do not contain the bytes `PRESTO_E2E_TRAY_REPORT`; the WebDriver binary in `_e2e-webdriver.yml` does (teeth) | X + W 🧬 build N with `--features webdriver` |

### L. CI and the gates themselves

| # | Situation | Required behaviour | Test |
|---|---|---|---|
| L1 | A free-form `mode` input | reaches shell only through `env:`; the first step allowlists it | S (`release-contract.test.ts`) 🧬 interpolate `${{ inputs.mode }}` in a `run:` |
| L2 | `smoke-updater-unix.yml` | `contents: read`; no `secrets.`; never uploads a bundle (they carry a throwaway key, so an installed copy could never update) | S 🧬 |
| L3 | `tray-update.spec.ts` | listed in `wdio.conf.ts`; the Phase 4 gate greps its name among the passing specs in the run log | S + W 🧬 omit it from the list |
| L4 | The production menu variant under WebDriver (only the release gate runs it) | run before merge: locally on Linux (`--release --features webdriver`, `xvfb-run`), or a temporary release-mode leg in `presto.yml`'s dispatch removed before the PR | W |
| L5 | The tray spec's timing | waits on each state change with a deadline, never a fixed sleep | code review |
| L6 | A merge while `release-presto` runs fails that release's tag push (`lessons.md`) | both merges wait until no `release-presto` run is in progress | gate step |
| L7 | The new code as N-1 auto-updates to N; a tampered N is refused | positive and **negative** runs against the feature branch on all three OSes; the negative mode now also requires N-1 to still answer `/health` at the end (today a crashed N-1 passes) | X. The existing tamper appends a byte, which the signed-size check (`updater.rs:399`) rejects before signature verification matters; a same-length tamper is a follow-up, since this change does not touch verification |
| L8 | N writes the schedule file on its own launch | `assert-update-schedule --by N --since t_n` | X; the script's own tests include **written by N-1** 🧬 |
| L9 | `prompt` mode | presented → the `Update snoozed` line → no re-prompt within 30 s → a lower-version snooze → re-prompt | X |

### What is honestly not covered

- Real sleep and wake. It is simulated by a wall-clock jump in paused time (C4); no lane suspends a machine.
- Native tray clicks. The driver posts the same dispatch a native click reaches (I14).
- Real window focus (G8), and clicking "Later" in a release binary (H9).
- A real Linux desktop tray under Wayland (an existing follow-up).
- A regular file on a stalled network filesystem.
- Which layer rejects a tampered artifact in the negative smoke (see L7).

## Phases

**Gate prerequisite, once per worktree:** `bun run --cwd packages/presto frontend:build` and the bb sidecar (I5).

**Execution order:** Phase 0 (its own PR) → **arc 1**: 1, 2, 5, 6 (arc 1's docs) → **arc 2**: 3, 4, 6 (arc 2's docs and the close-out). Phase numbers are kept so the matrix and audit references stay valid.

**Mutation rule:** every test marked 🧬 must **fail** against the unmodified code or a named one-line mutation, then pass. Log each red→green pair in `lessons/phase-N.md`.

**Test-writing rules:**
- No mode-000 fixtures, because root bypasses them.
- Force write failures with a `#[cfg(test)]` write-failure switch on `ScheduleStore`, so the file stays readable. The parent-is-a-file fixture is used only where no file needs to exist.
- FIFO tests follow B4's harness exactly (a thread, `recv_timeout(1 s)`, a non-blocking rescue open, then join). An in-runtime timeout cannot interrupt a blocked synchronous `open`, and no thread may leak.
- End every `run_updates` test with `handle.abort()` followed by awaiting the handle. Dropping a `JoinHandle` detaches the task; it does not stop it.
- Bound every paused-time wait with `advance` or a paused-time `timeout` (see the matrix's C section).
- Row IDs from the matrix go in each test's name or doc line, so a reviewer can map tests back to rows.
- No test may self-skip.

### Phase 0 — Bootstrap PR (a separate branch from `main`) ✓

**Assumes:** F10, F12, A2.

**Steps:**
1. Branch `update-check-smoke-bootstrap` from `main`.
2. Add `smoke-updater-unix.yml`: dispatch only; `contents: read`; a matrix over `macos-latest` (DMG) and `ubuntu` (AppImage; Xvfb and system packages copied from `_e2e-updater-linux.yml`); inputs `mode` (`type: string`, default `positive`) and `n-version`. A first step rejects any mode outside this ref's supported list (`positive`, `negative`). Each leg:
   - generates a throwaway key and patches the pubkey;
   - builds N-1 = 0.0.1 and N from the ref;
   - synthesises and signs the feed (`sign-smoke-feed.sh`);
   - runs the platform script.
3. In `smoke-updater-windows.yml`, a manual workflow that no release lane calls, change `mode` from `choice` to `type: string` and add the same first-step allowlist (`barrier`, `copy-initiator`, `positive`, `negative`). Arc 1's copies later add `prompt`, so it dispatches no matter how GitHub validates inputs.
   - In both workflows the free-form input reaches shell only through `env:` (`MODE: ${{ inputs.mode }}`, then `"$MODE"` / `$env:MODE`). No `run:` block interpolates `${{ inputs.* }}`, before or after the allowlist step, so a crafted value cannot inject script.
4. Extend `release-contract.test.ts` for both manual smoke workflows: L1 (inputs only through `env:`, allowlist first) and L2 (`contents: read`, no `secrets.`, no bundle upload).
5. Have codex review the concrete workflow files (`/codex high`, adversarial and least-privilege ask), and apply its findings.
6. Open the PR. Once checks are green and no `release-presto` run is in progress (L6), auto-merge it (A2).

**Validation gate:**
- **Commands:**
  - `bun run lint:actions`
  - the codex review clean
  - the PR checks green
  - after merge, `gh workflow run smoke-updater-unix.yml --ref main -f mode=positive`, watched with `gh run watch <id>`
- **Pass:** the post-merge dispatch on `main` is green on both legs. That is the workflow's first real run; it cannot run before merge, and it proves the harness against *current* code, the "before" picture. Record the run ID. A harness failure is fixed in arc 1, since a dispatch with `--ref` uses that branch's copy.
- **Layers:** lint; e2e on real binaries (macOS, Linux).

### Phase 1 — `update_schedule` in presto-core ✓

**Assumes:** F1, F5, F14, F20.

**Steps:**
1. Split out `write_private_atomic`.
2. Add the constants and pure functions, with the panic-free `deny` lints at the top of the module (J1).
3. Extract the exclusive-lock helper from `config.rs` (mechanical; `acquire_config_write_lock` delegates). Add the store (file lock, both mirrors), `InstallGate`, `run_claimed`, `StallWatch`, `wait_until_idle`, `install_opts` and `download_guarded`.
4. Add `run_updates`, returning `Infallible`.
5. Add `HeadlessState::prover_idle()` in `server.rs`.
6. Write the tests below alongside each step.

**Tests:** matrix rows **A1–A9, B1–B16, C1–C15, F1, F2, F7–F9, F11–F14**, plus every existing `config` test unmodified.

**Validation gate:**
- **Commands:**
  - `cargo test --locked --manifest-path packages/presto/core/Cargo.toml`
  - `bun run lint:rust`
  - `bun run lint:clippy`
  - from `packages/presto/src-tauri`: `cargo check --target x86_64-pc-windows-gnu --lib`
- **Pass:** all exit 0; every existing `updater_state` test passes unmodified; every 🧬 red→green is logged.
- **Layers:** lint, unit, integration (real filesystem).

### Phase 2 — Classify-only check, record-then-act, the slot, snooze ✓

**Assumes:** F2, F3, F6, F9, F13, F17, F19, F20, A4, A5, A6.

**Steps:**
1. In `updater.rs`: `CheckOutcome`, `CheckMode`, `OutcomeKind`, `Decision`, `decide`, `should_present`, `prompt_action`, the feed timeout, `spawn_install` (taking core's `InstallOpts`).
2. In `perform_update`, replace the direct `update.download(...)` with `download_guarded(...)`, passing `install_opts` for the caller. Nothing else in the function moves.
3. In the `commands.rs` slot: `clear()`, the snooze matching and the URL rewrite shared with `Reprompt::navigate`. Add `handle_later` and `handle_update_now`. The arms read `ScheduleStore` and `InstallGate` through `app.try_state`, with the fallbacks in Algorithms; `respond_update_prompt`'s signature does not change.
4. In `main.rs`:
   - `.manage()` `Arc<ScheduleStore>` (writer = the desktop crate's `CARGO_PKG_VERSION`) and `Arc<InstallGate>` in the `Builder` chain beside `PendingUpdate`;
   - `check`, which only fetches and classifies; `busy` (the gate) is passed to `run_updates`, which skips `check` while it holds (C15);
   - `act`, which executes `decide` on the update task, claims and installs through `spawn_install`, logs the `Update snoozed` line for `SetOnly`, and replies to live manual requests (a failed send is ignored);
   - the presenter (`should_present`, the existing `Showing update prompt` line, `show_update_prompt_window(...) -> bool`, then the "presented" line);
   - the poller → `run_updates`, spawned iff `should_poll_for_updates()`. Arc 2 adds the WebDriver case: those builds spawn it from `e2e_tray.rs` with the stub `check`, always, so the tray item never talks to a closed channel;
   - the manual channel (capacity 4). Its sender is managed state; nothing sends on it until arc 2.
5. Add `update-wiring.test.ts` (G7, H7).
6. Refresh the doc comments.

**Tests:** matrix rows **D1, D3–D4, E1–E13, F3–F6, G1–G7, H1–H5, H7, H8** (H8: `update-prompt.spec.ts` green, unedited). The static guards G7 and H7 live in `update-wiring.test.ts`; I12 joins them in Phase 3, with `update_menu.rs`.

**Scope of command coverage.** The `respond_update_prompt` wrapper (`require_label` plus a match on `LaterOutcome` or `UpdateNowOutcome`) has no Rust test; commands are typed on the Wry runtime, and the repo has no mock-runtime harness. Its IPC contract stays pinned by `update-prompt.spec.ts`, its logic by `handle_later` and `handle_update_now`, and its signature by H7.

**Validation gate:**
- **Commands:**
  - the Phase 1 commands;
  - `cargo test --locked --manifest-path packages/presto/src-tauri/Cargo.toml`
  - `cargo clippy --locked --manifest-path packages/presto/src-tauri/Cargo.toml --all-targets --features webdriver -- -D warnings`
  - `bun run --cwd packages/presto test:e2e:ui`
  - `bun run test`
- **Pass:** all exit 0; `update-prompt.spec.ts` is green unedited; clippy is clean under both feature sets.
- **Layers:** lint, typecheck, unit, integration, UI e2e (mocked IPC).

### Phase 3 — Tray "Check for Updates…" ✓

**Assumes:** F7, I2.

**Steps:**
1. Add `update_menu.rs` with `UiThread`, backed in production by `run_on_main_thread`.
2. Add `menu_layout` and the `build_tray_menu` parameter.
3. Create the item in `setup_desktop`, gated, degrading gracefully if creation fails.
4. Add the `on_tray_menu` dispatch and the production backend (`try_send` to the update task, then await the reply). The WebDriver stub arrives with `e2e_tray.rs` in Phase 4.
5. Add I12's lexical tripwire to `update-wiring.test.ts`.

**Tests:** matrix rows **I1–I13** (recording sink, queue `UiThread`, paused time).

**Validation gate:** the Phase 2 gate, with the new tests green and every 🧬 logged.
- **Layers:** lint, typecheck, unit.

### Phase 4 — WebDriver tray E2E and static guard ✓

**Assumes:** F4, F8, F11, I2, I4.

**Steps:**
1. Add `e2e_tray.rs` holding every test hook: the stub `check` and its queue, the 2 s revert, `ScheduleStore::new(None, …)`, and the driver. The driver script:
   1. Record Idle.
   2. Queue `UpToDate`, post `on_tray_menu(app, "check_updates")` through `run_on_main_thread`, poll until "Checking…" and disabled, post a second click, then poll until "Up to date".
   3. Poll until the 2 s revert shows "Check for Updates…".
   4. Queue `Failed`, dispatch, and poll until "Couldn't check — try again".
   5. Write `{steps, stub_calls, menu_has_item}`. `stub_calls` counts manual calls only; the launch check's stub call is recorded separately.

   Each queued outcome waits on a handshake: the driver releases it only after observing "Checking…" and dispatching the duplicate click (I14).
2. `tray-update.spec.ts` polls for the report (≤ 60 s) and asserts the exact `(text, enabled)` sequence, `stub_calls == 2` and `menu_has_item`. Add it to `wdio.conf.ts` before `autostart.spec.ts` (L3).
3. In `_e2e-webdriver.yml`, export `PRESTO_E2E_TRAY_REPORT=$RUNNER_TEMP/tray-report.json` from the Launch step for all modes, and assert the WebDriver binary contains that string (K5's teeth).
4. Add `webdriver-only-hooks.test.ts` (K1–K4).
5. **K5, in the three smoke workflows' build steps:** assert the N-1 and N release binaries do not contain the bytes `PRESTO_E2E_TRAY_REPORT` (on Linux, grep the `--appimage-extract` payload, since the AppImage is compressed). The string first exists in this arc.
6. Run the production menu variant under WebDriver before merge (L4): locally on Linux with `cargo build --release --features webdriver` and `xvfb-run`, or, if this host lacks the GTK/WebKit stack, a temporary `mode: release` Linux leg in `presto.yml`'s dispatch that is removed before the PR opens (verified by `git diff main -- .github/workflows/presto.yml`).

**Tests:** matrix rows **I14, J3, K1–K5, L3–L5**.

**Validation gate:**
- **Commands:**
  - `bun run test`
  - `bun run lint:actions`
  - the Phase 3 cargo commands
  - `gh workflow run presto.yml --ref update-check-schedule-tray`, watched to completion
  - with `--ref update-check-schedule-tray`: `gh workflow run smoke-updater-windows.yml -f mode=positive` and `gh workflow run smoke-updater-unix.yml -f mode=positive` (this arc's N-1 must still update itself; K5 runs in their build steps)
- **Pass:**
  - the dispatched run is green;
  - `tray-update.spec.ts` appears among the passing specs in the logs of the three dev-mode legs and built-debug (grep the spec name, L3);
  - the `Showing update prompt` guard passes;
  - the production-variant run (step 6) passes;
  - the positive smokes are green on three OSes and K5 holds for every release binary built;
  - the run IDs are recorded.
- **Mutations:** 🧬 removing the `check_updates` arm fails the spec, run locally or in one dispatched run. 🧬 Deleting the cfg line, or adding `webdriver` to `default`, fails the static guard.
- **Layers:** lint, unit, e2e (real app, three OSes).

### Phase 5 — Updater smokes ✓

**Assumes:** F2, F10, F15, F21, I3.

**Steps:**
1. Write `assert-update-schedule.ts <file> --by <version> --since <unix> --wait <s>`. It passes iff the file is at most 4 KiB of JSON with `schema == 1`, `last_checked_by == <version>`, and an integer `last_checked_at` within `[since − 5, now + 120]`.
   - Tests: fresh; missing; stale; future; garbage; schema 2; oversized; **written by N-1** 🧬.
   - In the ephemeral lanes N-1 also writes this file before installing (codex round 2 finding 3). `--by N` together with `--since` set to the time `/health` first reported N attributes the write to N's own launch check.
2. In all three scripts:
   - **Positive:** after `/health` first reports N at `t_n`, run `assert-update-schedule --by N --since t_n --wait 90`.
   - **Negative:** additionally require that `/health` still reports N-1 at the end, so a crash can no longer pass (L7).
   - **New `stall` mode** (unix scripts and `smoke-updater-unix.yml` only; the watchdog is platform-neutral code): `updater-feed-server.ts --stall-after <bytes>` serves that many bytes of the artifact and then holds the connection open. Assert F10b: the stall line within 60–120 s, N-1 still healthy, and no `pending` in `updater-state.json`. The feed server's flag gets a unit test in `serve-static.test.ts`'s style.
   - **Mode allowlist:** each script rejects unknown modes explicitly. The `.ps1` gains the allowlist it lacks, listing every mode the release and manual workflows pass.
   - **New `prompt` mode**, added to both manual workflows' first-step allowlists. Each launch's lines are read from that launch's own stdout file where the script owns stdout (Linux), otherwise from `log_dir()` starting at the byte offset recorded just before that launch. A daily log rotation mid-run makes the check fail, never pass.
     1. Seed `auto_update: false` and completed onboarding.
     2. Launch N-1 and wait for `Update prompt presented version=N` in `log_dir()` (F15), logged only after the window call succeeds. Kill the app by process group.
     3. Write a valid schedule file with a snooze for N (`until = now + 24 h`). Relaunch, wait for the `Update snoozed; prompt suppressed version=N` line, and assert that no new `Update prompt presented` appears within 30 s after it.
     4. Change the snooze to a lower version. Relaunch and assert that the prompt is presented again.

   `prompt` mode runs only in the ephemeral workflows, where N-1 carries the new code. It proves presentation and snooze suppression across restarts in real binaries. The Later click itself is covered by `handle_later` and `update-prompt.spec.ts`; no lane can click a prompt in a release binary.


**Validation gate:**
- **Commands:**
  - `bun run test`
  - `bun run lint:actions`
  - `docker run --rm -v "$PWD:/mnt" -w /mnt koalaman/shellcheck:v0.9.0 packages/presto/scripts/*.sh`
  - with `--ref worktree-update-check-schedule`:
    - `gh workflow run smoke-updater-windows.yml -f mode=positive`, then `-f mode=negative`, then `-f mode=prompt`
    - `gh workflow run smoke-updater-unix.yml -f mode=positive`, then `negative`, `prompt` and `stall`
- **Pass:**
  - all green on three OSes;
  - the positive logs show N-1 built from this branch auto-updating to N and N writing a fresh schedule file;
  - the negative logs show the download refused and N-1 still healthy;
  - the prompt logs show prompt → snoozed → re-prompt for a newer version;
  - the stall logs show the stall line, N-1 healthy, and no `pending`;
  - run IDs are recorded.
- **Layers:** e2e on real release-profile binaries, three OSes, local HTTPS feed.

### Phase 6 — Docs and follow-ups ✓

Each arc documents what it ships.

**Arc 1:**
- `CLAUDE.md`: the Presto bullet (6 h wall-clock checks, the 24 h snooze, install safety) and the Testing counts.
- `UPDATER_TESTING.md`: the unix smoke, the `prompt` and `stall` modes, and the schedule assertion.

**Arc 2:**
- `CLAUDE.md`: the tray item and the Testing counts.
- `follow-ups.md`:
  - consolidating the ephemeral smoke setup;
  - a same-length tamper in the negative smokes, so they prove signature verification rather than the size check (L7);
  - the uncovered items listed at the end of the matrix, if any is worth a lane.
- The close-out (Post-implementation step 5).

**Validation gate:**
- **Commands:** `bun run test`, `bun run lint:actions`, and `git grep -nE '/k/[0-9a-f]{32,}'`.
- **Pass:** the first two exit 0, and the grep prints nothing (its exit 1 means no match, which is the pass).

## Post-implementation

1. **No `/code-review`** (`code_review: off`).
2. **Arc boundary loop, after arc 1's phases and again after arc 2's.** Call `/codex high` over the arc's diff (arc 1 from its merge base with `main`, arc 2 from arc 1's head). Include `plan.md`, `recon.md`, the Alternatives-not-taken list as the decision ledger, and the arc map ("arc N of 2; arc 1 ships the scheduler, the snooze and install safety; arc 2 adds the tray item on arc 1's manual channel"). Ask for adversarial review ("What could go wrong? What would an attacker target? What are we trusting that we shouldn't? Where are the supply-chain / crypto / least-privilege weaknesses?"), focused on:
   - panic and hang paths under `panic = "abort"`, including the stall watchdog and the idle-prover wait;
   - every matrix row marked 🧬 in the arc: does its test actually fail against the named mutation;
   - anything that could suppress the launch check;
   - B2 seal integrity;
   - main-thread deadlock;
   - webdriver-hook isolation (arc 2).

   Include verbatim:
   - *"Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone."*
   - *"Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact."*
3. **Fix loop.**
   1. Verify each claim against the repo.
   2. Apply the accepted fixes and commit them.
   3. Log the round in `lessons/arc-N-review.md`, including rejected findings with reasons.
   4. **Resume the same codex session** with the fix diff.
   5. Repeat until a round has no new material findings; stop and surface to the user after 3 rounds.
   6. If a fix touches Rust or workflows, re-run the arc's dispatches (arc 1: Phase 5; arc 2: Phase 4).

   Only after arc 1's loop converges: `gh stack add update-check-schedule-tray`.
4. **Cross-arc pass.** A fresh `/codex high` session over the net diff from arc 1's merge base, asking for seams between the arcs, duplication across them, and drift from this plan, with the same two rules. Same loop, logged in `lessons/cross-arc.md`. If it changes arc 1, `gh stack sync` and re-run both arcs' dispatches.
5. **Close-out, in arc 2's PR:** the `## Outcome` block after the front matter; promote the generalizable gotchas to `implementations-plan/lessons.md`; move open follow-ups to `follow-ups.md` (Phase 6). Archive after both PRs merge.
6. **Delivery** (below). This is the first time either feature PR is opened.

**Post-implementation hardening:** no `/harden` (A3); the trust anchors are untouched.

## Delivery

The bootstrap PR, then two arcs stacked with `gh stack`. `code_review: off` everywhere.

| Arc | Branch | Phases | Stacks on | Merge |
|---|---|---|---|---|
| Bootstrap | `update-check-smoke-bootstrap` | 0 | `main` | auto-merge once green and the codex review is clean (A2) |
| 1 — scheduler, snooze, install safety | `worktree-update-check-schedule` (adopted as layer 1: `gh stack init --adopt worktree-update-check-schedule`) | 1, 2, 5, 6 (arc 1) | `main`, after merging the bootstrap | the owner's call, squash |
| 2 — tray item | `update-check-schedule-tray` | 3, 4, 6 (arc 2) | arc 1 | the owner's call, squash |

- **Arc 1 alone ships:** checks every 6 h of wall-clock time; "Later" as the 24 h per-version snooze (A1, A4); the install gate, the stall watchdog and the idle-prover wait (A5, A6); re-pointing an open prompt and clearing a withdrawn version. The tray does not change. A release cut from `main` between the arcs is complete on its own.
- **The snooze is in arc 1**, not in arc 2 as the approval-gate sketch had it. Without it, the 6 h cadence would re-prompt someone who clicked "Later" every 6 h, twice as often as 1.1.3, which breaks Outcome 1.
- **Arc 2 adds** the tray item, its labels and its WebDriver test, a manual click presenting and focusing the prompt, and K5.
- Roll back arc 2 before arc 1.
- Neither feature PR merges while a `release-presto` run is in progress (L6; `gh run list --workflow release-presto.yml --status in_progress` must be empty).
- Both PRs open only after arc 2's loop and the cross-arc pass converge: `gh stack sync` if `main` moved, `gh stack submit --auto`, `gh pr edit` each body, then `gh pr checks --watch`. Arc 1's body links the Phase 0 and Phase 5 run IDs; arc 2's links the Phase 4 runs and the test-bundle run. `gh stack merge` is the owner's call.

**Owner acceptance (arc 2; recommended, not a loop gate).**
- The approved view of the tray item is the ELI5's menu mockup (placement per I9: below the version line). The prompt window itself is unchanged (Scope: Out), so it needs no new sign-off.
- After the cross-arc pass, dispatch `gh workflow run build-test-bundle.yml --ref update-check-schedule-tray -f platform=all` (which also runs the automated packaged acceptance) and link the run in arc 2's body.
- The owner installs a bundle and checks: the item's place in the menu; a click greys it and shows "Checking…", then "Up to date"; offline, "Couldn't check — try again"; the label resets after 5 min.
- Limits: a bundle carries the source version (1.1.4-rc.1 today) and the live feed serves an older one (1.1.3), so no prompt appears by hand and "Installing update…" is unreachable. Those paths are proven by Phases 4 and 5 only.
- Installing a bundle replaces the installed Presto, and the test build will not update down to the live version. Reinstall the live release afterwards.

## Seeds

ELI5 Artifact: https://claude.ai/artifact/94rXWE4PzdHaN9a9rHH6rL · source: `implementations-plan/update-check-schedule/eli5.html` (gitignored; republish that path to keep the URL).

```
/goal All phases 0–6 marked ✓ in implementations-plan/update-check-schedule/plan.md, each ✓ backed by that phase's validation gate reported passing in the transcript. Phase 0: a green smoke-updater-unix.yml positive run ID on main after the bootstrap PR merged. Arc 1 (phases 1, 2, 5, 6) on worktree-update-check-schedule: green positive, negative and prompt run IDs for smoke-updater-windows.yml and positive, negative, prompt and stall run IDs for smoke-updater-unix.yml. Arc 2 (phases 3, 4, 6) on update-check-schedule-tray: a green dispatched presto.yml run ID with tray-update.spec.ts among the passing specs on macOS, Linux and Windows, the production-variant WebDriver run, and green positive run IDs for both smoke workflows with K5 holding. Every 🧬 red→green logged in lessons; for each phase `LESSONS_FILE=implementations-plan/update-check-schedule/lessons/phase-N.md` printed. /code-review NOT run (code_review: off). Each arc's codex loop and the cross-arc codex pass converged, each evidenced by a resumed codex pass reporting no new material findings quoted in the transcript. A build-test-bundle.yml platform=all run ID at arc 2's head. Then both PRs opened with gh stack submit --auto (gh pr view output for each in the transcript) with gh pr checks green; `bun run test` and `bun run lint:actions` exit 0 in the transcript. Never merge either feature PR, release, or expand scope beyond plan.md.
```

```
/loop 15m Drive implementations-plan/update-check-schedule forward. Never idle waiting for my input. Each firing:
1. Reality check: read plan.md (Outcome & Quality Bar first — judge every step against it; then Delivery for which arc owns which phase) and lessons/. Archived or carrying an ## Outcome block → STOP. Empty task list → rebuild from plan.md's execution order (0 → arc 1: 1, 2, 5, 6 → arc 2: 3, 4, 6). Run git status, git branch --show-current and git log --oneline -5; check the bootstrap PR (gh pr view) and the latest dispatched runs (gh run list --limit 5).
2. Waiting on a dispatched run or the bootstrap merge is fine — gh run watch <id> up to 10 min; stuck past that → inspect logs, log in lessons. Use the wait to strengthen tests or prep the next phase.
3. No task in hand? Take the next step of the current phase, on the current arc's branch. After each edit run the fast layers (cargo test for the touched crate, bun run lint:rust, bun run lint:clippy); commit with SSH_AUTH_SOCK= and push the branch.
4. Stuck or facing a decision? /codex high with full context until you reach a defensible call; log it in lessons. Hard limits: never merge either feature PR, never release or promote a feed, never touch the production updater key, never add an IPC command or ACL grant, never make the launch check conditional, never hold a lock across a main-thread call, never merge while a release-presto run is in progress, never expand scope beyond plan.md.
5. Same step failed 5 times? Reassess with codex, then continue.
6. Phase green = its validation gate in plan.md passes with every 🧬 red→green logged. Paste the result, mark ✓ in plan.md, write lessons/phase-N.md, print LESSONS_FILE=…, advance.
7. Arc 1's phases ✓? Run its arc boundary loop (plan.md Post-implementation 2–3: /codex high, adversarial ask, the no-over-engineering and comment-quality rules, resume the same session until clean, 3 rounds max, then surface). Then gh stack add update-check-schedule-tray and start arc 2.
8. Arc 2's phases ✓? Its arc loop, then the fresh cross-arc pass, then the close-out in arc 2, then the build-test-bundle dispatch, then gh stack submit --auto, gh pr edit each body, gh pr checks --watch, and a wrap-up report explaining every contentious decision plainly. Surface and stop.
```

## Audit log

### Codex round 1 — `reject` (session `01a0f28a-b50f-76b0-bc23-73e0abf34ce2`, GPT-6 Astra, high)

| # | Finding | Disposition |
|---|---|---|
| 1 H | A new `workflow_dispatch` file can't be dispatched before it is on `main` | **Adopted**: bootstrap PR (Phase 0, A2); F12 |
| 2 H | "Later" snoozes any syntactically valid version | **Adopted**: `snooze_or_reprompt` binds the snooze to the verified, displayed pending version; forged and stale cases tested |
| 3 H | Existing prompt not focused or re-pointed; concurrent checks can store an older candidate | **Adopted**, **modified**: fetch-sequence ordering instead of highest version (the rollback lever); `present_with` re-points and, on manual checks, focuses |
| 4 M | Retry semantics unclear; a future-dated unwritable file defeats the mirror | **Adopted**: `effective_last_check` normalisation; retry-while-due stated and tested |
| 5 M | `reached_feed` mixes fetch and install; recording after install never happens on success | **Adopted**: check classifies only; record before act; early `perform_update` returns documented |
| 6 M | Generation check not atomic with the label write | **Adopted**, **redesigned**: a mutex would deadlock against Tauri's blocking off-main-thread `set_text`, so all transitions run on the main thread; interleaving test |
| 7 M | Driver could bypass dispatch; no availability→prompt→Later→restart chain test | **Adopted**: the driver calls `on_tray_menu`; chain integration test; `prompt` smoke mode on real binaries |
| 8 M | Guard misses default features; no runtime proof | **Adopted**: feature-graph assertion; every smoke asserts that no tray report appears |
| 9 M | Tray item creation can abort setup; a FIFO can block reads | **Adopted**: optional item, non-blocking open plus handle `fstat` |
| 10 L | Read-only fixture self-repairs; mode 000 needs non-root; `git grep` exit code | **Adopted**: parent-is-a-file injection, no mode-000 tests, gate wording |
| Facts | F4 overstated; recon fact 10 wrong; F11 is dev + built-debug | **Adopted**: F4, F5, F11 corrected; production menu covered by `menu_layout` |
| Asks | Later for auto users; A2 "only way"; tampering bound per write | **Adopted**: A4 added; A2 reworded; the Security wording states the per-write bound |

### Codex round 2 — `reject` (same session, resumed)

| # | Finding | Disposition |
|---|---|---|
| 1 H | `present_with` holds the slot lock across UI calls (deadlock against the main-thread prompt command) and leaks the version | **Adopted**: presenters show their own verified version; a main-thread closure checks `is_current(seq)`; no new version accessor |
| 2 H | Sequencing doesn't clear a withdrawn version; the watermark is lost on take | **Adopted**: every successful observation runs `observe(seq, …)` before routing; `None` clears; the watermark is never lowered; tests for both |
| 3 M | N-1 now writes the timestamp, so the N assertion is unattributable; report absence checked too early | **Adopted**: `last_checked_by`, `--by N --since t_n`, and an N-1-written fixture 🧬; absence checked after ≥ 30 s of N uptime |
| 4 M | `prompt` smoke never presses Later and matches a pre-window log line and old log lines | **Partly adopted**: logs after the window call succeeds; per-launch log offsets; `handle_later` extracted and tested with a real slot and file. Pressing Later in a release binary has no harness; the residual is stated in Phase 2 |
| 5 M | Bootstrap publishes `prompt` before its implementation; "first proven" wording | **Adopted**: bootstrap has `positive`/`negative` only; `prompt` and the `.ps1` allowlist arrive with the feature PR; A2 reworded (proven only after merge; a codex review of the file first) |
| 6 M | Dropping a `JoinHandle` detaches; parent-is-a-file can't model a readable future file; the FIFO mutation hangs in the runtime | **Adopted**: abort and await; a `#[cfg(test)]` write-failure switch; the FIFO test runs on a `std::thread` with a 1 s join timeout |
| 7 M | Two owners record the timestamp | **Adopted**: `ScheduleStore` owns the file and mirror; the loop records between `check` and `act`; a test proves act duration can't move the timestamp |
| 8 L | Scripted driver dispatch isn't on the main thread | **Adopted**: the driver posts `on_tray_menu` via `run_on_main_thread`; posting errors are logged |
| Facts | `perform_update` early returns aren't limited to lock or marker | **Adopted**: the Algorithms wording lists every early return |
| Inferences | I3 wording; fetch order is local; FIFO ≠ all filesystem stalls | **Adopted**: I3 reworded; the slot bullet states local order; the Security residual names stalled network filesystems |
| Asks | A2 "only way"; A4 race ordering | **Adopted**: A2 "cleanest way"; A4 states that a snooze affects only later decisions |

### Codex round 3 — `reject` (same session, resumed)

| # | Finding | Disposition |
|---|---|---|
| 1 H | Main-thread presentation would build the window on the main thread, a documented Windows deadlock | **Adopted by redesign**: presentation runs on the update task (a worker, as in 1.1.3); only menu-label writes go to the main thread |
| 2 H | `is_current` is check-then-act; consumption keeps a queued presentation "current" | **Dissolved by redesign**: one update task runs checks one at a time, so no concurrent observation exists. The remaining overlap with a user's answer (Later during a presentation) is narrowed by a snooze re-check and documented as a Low residual |
| 3 H | Auto-install ignores a rejected (stale) observation | **Dissolved by redesign**: sequential checks cannot deliver a stale result after a newer one. The install is spawned at a single point (the A4 boundary) |
| 4 M | Core's version is 0.0.0, so `last_checked_by` needs the app version | **Adopted**: `ScheduleStore::new(path, writer)`; test injects `9.9.9` 🧬 |
| 5 M | Uptime check impossible in negative/prompt modes; the webdriver guard would miss a renamed log | **Adopted**: uptime is measured on the surviving instance; the existing `Showing update prompt` line is kept, so the guard is unchanged |
| 6 L | `JoinHandle` has no join timeout | **Adopted**: channel plus `recv_timeout`, unblock via the FIFO's write end, then join |
| Inference | I6 fallback silently moves validation after merge | **Adopted**: `mode` becomes a string input with a per-ref allowlist step; I6 retired |
| Ask | Later-click residual | Codex: **acceptable, non-blocking**, provided the thin wrapper is reviewed; the post-impl codex loop reviews it |

### Codex round 4 — `conditional approve` (same session, resumed)

| # | Finding | Disposition |
|---|---|---|
| 1 H | `installing` covers only the auto path; "Update Now" spawns `perform_update` independently (`commands.rs:1089`) | **Adopted**: `InstallGate` with an RAII `InstallClaim`, taken by both paths through `spawn_install` / `handle_update_now` (claim before take); `act` re-checks the gate after a fetch; `updater.lock` stays the cross-process authority. Tests for a busy gate, early return and abort 🧬 |
| 2 M | Closed manual receiver and dropped replies unspecified | **Adopted**: `if manual_open` guard, scheduled checks continue after closure, reply sends ignored, the loop has no exit. Tests for closure (exit and spin mutations) and dropped replies |
| 3 M | "Within 30 s" contradicts queueing and the 90 s ceiling; an expired request can still prompt | **Adopted with a change**: Outcome states 30 s idle, ~60 s queued, 90 s ceiling, and what the 30 s does not cover. A request expired before its check is dropped. One that expires mid-check was **downgraded to `Scheduled`** rather than skipped at presentation; round 5 rejected that, see below |
| 4 M | A4's spawn boundary has a read-to-spawn gap | **Adopted (codex's alternative)**: A4's boundary is the decision's single snooze read, followed by the claim and spawn; A4 and Acting say so |
| 5 L | Update Now can also intervene between `slot.set` and presentation; "same instant" understates the window | **Adopted**: presentation skips when the gate is busy (`should_present`, tested); the residual names both answers and stalled I/O |
| Asks | A2 says "only" the Unix workflow; free-form inputs need env-var passing | **Adopted**: A2 names the Windows input change; Phase 0 routes `mode` through `env:` only |

### Codex round 5 — `reject` (same session, resumed; a confirmation pass on round 4)

| # | Finding | Disposition |
|---|---|---|
| 1 H | Downgrading an expired manual request to `Scheduled` lets an auto-update user's click auto-install without a prompt | **Adopted**: expiry yields `Manual(None)`, which keeps manual routing (Prompt, unfocused) and can never select AutoInstall. `decide` test with `auto_update = true` 🧬 |
| 2 M | `spawn_install` claims while `handle_update_now` returns a held claim; a second claim could fail after consuming the slot | **Adopted**: `spawn_install` takes an existing claim; `run_claimed` binds it inside the future; `Reprompt`/`Empty` drop the claim before UI work. Tests for drop before first poll, mid-await, normal return, and the full matched handoff 🧬 |
| Confirmed | Conditions 2 and 4 met; claim-before-take sound; no other race, deadlock or stranding path beyond the documented stalled-download and filesystem residuals | — |

### Codex round 6 — `approve` (same session, resumed)

| # | Finding | Disposition |
|---|---|---|
| 1 L | Stale `focus = manual` and `Manual(reply)` wording; a two-valued `CheckMode` cannot carry focus | **Adopted**: `CheckMode::Manual { live }`, `Manual(Some(reply))`, focus only for a live manual request |
| Confirmed | Both round-5 fixes correct and complete; no new race, deadlock or stranding path | — |

### Mid escalation — fable leg (Opus 5.5, `Plan` agent): `conditional approve`

Both outlines were reviewed; it recommended shipping r6's shape over `plan-alt-minimal.md`, with trims. Every claim below was checked against the source before adoption.

| # | Finding | Disposition |
|---|---|---|
| 1 H | New `State<>` params on `respond_update_prompt` fail the whole command if unmanaged (`state.rs:60-69`, verified); no lane runs it in a real app | **Adopted**: no new `State<` params, `try_state` with 1.1.3 fallbacks, `.manage()` in the `Builder` chain, static guard (H7) |
| 2 M | `wdio.conf.ts` lists specs explicitly (verified); the new spec would never run | **Adopted**: listed; the gate greps the spec name (L3) |
| 3 M (Ask) | More mid-session auto-installs kill in-flight proofs (`updater.rs:460-461`, verified) | **User: yes (A5)**. Implemented on the admission semaphore, not the tray flag it would have used by default: that flag goes Idle while other proofs run (F20, found in this pass) |
| 4 M (Ask) | A hung download now pins the gate and the tray | **User: yes (A6)**: 60 s idle watchdog before `record_pending` |
| 5 M | The production-menu WebDriver variant first runs inside a real release | **Adopted**: pre-merge production-variant run (L4); state polling instead of sleeps (L5) |
| 6 M | The runtime "N ignores the env var" check may test nothing on Windows; hooks spread outside `e2e_tray.rs` | **Adopted differently**: a deterministic binary-content check with teeth (K5) replaces the runtime check; all hooks moved into `e2e_tray.rs` (K2) |
| 7 L | Paused-time tests can pass against mutations if waits are unbounded; the spin test relies on the coop budget | **Adopted**: test-writing rule and C13 note |
| 8 L | `interval`'s first tick is immediate | **Adopted**: `interval_at` (C2 🧬) |
| 9 L | A merge mid-release breaks its tag push; the unix workflow must not upload bundles | **Adopted**: L6 gating in Phase 0 and Delivery; L2 pin |
| 10 L | `prompt` mode's snooze line undefined; log offsets vs rotation | **Adopted**: the `Update snoozed` line is defined; per-launch stdout on Linux; rotation fails closed |
| Facts | F14 misstated (src-tauri `libc` is Linux-only); F16 needs the inline-on-main-thread behaviour; F6 path | **Adopted**: F14 corrected; F16 extended after reading runtime-wry 2.11.4 (`lib.rs:235-255`); F6 path fixed; F17–F21 added |
| Trims | Drop the deadline (`reply.is_closed()`); fold `route` into `decide`; run the real loop under WebDriver with a stub `check` | **Adopted** (C11, C12, E-table, I14, J3) |
| Rejected | 60 s feed timeout | Two queued fetches would exceed the 90 s tray ceiling |

Also found in this pass, not by a reviewer (matrix rows): a pre-epoch or constant clock (row A5), the mirror needing `set` rather than `max` after a clock correction (row A6 🧬), a symlink to a device (row B5), `Launch` needing scheduled semantics for snoozes (row E9 🧬), same-version re-navigation resetting the click-steal guard (row G4 🧬), and `run_updates -> Infallible` as a compile-time no-exit guard (row C14).

### Mid escalation — fresh codex (new session `01a0f38d-5322-78b0-ba27-8656be2e93c5`, GPT-6 Astra, xhigh): `reject`

| # | Finding | Disposition |
|---|---|---|
| 1 H | Cross-instance read-modify-write can drop a snooze, and the other instance then auto-installs against A4 | **Adopted**: exclusive file lock across `record_*`, reusing `config.rs:467`'s primitive; B14 became a deterministic barrier test 🧬 |
| 2 H | The safeguard tests never prove production calls them; the plan said the watchdog runs after the download | **Adopted**: `download_guarded` is the only source of the bytes; orchestration tests with a real admission permit (F11); `install_opts` mapping; the new `stall` smoke checks the wiring on real binaries (F10b); wording fixed. `busy` moved into the core loop (C15) |
| 3 H | The plan misstated the write order (file fsync → rename → dir fsync is the real one) | **Adopted**: text corrected; a strictly mechanical move; B16 pins the order 🧬 |
| 4 M | A redundant instance's idle signal ignores the serving instance's proofs | **Rejected with evidence**: bb reaping is per process (`bb.rs:691`), and replacing files on disk does not stop a running process, so no serving proof is interrupted; recorded as F18 |
| 5 M | B5 cannot kill its mutation (the cap catches `/dev/zero`); B2's oversized garbage cannot either | **Adopted**: a FIFO pre-filled with valid JSON (B5); a valid padded fixture (B2b) |
| 6 M | The FIFO rescue can itself block | **Adopted**: `O_WRONLY \| O_NONBLOCK` rescue (`ENXIO` if the reader left) |
| 7 M | WebDriver may never observe the transient "Checking…" | **Adopted**: handshake-gated stub outcomes |
| 8 M | Negative runs were not required; a crashed N-1 passes; the tamper is caught by the size check | **Adopted**: negative runs required with N-1 alive at the end; the same-length tamper goes to follow-ups (verification is untouched here) |
| 9 M | G7 and I12 are lexical tripwires | **Adopted**: a runtime main-thread refusal in the presenter (G7 🧬) plus the Windows prompt smoke; I12's claim narrowed to I14 as the real net |
| 10 M | C10 wrongly expected scheduled checks during manual streams; `select!` fairness is random | **Adopted**: C10 rewritten; `biased` select, tick first 🧬 |
| 11 M | A clock stuck at 0 stops all checks after the first record | **Adopted**: `now == 0` is always due and never recorded; lifecycle test (A5) 🧬 |
| Ask | A failed snooze write silently becomes a dismissal | **Decided without escalating**: a session mirror for the snooze (B15), logged. Rationale: an unwritable `~/.presto` is exceptional, and session-only deferral is the conservative reading of "Later" |
| Build | Payload-free `decide`; keep the atomic-write extraction mechanical | **Adopted**: `OutcomeKind`; `--color-moved` review and B16 |

### Mid escalation — fresh codex, confirmation of r8 (same session, resumed): `reject`

| # | Finding | Disposition |
|---|---|---|
| 1 H | "File snooze, else mirror" lets an older or other-version file snooze mask an unsaved "Later" | **Adopted**: file OR mirror; B15 covers four file states 🧬 |
| 2 H | A second instance on another version can refresh the shared timestamp after each of this one's ticks, postponing its checks forever | **Adopted**: a file timestamp by another writer is ignored; each version keeps its own cadence through its mirror; A7b 🧬. F18's assurance narrowed to the running proof |
| Confirmed | Finding 4's rejection is correct: no cross-process kill or signal (plugin renames aside, `updater.rs:1074`, `:1326`) | — |
| 3 M | Lock discipline and B14's coordination | **Adopted**: released before any config, updater or UI operation; B14 asserts contention with a non-blocking probe from an independent open |
| 4 M | B5's `O_RDWR` writer turns EOF into `EAGAIN`, so the mutation may pass | **Adopted**: separate non-reading handle, all writers closed before `load()` |
| 5 M | `download_guarded` cannot lend `&StallWatch` to its future; the watchdog must end at download completion; inline `InstallOpts` literals | **Adopted**: `Arc<StallWatch>`; stops at completion; F11 waits 5 min with a 🧬 for a watchdog leaking into the wait; callers use `install_opts` |
| 6 M | Bun closes idle streams after 10 s; the stall assertions need a precise contract | **Adopted**: idle timeout disabled for that response; genuine partial body; measured from the last chunk; per-launch log; same PID |
| 7 L | Removing `biased` is a probabilistic mutation; stale text | **Adopted**: reversed branch order as the mutation; stale lines fixed (FIFO rule, the main-thread write, `busy` placement, `InstallOpts` location) |

### Mid escalation — fresh codex, confirmation of r9 (same session, resumed): `conditional approve`

Prior findings 1–7 resolved; the new ownership and OR rules confirmed to compose. Conditions, all applied in r10:

| # | Finding | Disposition |
|---|---|---|
| 1 M | C6 holds only for a success by this version; the upgrade case needs its own row | **Adopted**: C6 qualified; C6b; algorithm step 5 reworded |
| 2 L | F18 overstated "updates at its next check" | **Adopted**: it checks, then follows its own preference and snooze; A7c pins the snooze being shared across versions |
| 3 L | Sketches lagged (`InstallOpts` placement, `spawn_install` options, the snooze mirror and writer fields) | **Adopted** |
| 4 L | Stale `route`; `Infallible` overstated; "bounded" main-thread write | **Adopted** |

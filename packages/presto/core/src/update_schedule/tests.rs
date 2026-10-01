//! Row IDs refer to the update-check-schedule failure matrix; each test names the rows it covers.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{mpsc, oneshot};
use tokio::time::{sleep, Instant};

use super::*;

const NOW: u64 = 1_800_000_000;
const H: u64 = 60 * 60;

type Log = Vec<(&'static str, &'static str, u64)>;
type Fixture = Box<dyn Fn(&tempfile::TempDir)>;
type DownloadFuture = std::pin::Pin<Box<dyn Future<Output = Result<Vec<u8>, ()>> + Send>>;

fn v(s: &str) -> Version {
    Version::parse(s).unwrap()
}

fn store_at(dir: &tempfile::TempDir, writer: &str) -> ScheduleStore {
    ScheduleStore::new(Some(dir.path().join("update-schedule.json")), writer)
}

fn write_raw(dir: &tempfile::TempDir, bytes: &[u8]) {
    std::fs::write(dir.path().join("update-schedule.json"), bytes).unwrap();
}

/// Counts `warn!` events emitted by `f` on this thread.
fn warnings_during<T>(f: impl FnOnce() -> T) -> (T, usize) {
    struct Counter(Arc<AtomicUsize>);
    impl tracing::Subscriber for Counter {
        fn enabled(&self, _: &tracing::Metadata<'_>) -> bool {
            true
        }
        fn new_span(&self, _: &tracing::span::Attributes<'_>) -> tracing::span::Id {
            tracing::span::Id::from_u64(1)
        }
        fn record(&self, _: &tracing::span::Id, _: &tracing::span::Record<'_>) {}
        fn record_follows_from(&self, _: &tracing::span::Id, _: &tracing::span::Id) {}
        fn event(&self, event: &tracing::Event<'_>) {
            if *event.metadata().level() == tracing::Level::WARN {
                self.0.fetch_add(1, Ordering::SeqCst);
            }
        }
        fn enter(&self, _: &tracing::span::Id) {}
        fn exit(&self, _: &tracing::span::Id) {}
    }
    let count = Arc::new(AtomicUsize::new(0));
    let out = tracing::subscriber::with_default(Counter(Arc::clone(&count)), f);
    (out, count.load(Ordering::SeqCst))
}

// ── A. Schedule math ────────────────────────────────────────────────────────────────────────────

#[test]
fn a1_a2_a4_due_boundaries() {
    assert!(check_due(None, NOW), "A1");
    assert!(
        !check_due(Some(NOW - 6 * H + 1), NOW),
        "A2: one second short"
    );
    assert!(check_due(Some(NOW - 6 * H), NOW), "A2: exactly six hours");
    assert!(
        !check_due(Some(NOW + 10 * 60), NOW),
        "A4: forward skew within tolerance"
    );
}

#[test]
fn a3_clock_moved_back_makes_a_check_due() {
    assert!(check_due(Some(NOW + 3 * 24 * H), NOW));
    assert!(check_due(Some(NOW + CLOCK_SKEW_TOLERANCE_SECS + 1), NOW));
}

#[test]
fn a5_extreme_values_never_panic_and_a_zero_clock_is_always_due() {
    assert!(check_due(Some(u64::MAX), NOW));
    let _ = check_due(Some(u64::MAX), u64::MAX);
    let _ = check_due(Some(0), u64::MAX);
    assert!(check_due(None, 0));
    assert!(check_due(Some(5), 0));
    assert_eq!(
        effective_last_check(Some(u64::MAX), Some(u64::MAX), u64::MAX),
        Some(u64::MAX)
    );
    let store = ScheduleStore::new(None, "9.9.9");
    store.record_checked(0).unwrap();
    assert_eq!(
        store.last_checked(0),
        None,
        "record_checked(0) records nothing"
    );
}

#[test]
fn a6_a_success_replaces_a_future_dated_mirror() {
    let store = ScheduleStore::new(None, "9.9.9");
    store.record_checked(NOW + 3 * 24 * H).unwrap();
    store.record_checked(NOW).unwrap();
    let later = NOW + H;
    assert!(!check_due(store.last_checked(later), later));
}

#[test]
fn a7_future_dated_unwritable_file_defers_to_the_mirror() {
    let dir = tempfile::tempdir().unwrap();
    write_raw(
        &dir,
        format!(
            r#"{{"schema":1,"last_checked_at":{},"last_checked_by":"9.9.9"}}"#,
            NOW + 10 * 24 * H
        )
        .as_bytes(),
    );
    let store = store_at(&dir, "9.9.9");
    store.fail_writes.store(true, Ordering::SeqCst);
    assert!(store.record_checked(NOW).is_err());
    assert!(
        !check_due(store.last_checked(NOW + H), NOW + H),
        "no check every tick"
    );
    assert!(check_due(store.last_checked(NOW + 6 * H), NOW + 6 * H));
}

#[test]
fn a7c_a_foreign_timestamp_is_ignored_but_its_snooze_applies() {
    let dir = tempfile::tempdir().unwrap();
    let first = store_at(&dir, "1.0.0");
    first.record_checked(NOW).unwrap();
    first
        .record_snooze(Snooze::starting(v("2.0.0"), NOW))
        .unwrap();
    let second = store_at(&dir, "1.1.0");
    assert_eq!(second.last_checked(NOW), None);
    assert!(second.is_snoozed(&v("2.0.0"), NOW + H));
}

#[test]
fn a8_snooze_matches_one_version_for_at_most_a_day() {
    let s = Snooze::starting(v("1.2.0"), NOW);
    let snoozed = |candidate: &str, now: u64| is_snoozed(Some(&s), &v(candidate), now);
    assert!(snoozed("1.2.0", NOW + 23 * H));
    assert!(!snoozed("1.3.0", NOW + H), "newer");
    assert!(!snoozed("1.1.0", NOW + H), "older: the rollback lever");
    assert!(!snoozed("1.2.0", s.until), "expired");
    let stretched = Snooze {
        version: v("1.2.0"),
        until: NOW + SNOOZE_SECS + CLOCK_SKEW_TOLERANCE_SECS + 1,
    };
    assert!(
        !is_snoozed(Some(&stretched), &v("1.2.0"), NOW),
        "stretched beyond a day"
    );
    let forever = Snooze {
        version: v("1.2.0"),
        until: u64::MAX,
    };
    assert!(!is_snoozed(Some(&forever), &v("1.2.0"), NOW));
    assert!(!is_snoozed(None, &v("1.2.0"), NOW));
}

#[test]
fn a9_prerelease_and_build_metadata_are_distinct_versions() {
    let versions = ["1.2.0", "1.2.0-rc.1", "1.2.0+build"];
    for snoozed in versions {
        for candidate in versions {
            let s = Snooze::starting(v(snoozed), NOW);
            assert_eq!(
                is_snoozed(Some(&s), &v(candidate), NOW),
                snoozed == candidate,
                "{snoozed} vs {candidate}"
            );
        }
    }
}

// ── B. Schedule file ────────────────────────────────────────────────────────────────────────────

#[test]
fn b1_missing_is_default_without_a_warning() {
    let dir = tempfile::tempdir().unwrap();
    let (state, warnings) = warnings_during(|| store_at(&dir, "9.9.9").load());
    assert_eq!(state, ScheduleState::default());
    assert_eq!(warnings, 0);
}

#[test]
fn b2_malformed_content_is_default_with_one_warning() {
    let fixtures: &[&[u8]] = &[
        b"",
        b"{}",
        b"[]",
        b"null",
        &[0xff, 0xfe, 0xfd],
        br#"{"schema":2,"last_checked_at":5}"#,
        br#"{"last_checked_at":5}"#,
        br#"{"schema":"1"}"#,
        br#"{"schema":1,"last_checked_at":"5"}"#,
        br#"{"schema":1,"last_checked_at":-1}"#,
        br#"{"schema":1,"last_checked_at":1.5}"#,
        br#"{"schema":1,"snooze":{"version":"1.2","until":5}}"#,
        br#"{"schema":1,"snooze":{"version":"v1.2.0","until":5}}"#,
        br#"{"schema":1,"snooze":{"version":"1.2.0"}}"#,
    ];
    for fixture in fixtures {
        let dir = tempfile::tempdir().unwrap();
        write_raw(&dir, fixture);
        let (state, warnings) = warnings_during(|| store_at(&dir, "9.9.9").load());
        let shown = String::from_utf8_lossy(fixture);
        assert_eq!(state, ScheduleState::default(), "{shown}");
        assert_eq!(warnings, 1, "{shown}");
    }
}

#[test]
fn b2b_valid_content_past_the_size_cap_is_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let json = format!(
        r#"{{"schema":1,"snooze":{{"version":"1.2.0","until":{}}}}}"#,
        NOW + H
    );
    let padded = format!("{json}{}", " ".repeat(MAX_FILE_BYTES + 1 - json.len()));
    write_raw(&dir, padded.as_bytes());
    assert_eq!(store_at(&dir, "9.9.9").load(), ScheduleState::default());
    write_raw(&dir, json.as_bytes());
    assert!(
        store_at(&dir, "9.9.9").load().snooze.is_some(),
        "the fixture itself is valid"
    );
}

/// Runs `load` on a thread and fails, rather than hanging, if it blocks for over a second.
fn load_within_a_second(store: ScheduleStore, rescue: impl FnOnce()) -> ScheduleState {
    let (tx, rx) = std::sync::mpsc::channel();
    let worker = std::thread::spawn(move || {
        let _ = tx.send(store.load());
    });
    let state = rx.recv_timeout(Duration::from_secs(1));
    if state.is_err() {
        rescue();
    }
    worker.join().unwrap();
    state.expect("load blocked for over a second")
}

#[test]
fn b3_a_directory_at_the_path_is_default() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir(dir.path().join("update-schedule.json")).unwrap();
    let state = load_within_a_second(store_at(&dir, "9.9.9"), || {});
    assert_eq!(state, ScheduleState::default());
}

#[cfg(unix)]
fn mkfifo(path: &Path) {
    use std::os::unix::ffi::OsStrExt as _;
    let c = std::ffi::CString::new(path.as_os_str().as_bytes()).unwrap();
    assert_eq!(unsafe { libc::mkfifo(c.as_ptr(), 0o600) }, 0);
}

#[cfg(unix)]
fn open_nonblocking(path: &Path, write: bool) -> std::io::Result<std::fs::File> {
    use std::os::unix::fs::OpenOptionsExt as _;
    std::fs::OpenOptions::new()
        .read(!write)
        .write(write)
        .custom_flags(libc::O_NONBLOCK)
        .open(path)
}

#[cfg(unix)]
#[test]
fn b4_a_fifo_without_a_writer_neither_blocks_nor_loads() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("update-schedule.json");
    mkfifo(&path);
    // A blocked reader is released by a writer appearing; if the reader already left, the
    // non-blocking open fails with ENXIO instead of blocking the test.
    let rescue_path = path.clone();
    let state = load_within_a_second(store_at(&dir, "9.9.9"), move || {
        let _ = open_nonblocking(&rescue_path, true);
    });
    assert_eq!(state, ScheduleState::default());
}

#[cfg(target_os = "linux")]
#[test]
fn b5_a_fifo_holding_valid_json_is_rejected_by_the_regular_file_check() {
    use std::io::Write as _;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("update-schedule.json");
    mkfifo(&path);
    // This non-reading handle keeps the pipe buffer alive after the writer closes.
    let _keeper = open_nonblocking(&path, false).unwrap();
    let json = format!(
        r#"{{"schema":1,"snooze":{{"version":"1.2.0","until":{}}}}}"#,
        NOW + H
    );
    let mut writer = open_nonblocking(&path, true).unwrap();
    writer.write_all(json.as_bytes()).unwrap();
    drop(writer);
    let state = load_within_a_second(store_at(&dir, "9.9.9"), || {});
    assert_eq!(state, ScheduleState::default());
}

#[test]
fn b6_unknown_fields_are_ignored() {
    let dir = tempfile::tempdir().unwrap();
    write_raw(
        &dir,
        br#"{"schema":1,"last_checked_at":5,"last_checked_by":"9.9.9","extra":{"a":1}}"#,
    );
    assert_eq!(store_at(&dir, "9.9.9").load().last_checked_at, Some(5));
}

#[test]
fn b7_round_trip_is_owner_only() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(".presto").join("update-schedule.json");
    let store = ScheduleStore::new(Some(path.clone()), "9.9.9");
    store.record_checked(NOW).unwrap();
    let snooze = Snooze::starting(v("1.2.0"), NOW);
    store.record_snooze(snooze.clone()).unwrap();
    assert_eq!(
        store.load(),
        ScheduleState {
            last_checked_at: Some(NOW),
            last_checked_by: Some("9.9.9".into()),
            snooze: Some(snooze),
        }
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        let mode = |p: &Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode(&path), 0o600);
        assert_eq!(mode(path.parent().unwrap()), 0o700);
    }
}

#[test]
fn b8_each_record_keeps_the_other_field() {
    let dir = tempfile::tempdir().unwrap();
    let store = store_at(&dir, "9.9.9");
    store.record_checked(NOW).unwrap();
    store
        .record_snooze(Snooze::starting(v("1.2.0"), NOW))
        .unwrap();
    let state = store.load();
    assert_eq!(state.last_checked_at, Some(NOW));
    assert!(state.snooze.is_some());

    let dir = tempfile::tempdir().unwrap();
    let store = store_at(&dir, "9.9.9");
    store
        .record_snooze(Snooze::starting(v("1.2.0"), NOW))
        .unwrap();
    store.record_checked(NOW).unwrap();
    let state = store.load();
    assert_eq!(state.last_checked_at, Some(NOW));
    assert!(state.snooze.is_some());
}

#[test]
fn b9_concurrent_records_keep_both_fields() {
    let dir = tempfile::tempdir().unwrap();
    let store = Arc::new(store_at(&dir, "9.9.9"));
    let checker = {
        let store = Arc::clone(&store);
        std::thread::spawn(move || {
            for i in 0..100 {
                store.record_checked(NOW + i).unwrap();
            }
        })
    };
    let snoozer = {
        let store = Arc::clone(&store);
        std::thread::spawn(move || {
            for i in 0..100 {
                store
                    .record_snooze(Snooze::starting(v("1.2.0"), NOW + i))
                    .unwrap();
            }
        })
    };
    checker.join().unwrap();
    snoozer.join().unwrap();
    let state = store.load();
    assert_eq!(state.last_checked_at, Some(NOW + 99));
    assert_eq!(state.snooze.map(|s| s.until), Some(NOW + 99 + SNOOZE_SECS));
}

#[test]
fn b10_a_failed_write_still_holds_in_the_mirror() {
    let dir = tempfile::tempdir().unwrap();
    let store = store_at(&dir, "9.9.9");
    store.fail_writes.store(true, Ordering::SeqCst);
    let (result, warnings) = warnings_during(|| store.record_checked(NOW));
    assert!(result.is_err());
    assert_eq!(warnings, 0, "the caller logs the error");
    assert_eq!(
        store.load(),
        ScheduleState::default(),
        "nothing reached the disk"
    );
    assert!(!check_due(store.last_checked(NOW + H), NOW + H));
}

#[test]
fn b11_a_file_where_the_directory_should_be_is_an_error() {
    let dir = tempfile::tempdir().unwrap();
    let blocker = dir.path().join("not-a-dir");
    std::fs::write(&blocker, b"x").unwrap();
    let store = ScheduleStore::new(Some(blocker.join("update-schedule.json")), "9.9.9");
    assert!(store.record_checked(NOW).is_err());
    assert!(store
        .record_snooze(Snooze::starting(v("1.2.0"), NOW))
        .is_err());
    assert_eq!(store.load(), ScheduleState::default());
}

#[test]
fn b12_the_writer_is_the_injected_app_version() {
    let dir = tempfile::tempdir().unwrap();
    let store = store_at(&dir, "9.9.9");
    store.record_checked(NOW).unwrap();
    assert_eq!(store.load().last_checked_by.as_deref(), Some("9.9.9"));
}

#[test]
fn b14_the_file_lock_serialises_instances() {
    let dir = tempfile::tempdir().unwrap();
    let lock_path = dir.path().join("update-schedule.json.lock");
    let first = Arc::new(store_at(&dir, "9.9.9"));
    let second = Arc::new(store_at(&dir, "9.9.9"));
    // The snoozer waits out the 300 ms pause below plus the writer's write, which a loaded Windows
    // runner (private DACL, rename) has stretched past the production 1 s; b14b pins that bound.
    *second.lock_wait.lock() = Duration::from_secs(30);
    let (paused_tx, paused_rx) = std::sync::mpsc::channel();
    let (resume_tx, resume_rx) = std::sync::mpsc::channel::<()>();
    let resume_rx = parking_lot::Mutex::new(resume_rx);
    *first.between_read_and_write.lock() = Some(Box::new(move || {
        let _ = paused_tx.send(());
        let _ = resume_rx.lock().recv();
    }));

    let writer = {
        let first = Arc::clone(&first);
        std::thread::spawn(move || first.record_checked(NOW).unwrap())
    };
    paused_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    assert!(
        crate::file_lock::try_lock_exclusive(&lock_path)
            .unwrap()
            .is_none(),
        "the lock is held between read and write"
    );
    let snoozer = {
        let second = Arc::clone(&second);
        std::thread::spawn(move || {
            second
                .record_snooze(Snooze::starting(v("1.2.0"), NOW))
                .unwrap();
        })
    };
    // Without the lock the second write lands now and the first one then erases it.
    std::thread::sleep(Duration::from_millis(300));
    resume_tx.send(()).unwrap();
    writer.join().unwrap();
    snoozer.join().unwrap();
    let state = second.load();
    assert_eq!(state.last_checked_at, Some(NOW));
    assert!(state.snooze.is_some());
}

#[test]
fn b14b_a_stopped_lock_holder_delays_recording_by_at_most_the_lock_wait() {
    let dir = tempfile::tempdir().unwrap();
    let store = Arc::new(store_at(&dir, "9.9.9"));
    let _held = crate::file_lock::try_lock_exclusive(&dir.path().join("update-schedule.json.lock"))
        .unwrap()
        .unwrap();
    let (tx, rx) = std::sync::mpsc::channel();
    let recorder = Arc::clone(&store);
    std::thread::spawn(move || {
        let checked = recorder.record_checked(NOW).map_err(|e| e.kind());
        let snoozed = recorder
            .record_snooze(Snooze::starting(v("1.2.0"), NOW))
            .map_err(|e| e.kind());
        let _ = tx.send((checked, snoozed));
    });
    let (checked, snoozed) = rx
        .recv_timeout(Duration::from_secs(10))
        .expect("recording waited on the stopped holder");
    assert_eq!(checked, Err(std::io::ErrorKind::TimedOut));
    assert_eq!(snoozed, Err(std::io::ErrorKind::TimedOut));
    assert_eq!(
        store.last_checked(NOW),
        Some(NOW),
        "the mirror holds the check"
    );
    assert!(
        store.is_snoozed(&v("1.2.0"), NOW),
        "the mirror holds the snooze"
    );
}

#[test]
fn b15_a_failed_snooze_write_applies_for_the_session_whatever_the_file_holds() {
    let target = v("1.2.0");
    let session = NOW + SNOOZE_SECS;
    // (the file's snooze, when the covering snooze ends); the last is another instance's later "Later".
    let files = [
        (None, session),
        (
            Some(format!(r#"{{"version":"1.2.0","until":{}}}"#, NOW - 1)),
            session,
        ),
        (
            Some(format!(r#"{{"version":"1.3.0","until":{}}}"#, NOW + H)),
            session,
        ),
        (
            Some(format!(r#"{{"version":"1.2.0","until":{}}}"#, NOW + 2 * H)),
            session,
        ),
        (
            Some(format!(r#"{{"version":"1.2.0","until":{}}}"#, session + 60)),
            session + 60,
        ),
    ];
    for (file_snooze, until) in files {
        let dir = tempfile::tempdir().unwrap();
        if let Some(s) = &file_snooze {
            write_raw(&dir, format!(r#"{{"schema":1,"snooze":{s}}}"#).as_bytes());
        }
        let store = store_at(&dir, "9.9.9");
        store.fail_writes.store(true, Ordering::SeqCst);
        assert!(store
            .record_snooze(Snooze::starting(target.clone(), NOW))
            .is_err());
        assert_eq!(
            store.snoozed_until(&target, NOW + H),
            Some(until),
            "file snooze: {file_snooze:?}"
        );
    }
}

#[cfg(unix)]
#[test]
fn b16_the_directory_fsync_follows_the_rename() {
    let dir = tempfile::tempdir().unwrap();
    let store = store_at(&dir, "9.9.9");
    crate::updater_state::FAIL_DIR_FSYNC.with(|f| f.set(true));
    let result = store.record_checked(NOW);
    crate::updater_state::FAIL_DIR_FSYNC.with(|f| f.set(false));
    assert!(result.is_err());
    assert_eq!(
        store.load().last_checked_at,
        Some(NOW),
        "renamed before the fsync failed"
    );
}

// ── C. The update task ──────────────────────────────────────────────────────────────────────────

#[derive(Debug)]
struct TestObs {
    reached: bool,
    in_progress: bool,
}

impl Observation for TestObs {
    fn reached_feed(&self) -> bool {
        self.reached
    }
    fn in_progress() -> Self {
        Self {
            reached: false,
            in_progress: true,
        }
    }
}

type ReplyTx = oneshot::Sender<&'static str>;

fn kind(reason: &CheckReason<ReplyTx>) -> &'static str {
    match reason {
        CheckReason::Launch => "launch",
        CheckReason::Scheduled => "scheduled",
        CheckReason::Manual(Some(_)) => "manual",
        CheckReason::Manual(None) => "manual-expired",
    }
}

/// Wall-clock seconds that follow tokio's paused clock, plus jumps a test injects.
#[derive(Clone)]
struct Wall {
    start: Instant,
    offset: Arc<AtomicU64>,
}

impl Wall {
    fn new() -> Self {
        Self {
            start: Instant::now(),
            offset: Arc::new(AtomicU64::new(0)),
        }
    }
    fn now(&self) -> u64 {
        NOW + self.start.elapsed().as_secs() + self.offset.load(Ordering::SeqCst)
    }
    fn jump(&self, secs: u64) {
        self.offset.fetch_add(secs, Ordering::SeqCst);
    }
}

/// Scripted `check` and `act`: outcomes pop in order (default: reached), durations are fixed, and
/// every call is logged with its paused-clock second.
#[derive(Clone)]
struct Script {
    start: Instant,
    outcomes: Arc<parking_lot::Mutex<VecDeque<bool>>>,
    check_secs: Arc<AtomicU64>,
    act_hangs: Arc<AtomicBool>,
    act_secs: Arc<AtomicU64>,
    log: Arc<parking_lot::Mutex<Log>>,
    inflight: Arc<AtomicUsize>,
    max_inflight: Arc<AtomicUsize>,
}

impl Script {
    fn new(outcomes: &[bool]) -> Self {
        Self {
            start: Instant::now(),
            outcomes: Arc::new(parking_lot::Mutex::new(outcomes.iter().copied().collect())),
            check_secs: Arc::new(AtomicU64::new(0)),
            act_hangs: Arc::new(AtomicBool::new(false)),
            act_secs: Arc::new(AtomicU64::new(0)),
            log: Arc::default(),
            inflight: Arc::default(),
            max_inflight: Arc::default(),
        }
    }
    fn record(&self, what: &'static str, kind: &'static str) {
        let at = self.start.elapsed().as_secs();
        self.log.lock().push((what, kind, at));
    }
    /// `(kind, second)` of every `check` call.
    fn checks(&self) -> Vec<(&'static str, u64)> {
        self.log
            .lock()
            .iter()
            .filter(|(what, _, _)| *what == "check")
            .map(|(_, kind, at)| (*kind, *at))
            .collect()
    }
    fn acts(&self) -> Vec<(&'static str, u64)> {
        self.log
            .lock()
            .iter()
            .filter(|(what, _, _)| *what == "act")
            .map(|(_, kind, at)| (*kind, *at))
            .collect()
    }
}

fn spawn_loop(
    store: Arc<ScheduleStore>,
    wall: Wall,
    script: Script,
    manual: mpsc::Receiver<ReplyTx>,
    busy: Arc<AtomicBool>,
) -> tokio::task::JoinHandle<Infallible> {
    tokio::spawn(async move {
        let check_script = script.clone();
        let act_script = script;
        run_updates(
            &store,
            move || wall.now(),
            LAUNCH_DELAY,
            WAKE_TICK,
            manual,
            move || busy.load(Ordering::SeqCst),
            move |reason: &CheckReason<ReplyTx>| {
                let s = check_script.clone();
                let kind = kind(reason);
                async move {
                    let now_inflight = s.inflight.fetch_add(1, Ordering::SeqCst) + 1;
                    s.max_inflight.fetch_max(now_inflight, Ordering::SeqCst);
                    s.record("check", kind);
                    sleep(Duration::from_secs(s.check_secs.load(Ordering::SeqCst))).await;
                    let reached = s.outcomes.lock().pop_front().unwrap_or(true);
                    s.inflight.fetch_sub(1, Ordering::SeqCst);
                    TestObs {
                        reached,
                        in_progress: false,
                    }
                }
            },
            move |reason: CheckReason<ReplyTx>, obs: TestObs| {
                let s = act_script.clone();
                async move {
                    s.record(
                        "act",
                        if obs.in_progress {
                            "in_progress"
                        } else {
                            kind(&reason)
                        },
                    );
                    if let CheckReason::Manual(Some(reply)) = reason {
                        let answer = match (obs.in_progress, obs.reached) {
                            (true, _) => "installing",
                            (false, true) => "ok",
                            (false, false) => "failed",
                        };
                        let _ = reply.send(answer);
                    }
                    if s.act_hangs.load(Ordering::SeqCst) {
                        std::future::pending::<()>().await;
                    }
                    sleep(Duration::from_secs(s.act_secs.load(Ordering::SeqCst))).await;
                }
            },
        )
        .await
    })
}

struct Rig {
    store: Arc<ScheduleStore>,
    wall: Wall,
    script: Script,
    manual: mpsc::Sender<ReplyTx>,
    busy: Arc<AtomicBool>,
    handle: tokio::task::JoinHandle<Infallible>,
}

impl Rig {
    fn start(store: ScheduleStore, outcomes: &[bool]) -> Self {
        Self::start_with(store, Script::new(outcomes))
    }
    fn start_with(store: ScheduleStore, script: Script) -> Self {
        Self::start_on(store, script, Wall::new())
    }
    fn start_on(store: ScheduleStore, script: Script, wall: Wall) -> Self {
        let store = Arc::new(store);
        let (manual, rx) = mpsc::channel(4);
        let busy = Arc::new(AtomicBool::new(false));
        let handle = spawn_loop(
            Arc::clone(&store),
            wall.clone(),
            script.clone(),
            rx,
            Arc::clone(&busy),
        );
        Self {
            store,
            wall,
            script,
            manual,
            busy,
            handle,
        }
    }
    fn click(&self) -> oneshot::Receiver<&'static str> {
        let (tx, rx) = oneshot::channel();
        self.manual.try_send(tx).unwrap();
        rx
    }
    async fn stop(self) {
        self.handle.abort();
        let _ = self.handle.await;
    }
}

/// Moves the paused clock forward; the runtime runs every timer due on the way. A test waking on
/// the same instant as a tick races it, so assertions stop a few seconds past tick times.
async fn run_for(secs: u64) {
    sleep(Duration::from_secs(secs)).await;
}

const FIRST_TICK: u64 = 5 + 15 * 60;

#[tokio::test(start_paused = true)]
async fn c1_the_launch_check_always_runs() {
    let mut fixtures: Vec<Fixture> = vec![
        Box::new(|_| {}),
        Box::new(|d| {
            write_raw(
                d,
                format!(
                    r#"{{"schema":1,"last_checked_at":{},"last_checked_by":"9.9.9"}}"#,
                    NOW - 60
                )
                .as_bytes(),
            );
        }),
        Box::new(|d| {
            write_raw(
                d,
                format!(
                    r#"{{"schema":1,"last_checked_at":{},"last_checked_by":"9.9.9"}}"#,
                    NOW + 99 * H
                )
                .as_bytes(),
            );
        }),
    ];
    #[cfg(unix)]
    fixtures.push(Box::new(|d| mkfifo(&d.path().join("update-schedule.json"))));
    for fixture in fixtures {
        let dir = tempfile::tempdir().unwrap();
        fixture(&dir);
        let rig = Rig::start(store_at(&dir, "9.9.9"), &[]);
        run_for(6).await;
        assert_eq!(rig.script.checks(), vec![("launch", 5)]);
        rig.stop().await;
    }
}

#[tokio::test(start_paused = true)]
async fn c1b_a_held_schedule_lock_still_lets_the_launch_result_through() {
    let dir = tempfile::tempdir().unwrap();
    let _held = crate::file_lock::try_lock_exclusive(&dir.path().join("update-schedule.json.lock"))
        .unwrap()
        .unwrap();
    let rig = Rig::start(store_at(&dir, "9.9.9"), &[true]);
    run_for(6).await;
    assert_eq!(rig.script.checks(), vec![("launch", 5)]);
    assert_eq!(rig.script.acts(), vec![("launch", 5)]);
    rig.stop().await;
}

#[tokio::test(start_paused = true)]
async fn c2_a_failed_launch_check_is_not_retried_at_once() {
    let rig = Rig::start(ScheduleStore::new(None, "9.9.9"), &[false]);
    run_for(FIRST_TICK - 1).await;
    assert_eq!(rig.script.checks(), vec![("launch", 5)]);
    run_for(5).await;
    assert_eq!(
        rig.script.checks(),
        vec![("launch", 5), ("scheduled", FIRST_TICK)]
    );
    rig.stop().await;
}

#[tokio::test(start_paused = true)]
async fn c3_one_scheduled_check_at_the_first_tick_after_six_hours() {
    let rig = Rig::start(ScheduleStore::new(None, "9.9.9"), &[]);
    run_for(6 * H + 30 * 60).await;
    assert_eq!(
        rig.script.checks(),
        vec![("launch", 5), ("scheduled", 5 + 6 * H)]
    );
    rig.stop().await;
}

#[tokio::test(start_paused = true)]
async fn c4_a_wall_clock_jump_across_sleep_triggers_the_next_tick() {
    let rig = Rig::start(ScheduleStore::new(None, "9.9.9"), &[]);
    run_for(60).await;
    rig.wall.jump(9 * H);
    run_for(FIRST_TICK - 55).await;
    assert_eq!(
        rig.script.checks(),
        vec![("launch", 5), ("scheduled", FIRST_TICK)]
    );
    rig.stop().await;
}

#[tokio::test(start_paused = true)]
async fn c5_a_due_check_retries_every_tick_until_it_succeeds() {
    let dir = tempfile::tempdir().unwrap();
    let rig = Rig::start(store_at(&dir, "9.9.9"), &[false, false, true]);
    run_for(2 * 15 * 60 + 5).await;
    let success_wall = rig.wall.now();
    run_for(6 * H - 60).await;
    assert_eq!(
        rig.script.checks(),
        vec![
            ("launch", 5),
            ("scheduled", FIRST_TICK),
            ("scheduled", FIRST_TICK + 15 * 60)
        ]
    );
    assert_eq!(rig.store.load().last_checked_at, Some(success_wall));
    run_for(120).await;
    assert_eq!(
        rig.script.checks().len(),
        4,
        "due again six hours after the success"
    );
    rig.stop().await;
}

#[tokio::test(start_paused = true)]
async fn c6_a_failed_launch_after_a_recent_own_success_waits_for_that_success() {
    let dir = tempfile::tempdir().unwrap();
    write_raw(
        &dir,
        format!(
            r#"{{"schema":1,"last_checked_at":{},"last_checked_by":"9.9.9"}}"#,
            NOW - H
        )
        .as_bytes(),
    );
    let rig = Rig::start(store_at(&dir, "9.9.9"), &[false]);
    run_for(5 * H + 20 * 60).await;
    // Due once 6 h have passed since NOW - H: the first tick at or after 5 h.
    assert_eq!(
        rig.script.checks(),
        vec![("launch", 5), ("scheduled", 5 + 5 * H)]
    );
    rig.stop().await;
}

#[tokio::test(start_paused = true)]
async fn c6b_after_an_upgrade_the_previous_versions_timestamp_does_not_count() {
    let previous = format!(
        r#"{{"schema":1,"last_checked_at":{},"last_checked_by":"1.0.0"}}"#,
        NOW - 60
    );

    let dir = tempfile::tempdir().unwrap();
    write_raw(&dir, previous.as_bytes());
    let rig = Rig::start(store_at(&dir, "2.0.0"), &[false]);
    run_for(FIRST_TICK + 5).await;
    assert_eq!(
        rig.script.checks(),
        vec![("launch", 5), ("scheduled", FIRST_TICK)]
    );
    rig.stop().await;

    let dir = tempfile::tempdir().unwrap();
    write_raw(&dir, previous.as_bytes());
    let rig = Rig::start(store_at(&dir, "2.0.0"), &[true]);
    run_for(6 * H + 60).await;
    assert_eq!(
        rig.script.checks(),
        vec![("launch", 5), ("scheduled", 5 + 6 * H)]
    );
    rig.stop().await;
}

#[tokio::test(start_paused = true)]
async fn c7_the_timestamp_is_recorded_before_act_runs() {
    let dir = tempfile::tempdir().unwrap();
    let script = Script::new(&[]);
    script.act_hangs.store(true, Ordering::SeqCst);
    let rig = Rig::start_with(store_at(&dir, "9.9.9"), script);
    run_for(5).await;
    let checked_wall = rig.wall.now();
    run_for(H).await;
    assert_eq!(rig.store.load().last_checked_at, Some(checked_wall));
    rig.stop().await;

    let dir = tempfile::tempdir().unwrap();
    let script = Script::new(&[]);
    script.act_secs.store(H, Ordering::SeqCst);
    let rig = Rig::start_with(store_at(&dir, "9.9.9"), script);
    run_for(5).await;
    let checked_wall = rig.wall.now();
    run_for(H + 60).await;
    assert_eq!(rig.store.load().last_checked_at, Some(checked_wall));
    rig.stop().await;
}

#[tokio::test(start_paused = true)]
async fn c8_slow_checks_never_overlap() {
    let script = Script::new(&[false; 64]);
    script.check_secs.store(20 * 60, Ordering::SeqCst);
    let rig = Rig::start_with(ScheduleStore::new(None, "9.9.9"), script);
    run_for(4 * H).await;
    assert!(rig.script.checks().len() >= 8, "{:?}", rig.script.checks());
    assert_eq!(rig.script.max_inflight.load(Ordering::SeqCst), 1);
    rig.stop().await;
}

#[tokio::test(start_paused = true)]
async fn c9_a_click_waits_for_the_running_check() {
    let script = Script::new(&[false, false, false]);
    script.check_secs.store(10, Ordering::SeqCst);
    let rig = Rig::start_with(ScheduleStore::new(None, "9.9.9"), script);
    run_for(1).await;
    let during_delay = rig.click();
    // The launch check runs 5..15 s, so the tick schedule starts at 15 s: the first tick is 915 s.
    run_for(915).await;
    let during_scheduled = rig.click();
    run_for(60).await;
    assert_eq!(during_delay.await.unwrap(), "failed");
    assert_eq!(during_scheduled.await.unwrap(), "ok");
    assert_eq!(
        rig.script.checks(),
        vec![
            ("launch", 5),
            ("manual", 15),
            ("scheduled", 915),
            ("manual", 925)
        ]
    );
    assert_eq!(rig.script.max_inflight.load(Ordering::SeqCst), 1);
    rig.stop().await;
}

#[tokio::test(start_paused = true)]
async fn c10_a_due_tick_outranks_a_queued_click() {
    // The launch fails, so every tick is due. A slow click spans the first tick; when it ends, the
    // tick and a second click are both ready.
    let script = Script::new(&[false, false, false, false]);
    let rig = Rig::start_with(ScheduleStore::new(None, "9.9.9"), script);
    run_for(FIRST_TICK - 20).await;
    rig.script.check_secs.store(30, Ordering::SeqCst);
    let slow = rig.click();
    run_for(5).await;
    let queued = rig.click();
    run_for(120).await;
    let _ = (slow.await, queued.await);
    let kinds: Vec<_> = rig.script.checks().into_iter().map(|(k, _)| k).collect();
    assert_eq!(kinds, vec!["launch", "manual", "scheduled", "manual"]);
    rig.stop().await;
}

#[tokio::test(start_paused = true)]
async fn c10_a_successful_click_postpones_the_schedule_and_a_failed_one_does_not() {
    let rig = Rig::start(ScheduleStore::new(None, "9.9.9"), &[true, true]);
    run_for(H).await;
    assert_eq!(rig.click().await.unwrap(), "ok");
    run_for(6 * H - 60).await;
    assert_eq!(
        rig.script.checks().len(),
        2,
        "the click's success counts as a check"
    );
    run_for(H).await;
    assert_eq!(rig.script.checks().len(), 3);
    rig.stop().await;

    let rig = Rig::start(ScheduleStore::new(None, "9.9.9"), &[false, false, true]);
    run_for(60).await;
    assert_eq!(rig.click().await.unwrap(), "failed");
    run_for(FIRST_TICK).await;
    let kinds: Vec<_> = rig.script.checks().into_iter().map(|(k, _)| k).collect();
    assert_eq!(kinds, vec!["launch", "manual", "scheduled"]);
    rig.stop().await;
}

#[tokio::test(start_paused = true)]
async fn c11_a_click_the_tray_abandoned_before_its_turn_is_not_fetched() {
    let script = Script::new(&[]);
    script.check_secs.store(10, Ordering::SeqCst);
    let rig = Rig::start_with(ScheduleStore::new(None, "9.9.9"), script);
    run_for(1).await;
    drop(rig.click());
    run_for(60).await;
    assert_eq!(rig.script.checks(), vec![("launch", 5)]);
    assert_eq!(rig.script.acts(), vec![("launch", 15)]);
    rig.stop().await;
}

#[tokio::test(start_paused = true)]
async fn c12_a_click_abandoned_during_its_check_stays_manual() {
    let rig = Rig::start(ScheduleStore::new(None, "9.9.9"), &[]);
    run_for(60).await;
    rig.script.check_secs.store(30, Ordering::SeqCst);
    let reply = rig.click();
    run_for(10).await;
    drop(reply);
    run_for(60).await;
    assert_eq!(
        rig.script.acts(),
        vec![("launch", 5), ("manual-expired", 90)]
    );
    rig.stop().await;
}

#[tokio::test(start_paused = true)]
async fn c13_losing_every_sender_neither_stops_nor_spins_the_loop() {
    let Rig {
        script,
        manual,
        handle,
        ..
    } = Rig::start(ScheduleStore::new(None, "9.9.9"), &[false, false]);
    run_for(60).await;
    let before = LOOP_WAKEUPS.with(std::cell::Cell::get);
    drop(manual);
    // A closed receiver is always ready. `mpsc::recv`'s cooperative budget hands control back even
    // to a spinning loop, so a spin shows up here as many wake-ups; no timer is awaited, because a
    // spinning task would keep paused time from advancing.
    for _ in 0..1_000 {
        tokio::task::yield_now().await;
    }
    let wakeups = LOOP_WAKEUPS.with(std::cell::Cell::get) - before;
    assert!(wakeups <= 2, "the loop spun: {wakeups} wake-ups");
    run_for(1800).await;
    let kinds: Vec<_> = script.checks().into_iter().map(|(k, _)| k).collect();
    assert_eq!(kinds, vec!["launch", "scheduled", "scheduled"]);
    handle.abort();
    let _ = handle.await;
}

#[tokio::test(start_paused = true)]
async fn c15_while_installing_requests_skip_the_fetch_and_record_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let rig = Rig::start(store_at(&dir, "9.9.9"), &[]);
    rig.busy.store(true, Ordering::SeqCst);
    run_for(60).await;
    assert_eq!(rig.click().await.unwrap(), "installing");
    run_for(FIRST_TICK).await;
    assert!(rig.script.checks().is_empty(), "{:?}", rig.script.checks());
    assert_eq!(
        rig.script.acts().len(),
        3,
        "launch, click and the first tick"
    );
    assert!(rig.script.acts().iter().all(|(k, _)| *k == "in_progress"));
    assert_eq!(rig.store.load(), ScheduleState::default());
    rig.stop().await;
}

#[tokio::test(start_paused = true)]
async fn a5_a_clock_stuck_at_zero_checks_every_tick_and_records_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let store = Arc::new(store_at(&dir, "9.9.9"));
    let script = Script::new(&[]);
    let (_manual, rx) = mpsc::channel::<ReplyTx>(4);
    let handle = {
        let store = Arc::clone(&store);
        let check_script = script.clone();
        tokio::spawn(async move {
            run_updates(
                &store,
                || 0,
                LAUNCH_DELAY,
                WAKE_TICK,
                rx,
                || false,
                move |reason: &CheckReason<ReplyTx>| {
                    let s = check_script.clone();
                    let kind = kind(reason);
                    async move {
                        s.record("check", kind);
                        TestObs {
                            reached: true,
                            in_progress: false,
                        }
                    }
                },
                |_, _| async {},
            )
            .await
        })
    };
    run_for(H + 10).await;
    assert_eq!(script.checks().len(), 5, "launch plus four ticks");
    assert!(!dir.path().join("update-schedule.json").exists());
    handle.abort();
    let _ = handle.await;
}

#[tokio::test(start_paused = true)]
async fn a7b_two_versions_sharing_the_file_keep_their_own_cadence() {
    let dir = tempfile::tempdir().unwrap();
    let wall = Wall::new();
    let old = Rig::start_on(store_at(&dir, "1.0.0"), Script::new(&[]), wall.clone());
    run_for(3 * 60).await;
    let new = Rig::start_on(store_at(&dir, "2.0.0"), Script::new(&[]), wall);
    run_for(13 * H).await;
    assert_eq!(
        old.script.checks().len(),
        3,
        "old: {:?}",
        old.script.checks()
    );
    assert_eq!(
        new.script.checks().len(),
        3,
        "new: {:?}",
        new.script.checks()
    );
    old.stop().await;
    new.stop().await;
}

// ── F. Installing ───────────────────────────────────────────────────────────────────────────────

#[test]
fn f1_one_claim_at_a_time() {
    let gate = Arc::new(InstallGate::default());
    let claim = gate.try_claim().unwrap();
    assert!(gate.is_busy());
    assert!(gate.try_claim().is_none());
    drop(claim);
    assert!(!gate.is_busy());
    assert!(gate.try_claim().is_some());
}

#[tokio::test(start_paused = true)]
async fn f2_f5_a_claimed_future_releases_the_gate_however_it_ends() {
    let gate = Arc::new(InstallGate::default());

    run_claimed(gate.try_claim().unwrap(), async {}).await;
    assert!(!gate.is_busy(), "returned normally");

    drop(run_claimed(gate.try_claim().unwrap(), async {}));
    assert!(!gate.is_busy(), "dropped before its first poll");

    let task = tokio::spawn(run_claimed(
        gate.try_claim().unwrap(),
        sleep(Duration::from_secs(H)),
    ));
    run_for(60).await;
    assert!(gate.is_busy(), "held while pending");
    task.abort();
    let _ = task.await;
    assert!(!gate.is_busy(), "aborted mid-await");

    let task = tokio::spawn(run_claimed(
        gate.try_claim().unwrap(),
        sleep(Duration::from_secs(60)),
    ));
    run_for(30).await;
    assert!(gate.is_busy());
    task.await.unwrap();
    assert!(!gate.is_busy(), "finished");
}

/// A fake download: touches the watch at each listed second, then returns `Ok` if `finish` or
/// never completes otherwise.
fn fake_download(
    touch_at: Vec<u64>,
    finish: bool,
) -> impl FnOnce(Arc<StallWatch>) -> DownloadFuture {
    move |watch| {
        Box::pin(async move {
            let start = Instant::now();
            for at in touch_at {
                tokio::time::sleep_until(start + Duration::from_secs(at)).await;
                watch.touch();
            }
            if finish {
                Ok(vec![1, 2, 3])
            } else {
                std::future::pending().await
            }
        })
    }
}

const NO_WAIT: InstallOpts = InstallOpts {
    wait_for_idle_prover: false,
};

#[tokio::test(start_paused = true)]
async fn f7_a_download_that_stops_is_abandoned_sixty_seconds_after_its_last_chunk() {
    let start = Instant::now();
    let result = tokio::time::timeout(
        Duration::from_secs(600),
        download_guarded(fake_download(vec![1], false), || true, NO_WAIT),
    )
    .await
    .expect("the watchdog never fired");
    assert!(matches!(result, Err(GuardedError::Stalled)));
    assert_eq!(start.elapsed().as_secs(), 61);
}

#[tokio::test(start_paused = true)]
async fn f8_a_slow_but_progressing_download_is_never_abandoned() {
    let touches: Vec<u64> = (1..=20).map(|i| i * 30).collect();
    let result = tokio::time::timeout(
        Duration::from_secs(900),
        download_guarded(fake_download(touches, true), || true, NO_WAIT),
    )
    .await
    .unwrap();
    assert_eq!(result.unwrap(), vec![1, 2, 3]);
}

#[tokio::test(start_paused = true)]
async fn f9_a_chunk_at_fifty_nine_seconds_resets_the_watchdog() {
    let start = Instant::now();
    let result = tokio::time::timeout(
        Duration::from_secs(600),
        download_guarded(fake_download(vec![59], false), || true, NO_WAIT),
    )
    .await
    .unwrap();
    assert!(matches!(result, Err(GuardedError::Stalled)));
    assert_eq!(start.elapsed().as_secs(), 119);
}

#[tokio::test(start_paused = true)]
async fn f11_an_automatic_install_waits_for_a_real_proof_to_finish() {
    let state = crate::server::HeadlessState::default();
    let permit = Arc::clone(&state.prove_waiters)
        .try_acquire_owned()
        .unwrap();
    tokio::spawn(async move {
        sleep(Duration::from_secs(5 * 60)).await;
        drop(permit);
    });
    let start = Instant::now();
    let result = tokio::time::timeout(
        Duration::from_secs(20 * 60),
        download_guarded(
            fake_download(vec![], true),
            || state.prover_idle(),
            install_opts(InstallCaller::Auto),
        ),
    )
    .await
    .unwrap();
    assert_eq!(
        result.unwrap(),
        vec![1, 2, 3],
        "the watchdog stays out of the wait"
    );
    let waited = start.elapsed().as_secs();
    assert!((5 * 60..=5 * 60 + 10).contains(&waited), "waited {waited}s");
}

#[tokio::test(start_paused = true)]
async fn f13_continuous_proving_delays_an_automatic_install_by_at_most_thirty_minutes() {
    let state = crate::server::HeadlessState::default();
    let _held = Arc::clone(&state.prove_waiters)
        .try_acquire_owned()
        .unwrap();
    let start = Instant::now();
    let result = tokio::time::timeout(
        Duration::from_secs(2 * H),
        download_guarded(
            fake_download(vec![], true),
            || state.prover_idle(),
            install_opts(InstallCaller::Auto),
        ),
    )
    .await
    .expect("the idle wait has no cap");
    assert!(result.is_ok());
    assert_eq!(start.elapsed().as_secs(), 30 * 60);
}

#[test]
fn f14_only_automatic_installs_wait_for_the_prover() {
    assert!(install_opts(InstallCaller::Auto).wait_for_idle_prover);
    assert!(!install_opts(InstallCaller::UpdateNow).wait_for_idle_prover);
}

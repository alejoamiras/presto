//! The verified-sites client end to end in one process: a scripted feed on an ephemeral loopback port,
//! fixture lists signed with the RFC 8032 TEST 1 key standing in for the pinned key, list 4 as the
//! built-in, and a cache in a temporary directory. Every check runs under an outer deadline, so a
//! missing network timeout fails the case instead of hanging the suite; cache loads are outside it.
//! Each case asserts what the popup would see, what the disk holds, and how long the check took.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use presto::commands::verified_info;
use presto::verified_sites::{refresh, run_refresh, Refresh, VerifiedSites};
use presto_core::update_schedule::{run_updates, Observation, ScheduleStore};
use presto_core::verified_sites::fetch::{fetch_document, Feed};
use presto_core::verified_sites::list::SiteList;
use presto_core::verified_sites::store::ListStore;
use presto_core::verified_sites::verify::{document, judge, verify_document, Judgement, ListKey};
use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, oneshot};
use tokio::time::Instant;

const FEED_TIMEOUT: Duration = Duration::from_secs(2);
const DEADLINE: Duration = Duration::from_secs(10);
/// Any check that waits on nothing: well under the store's 1 s lock wait and the feed timeout.
const FAST: Duration = Duration::from_secs(1);
const CACHE: &str = "verified-sites-accepted.json";
const DOCUMENT_MAX_BYTES: usize = 96 * 1024;

fn fixture(name: &str) -> Vec<u8> {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../core/tests/fixtures/verified_sites");
    std::fs::read(dir.join(name)).unwrap_or_else(|e| panic!("fixture {name}: {e}"))
}

fn test_key() -> ListKey {
    ListKey::from_document(&String::from_utf8(fixture("test1.pub")).unwrap()).unwrap()
}

/// The served envelope of a fixture list under the given signature file.
fn signed_as(list: &str, signature: &str) -> Vec<u8> {
    document(&fixture(list), &fixture(signature))
}

fn envelope(name: &str) -> Vec<u8> {
    signed_as(&format!("{name}.json"), &format!("{name}.json.minisig"))
}

#[derive(Clone)]
enum Answer {
    Document(Vec<u8>),
    Status(u16),
    /// A 200 whose `Content-Length` is over the cap; the body never comes.
    OversizedLength,
    /// A chunked 200 that streams past the cap.
    OversizedChunked,
    /// A chunked 200 that sends one byte every 100 ms, forever.
    Drip,
    Hang,
    /// A 302 to `/valid`, which would serve list 5.
    RedirectToValid,
}

struct Server {
    url: String,
    answer: Arc<Mutex<Answer>>,
    requests: Arc<AtomicU32>,
}

impl Server {
    async fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/", listener.local_addr().unwrap());
        let answer = Arc::new(Mutex::new(Answer::Status(404)));
        let requests = Arc::new(AtomicU32::new(0));
        let (scripted, counted) = (Arc::clone(&answer), Arc::clone(&requests));
        tokio::spawn(async move {
            while let Ok((socket, _)) = listener.accept().await {
                let (scripted, counted) = (Arc::clone(&scripted), Arc::clone(&counted));
                tokio::spawn(async move { serve(socket, &scripted, &counted).await });
            }
        });
        Self {
            url,
            answer,
            requests,
        }
    }

    fn requests(&self) -> u32 {
        self.requests.load(Ordering::SeqCst)
    }
}

async fn serve(mut socket: TcpStream, answer: &Mutex<Answer>, requests: &AtomicU32) {
    let mut head = Vec::new();
    let mut byte = [0u8; 1];
    while !head.ends_with(b"\r\n\r\n") {
        if socket.read(&mut byte).await.unwrap_or(0) == 0 {
            return;
        }
        head.push(byte[0]);
    }
    requests.fetch_add(1, Ordering::SeqCst);
    let answer = if head.starts_with(b"GET /valid ") {
        Answer::Document(envelope("list-5"))
    } else {
        answer.lock().clone()
    };
    const CHUNKED: &[u8] = b"HTTP/1.1 200 OK\r\ntransfer-encoding: chunked\r\n\r\n";
    match answer {
        Answer::Document(body) => {
            let head = format!("HTTP/1.1 200 OK\r\ncontent-length: {}\r\n\r\n", body.len());
            let _ = socket.write_all(head.as_bytes()).await;
            let _ = socket.write_all(&body).await;
        }
        Answer::Status(status) => {
            let head = format!("HTTP/1.1 {status} Nope\r\ncontent-length: 0\r\n\r\n");
            let _ = socket.write_all(head.as_bytes()).await;
        }
        Answer::OversizedLength => {
            let head = format!(
                "HTTP/1.1 200 OK\r\ncontent-length: {}\r\n\r\n",
                DOCUMENT_MAX_BYTES + 1
            );
            let _ = socket.write_all(head.as_bytes()).await;
            std::future::pending::<()>().await;
        }
        Answer::OversizedChunked => {
            let _ = socket.write_all(CHUNKED).await;
            let chunk = format!("400\r\n{}\r\n", "x".repeat(1024));
            for _ in 0..=DOCUMENT_MAX_BYTES / 1024 {
                if socket.write_all(chunk.as_bytes()).await.is_err() {
                    return;
                }
            }
            let _ = socket.write_all(b"0\r\n\r\n").await;
        }
        Answer::Drip => {
            let _ = socket.write_all(CHUNKED).await;
            while socket.write_all(b"1\r\nx\r\n").await.is_ok() {
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        }
        Answer::Hang => std::future::pending().await,
        Answer::RedirectToValid => {
            let head = "HTTP/1.1 302 Found\r\nlocation: /valid\r\ncontent-length: 0\r\n\r\n";
            let _ = socket.write_all(head.as_bytes()).await;
        }
    }
}

struct Harness {
    _tmp: tempfile::TempDir,
    path: PathBuf,
    server: Server,
    sites: Arc<VerifiedSites>,
    load_time: Duration,
}

impl Harness {
    async fn new() -> Self {
        Self::with_cache(|_| {}).await
    }

    /// `prepare` gets the cache path before the registry loads.
    async fn with_cache(prepare: impl FnOnce(&Path)) -> Self {
        // Both ring and aws-lc-rs are linked, so rustls needs to be told, as `main` does.
        let _ = tokio_rustls::rustls::crypto::aws_lc_rs::default_provider().install_default();
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("presto").join(CACHE);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        prepare(&path);
        let started = Instant::now();
        let sites = Arc::new(load(&path));
        let load_time = started.elapsed();
        Self {
            _tmp: tmp,
            path,
            server: Server::start().await,
            sites,
            load_time,
        }
    }

    fn feed(&self) -> Feed {
        Feed {
            url: self.server.url.clone(),
            key: test_key(),
            timeout: FEED_TIMEOUT,
            https_only: false,
        }
    }

    /// One list check against `answer`, with its outcome and duration.
    async fn check(&self, answer: Answer) -> (Refresh, Duration) {
        *self.server.answer.lock() = answer;
        let started = Instant::now();
        let outcome = tokio::time::timeout(DEADLINE, refresh(&self.sites, &self.feed()))
            .await
            .expect("the check outlived every production deadline");
        (outcome, started.elapsed())
    }

    async fn accept(&self, name: &str) {
        let (outcome, _) = self.check(Answer::Document(envelope(name))).await;
        assert_eq!(outcome, Refresh::Swapped { persisted: true }, "{name}");
    }

    fn restart(&mut self) {
        self.sites = Arc::new(load(&self.path));
    }

    fn name(&self, origin: &str) -> Option<String> {
        verified_info(&self.sites, origin).map(|dto| dto.display_name)
    }

    fn disk(&self) -> Option<Vec<u8>> {
        std::fs::read(&self.path).ok()
    }

    /// The registry is at fixture list `version` (4, 5 or 6), as the popup sees it.
    fn assert_at(&self, version: u64) {
        assert_eq!(self.sites.version(), Some(version));
        let beta = if version == 4 { "Beta" } else { "Beta Wallet" };
        assert_eq!(self.name("https://beta.example.com").as_deref(), Some(beta));
        assert_eq!(
            self.name("https://gamma.example.com").is_some(),
            version != 6
        );
        assert_eq!(
            self.name("https://delta.example.com").is_some(),
            version != 4
        );
    }
}

fn load(path: &Path) -> VerifiedSites {
    VerifiedSites::load(
        &fixture("list-4.json"),
        Some(ListStore::new(Some(path.to_path_buf()), test_key())),
    )
}

#[tokio::test(flavor = "multi_thread")]
async fn case_01_a_newer_list_is_persisted_before_it_is_used() {
    let h = Harness::new().await;
    *h.server.answer.lock() = Answer::Document(envelope("list-5"));
    // Holding the store's lock stalls the save: the registry must not change until it is written.
    let lock = std::fs::File::create(h.path.with_extension("json.lock")).unwrap();
    lock.lock().unwrap();
    let (sites, feed) = (Arc::clone(&h.sites), h.feed());
    let check = tokio::spawn(async move { refresh(&sites, &feed).await });
    let held_until = Instant::now() + Duration::from_millis(500);
    while Instant::now() < held_until {
        h.assert_at(4);
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert_eq!(h.server.requests(), 1, "fetched, now waiting to save");
    assert!(!check.is_finished());
    lock.unlock().unwrap();
    let outcome = tokio::time::timeout(DEADLINE, check)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(outcome, Refresh::Swapped { persisted: true });
    h.assert_at(5);
    assert_eq!(h.disk(), Some(envelope("list-5")));
}

#[tokio::test(flavor = "multi_thread")]
async fn case_02_a_restart_keeps_the_accepted_list_and_refuses_an_older_one() {
    let mut h = Harness::new().await;
    h.accept("list-5").await;
    h.restart();
    h.assert_at(5);
    let (outcome, elapsed) = h.check(Answer::Document(envelope("list-4"))).await;
    assert_eq!(outcome, Refresh::Kept);
    assert!(elapsed < FAST);
    h.assert_at(5);
    assert_eq!(h.disk(), Some(envelope("list-5")));
}

#[tokio::test(flavor = "multi_thread")]
async fn case_03_a_signed_removal_wins_over_the_built_in() {
    let mut h = Harness::new().await;
    h.accept("list-6").await;
    h.assert_at(6);
    assert_eq!(h.name("https://gamma.example.com"), None);
    h.restart();
    h.assert_at(6);
    assert_eq!(h.disk(), Some(envelope("list-6")));
}

/// One of cases 4–16. `None` as the answer means the port refuses connections.
struct BadAnswer {
    label: &'static str,
    /// List 5 accepted first, so an older or same-version list has something to lose to.
    at_five: bool,
    answer: Option<Answer>,
    expected: Refresh,
    /// Ends only at the feed timeout.
    slow: bool,
}

const fn bad(label: &'static str, answer: Option<Answer>, expected: Refresh) -> BadAnswer {
    BadAnswer {
        label,
        at_five: false,
        answer,
        expected,
        slow: false,
    }
}

fn bad_answers() -> Vec<BadAnswer> {
    let document = |bytes| Some(Answer::Document(bytes));
    vec![
        bad(
            "tampered signature",
            document(signed_as("list-5-tampered.json", "list-5.json.minisig")),
            Refresh::Refused,
        ),
        bad(
            "wrong key",
            document(signed_as("list-5.json", "list-5.wrong-key.minisig")),
            Refresh::Refused,
        ),
        BadAnswer {
            at_five: true,
            ..bad("older", document(envelope("list-4")), Refresh::Kept)
        },
        BadAnswer {
            at_five: true,
            ..bad(
                "same version, different body",
                document(envelope("list-5-equivocating")),
                Refresh::Equivocation,
            )
        },
        bad(
            "malformed JSON",
            document(b"not json".to_vec()),
            Refresh::Refused,
        ),
        bad(
            "signed schema violation",
            document(envelope("list-7-unknown-field")),
            Refresh::Refused,
        ),
        bad(
            "oversized with Content-Length",
            Some(Answer::OversizedLength),
            Refresh::Unreachable,
        ),
        bad(
            "oversized without Content-Length",
            Some(Answer::OversizedChunked),
            Refresh::Unreachable,
        ),
        BadAnswer {
            slow: true,
            ..bad("drip", Some(Answer::Drip), Refresh::Unreachable)
        },
        BadAnswer {
            slow: true,
            ..bad("hang", Some(Answer::Hang), Refresh::Unreachable)
        },
        bad("404", Some(Answer::Status(404)), Refresh::Unreachable),
        bad("503", Some(Answer::Status(503)), Refresh::Unreachable),
        bad("connection refused", None, Refresh::Unreachable),
        bad(
            "302 to a valid document",
            Some(Answer::RedirectToValid),
            Refresh::Unreachable,
        ),
    ]
}

/// A URL whose port was bound and released, so connecting to it is refused.
async fn refused_url() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    format!("http://{}/", listener.local_addr().unwrap())
}

/// Cases 4–16: nothing changes, and only a 200 within the cap counts as reaching the feed.
#[tokio::test(flavor = "multi_thread")]
async fn cases_04_to_16_a_bad_answer_changes_nothing() {
    for case in bad_answers() {
        let label = case.label;
        let h = Harness::new().await;
        if case.at_five {
            h.accept("list-5").await;
        }
        let before = h.disk();
        let redirect = matches!(case.answer, Some(Answer::RedirectToValid));
        let refused = case.answer.is_none();
        let (outcome, elapsed) = match case.answer {
            Some(answer) => h.check(answer).await,
            None => {
                let feed = Feed {
                    url: refused_url().await,
                    ..h.feed()
                };
                let started = Instant::now();
                let outcome = tokio::time::timeout(DEADLINE, refresh(&h.sites, &feed))
                    .await
                    .unwrap();
                (outcome, started.elapsed())
            }
        };
        assert_eq!(outcome, case.expected, "{label}");
        let answered = matches!(
            case.expected,
            Refresh::Refused | Refresh::Kept | Refresh::Equivocation
        );
        assert_eq!(outcome.reached_feed(), answered, "{label}");
        let bound = match (case.slow, refused) {
            (true, _) => FEED_TIMEOUT..FEED_TIMEOUT * 2,
            // Windows retries a refused connect for about 2 s, so the feed timeout may end it.
            (false, true) if cfg!(windows) => Duration::ZERO..FEED_TIMEOUT * 2,
            _ => Duration::ZERO..FAST,
        };
        assert!(bound.contains(&elapsed), "{label}: took {elapsed:?}");
        h.assert_at(if case.at_five { 5 } else { 4 });
        assert_eq!(h.disk(), before, "{label}");
        if redirect {
            assert_eq!(h.server.requests(), 1, "{label}: the redirect was followed");
        }
    }
}

/// Cases 17–20: a bad cache loads as the built-in at once, and the next accepted list replaces it.
#[tokio::test(flavor = "multi_thread")]
async fn cases_17_to_20_a_bad_cache_falls_back_to_the_built_in() {
    type Prepare = fn(&Path);
    #[cfg_attr(not(unix), allow(unused_mut))]
    let mut cases: Vec<(&str, Prepare, bool)> = vec![
        (
            "corrupt",
            |p| std::fs::write(p, b"{\"schema\":").unwrap(),
            true,
        ),
        (
            "forged",
            |p| {
                let forged = signed_as("list-5.json", "list-5.wrong-key.minisig");
                std::fs::write(p, forged).unwrap();
            },
            true,
        ),
        (
            "oversized",
            |p| std::fs::write(p, vec![b' '; DOCUMENT_MAX_BYTES + 1]).unwrap(),
            true,
        ),
    ];
    #[cfg(unix)]
    {
        cases.push((
            "FIFO",
            |p| {
                let made = std::process::Command::new("mkfifo").arg(p).status();
                assert!(made.unwrap().success());
            },
            true,
        ));
        cases.push(("directory", |p| std::fs::create_dir(p).unwrap(), false));
    }
    for (label, prepare, replaced) in cases {
        let h = Harness::with_cache(prepare).await;
        assert!(
            h.load_time < Duration::from_millis(200),
            "{label}: load took {:?}",
            h.load_time
        );
        h.assert_at(4);
        let (outcome, elapsed) = h.check(Answer::Document(envelope("list-5"))).await;
        assert_eq!(
            outcome,
            Refresh::Swapped {
                persisted: replaced
            },
            "{label}"
        );
        assert!(elapsed < FAST, "{label}: took {elapsed:?}");
        h.assert_at(5);
        if replaced {
            assert_eq!(h.disk(), Some(envelope("list-5")), "{label}");
        } else {
            assert!(h.path.is_dir(), "{label}");
        }
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn case_21_an_unwritable_store_still_swaps() {
    let mut h = Harness::new().await;
    // A regular file where the store's directory should be: unwritable on every OS, even as root.
    let blocker = h.path.parent().unwrap().join("blocker");
    std::fs::write(&blocker, b"").unwrap();
    h.path = blocker.join(CACHE);
    h.restart();
    let (outcome, elapsed) = h.check(Answer::Document(envelope("list-5"))).await;
    assert_eq!(outcome, Refresh::Swapped { persisted: false });
    assert!(elapsed < FAST);
    h.assert_at(5);
    assert_eq!(h.disk(), None);
}

/// Stores `name` as another instance would, after this one loaded.
fn other_instance_saves(h: &Harness, name: &str) {
    let list = fixture(&format!("{name}.json"));
    let signature = fixture(&format!("{name}.json.minisig"));
    let candidate = verify_document(&document(&list, &signature), &test_key()).unwrap();
    let other = ListStore::new(Some(h.path.clone()), test_key());
    let _ = other.save_if_newer(&candidate);
}

#[tokio::test(flavor = "multi_thread")]
async fn case_22_a_newer_list_on_disk_wins_over_the_fetched_one() {
    let h = Harness::new().await;
    other_instance_saves(&h, "list-6");
    h.assert_at(4);
    let (outcome, elapsed) = h.check(Answer::Document(envelope("list-5"))).await;
    assert_eq!(outcome, Refresh::Swapped { persisted: true });
    assert!(elapsed < FAST);
    h.assert_at(6);
    assert_eq!(h.disk(), Some(envelope("list-6")));
}

#[tokio::test(flavor = "multi_thread")]
async fn case_23_a_different_list_on_disk_at_the_fetched_version_changes_nothing() {
    let h = Harness::new().await;
    other_instance_saves(&h, "list-5-equivocating");
    let (outcome, elapsed) = h.check(Answer::Document(envelope("list-5"))).await;
    assert_eq!(outcome, Refresh::Equivocation);
    assert!(elapsed < FAST);
    h.assert_at(4);
    assert_eq!(h.disk(), Some(envelope("list-5-equivocating")));
}

struct StubCheck;

impl Observation for StubCheck {
    fn reached_feed(&self) -> bool {
        false
    }

    fn in_progress() -> Self {
        Self
    }
}

// Current-thread on purpose: a list check that blocks its thread then stops the update task
// outright, where a multi-thread runtime's other workers would keep it on time.
#[tokio::test]
async fn case_24_a_hung_list_check_never_delays_the_update_check() {
    let tick = Duration::from_millis(10);
    let h = Harness::new().await;
    *h.server.answer.lock() = Answer::Hang;
    let (_requests, rx) = mpsc::channel(1);
    let list = tokio::spawn(run_refresh(Arc::clone(&h.sites), h.feed(), rx, tick, tick));

    // A stub update task on the same runtime, never reaching its feed, so every tick checks.
    let checks = Arc::new(AtomicU32::new(0));
    let seen = Arc::clone(&checks);
    let (_tray, tray_rx) = mpsc::channel::<oneshot::Sender<()>>(1);
    let updater = tokio::spawn(async move {
        let schedule = ScheduleStore::new(None, "test");
        run_updates(
            &schedule,
            presto_core::updater_state::now_unix,
            tick,
            tick,
            tray_rx,
            || false,
            |_| {
                seen.fetch_add(1, Ordering::Relaxed);
                std::future::ready(StubCheck)
            },
            |_, _| std::future::ready(()),
        )
        .await
    });

    // On one thread a blocked list check also holds up this sleep, so a block that outlasts the
    // window fails even after 20 checks.
    let started = Instant::now();
    tokio::time::sleep(FEED_TIMEOUT / 2).await;
    let slept = started.elapsed();
    assert!(slept < FEED_TIMEOUT, "a 1 s sleep took {slept:?}");
    let checks = checks.load(Ordering::Relaxed);
    assert!(checks >= 20, "only {checks} update checks");
    assert_eq!(
        h.server.requests(),
        1,
        "the list's launch check is still hung"
    );
    h.assert_at(4);
    list.abort();
    updater.abort();
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "reads the live list: run with PRESTO_VERIFIED_SITES_LIVE=1 and --ignored"]
async fn case_25_the_live_list_verifies_at_the_newest_record() {
    assert_eq!(
        std::env::var("PRESTO_VERIFIED_SITES_LIVE").as_deref(),
        Ok("1"),
        "set PRESTO_VERIFIED_SITES_LIVE=1"
    );
    let _ = tokio_rustls::rustls::crypto::aws_lc_rs::default_provider().install_default();
    let key = presto::verified_sites::pinned_key().unwrap();
    let bytes = tokio::time::timeout(
        Duration::from_secs(45),
        fetch_document(&Feed::production(key.clone())),
    )
    .await
    .unwrap()
    .unwrap();
    let live = verify_document(&bytes, &key).unwrap();
    let built_in = SiteList::parse_unsigned(presto::verified_sites::BUILT_IN).unwrap();
    assert_eq!(judge(&built_in, &live.list), Judgement::Unchanged);
}

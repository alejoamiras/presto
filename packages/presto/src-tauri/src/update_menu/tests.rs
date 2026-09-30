#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]

use super::*;
use crate::updater::{ManualCheckReceiver, ManualReply};
use std::collections::VecDeque;

#[derive(Clone, Default)]
struct Recorder(Arc<Mutex<Vec<(String, bool)>>>);

impl LabelSink for Recorder {
    fn show(&self, label: &str, enabled: bool) {
        self.0.lock().unwrap().push((label.to_owned(), enabled));
    }
}

impl Recorder {
    fn last(&self) -> (String, bool) {
        self.0.lock().unwrap().last().cloned().unwrap()
    }

    fn count(&self, label: &str) -> usize {
        self.0
            .lock()
            .unwrap()
            .iter()
            .filter(|(l, _)| l == label)
            .count()
    }
}

/// Posted jobs wait until the test drains them, standing in for the main thread's queue.
#[derive(Clone, Default)]
struct Queue(Arc<Mutex<VecDeque<Job>>>);

impl UiThread for Queue {
    fn post(&self, job: Job) {
        self.0.lock().unwrap().push_back(job);
    }

    fn spawn(&self, task: Task) {
        drop(tokio::runtime::Handle::current().spawn(task));
    }
}

impl Queue {
    fn drain(&self) {
        loop {
            let job = self.0.lock().unwrap().pop_front();
            match job {
                Some(job) => job(),
                None => return,
            }
        }
    }

    fn len(&self) -> usize {
        self.0.lock().unwrap().len()
    }
}

type Controller = Arc<ManualCheck<Recorder, Queue>>;

fn controller(
    capacity: usize,
) -> (
    Controller,
    Recorder,
    Queue,
    ManualCheckSender,
    ManualCheckReceiver,
) {
    let (recorder, queue) = (Recorder::default(), Queue::default());
    let (tx, rx) = tokio::sync::mpsc::channel(capacity);
    let check = ManualCheck::new(recorder.clone(), queue.clone(), REVERT_AFTER);
    (check, recorder, queue, tx, rx)
}

/// Lets spawned waits run up to their next await.
async fn settle() {
    for _ in 0..20 {
        tokio::task::yield_now().await;
    }
}

fn state_of(recorder: &Recorder, state: State) -> (String, bool) {
    assert_eq!(recorder.last(), (state.label().to_owned(), state.enabled()));
    recorder.last()
}

/// Clicks, answers with `result` as the update task would, and drains the posted label.
async fn answered(
    result: ManualCheckResult,
) -> (
    Controller,
    Recorder,
    Queue,
    ManualCheckSender,
    ManualCheckReceiver,
) {
    let (check, recorder, queue, tx, mut rx) = controller(4);
    check.click(&tx);
    let reply: ManualReply = rx.try_recv().unwrap();
    reply.send(result).unwrap();
    settle().await;
    queue.drain();
    (check, recorder, queue, tx, rx)
}

#[test]
fn labels_are_the_agreed_copy_and_only_checking_is_disabled() {
    let table = [
        (State::Idle, "Check for Updates…", true),
        (State::Checking, "Checking…", false),
        (State::UpToDate, "Up to date", true),
        (State::Failed, "Couldn't check — try again", true),
        (State::Installing, "Installing update…", true),
    ];
    for (state, label, enabled) in table {
        assert_eq!(
            (state.label(), state.enabled()),
            (label, enabled),
            "{state:?}"
        );
    }
}

#[tokio::test(start_paused = true)]
async fn i1_a_click_shows_checking_disabled_and_queues_one_request() {
    let (check, recorder, queue, tx, mut rx) = controller(4);
    check.click(&tx);
    state_of(&recorder, State::Checking);
    assert_eq!(check.state(), State::Checking);
    assert_eq!(queue.len(), 0, "the click's own label write is inline");
    assert!(rx.try_recv().is_ok());
}

#[tokio::test(start_paused = true)]
async fn i2_each_answer_sets_its_label() {
    let table = [
        (ManualCheckResult::UpToDate, State::UpToDate),
        (ManualCheckResult::Failed, State::Failed),
        (ManualCheckResult::Installing, State::Installing),
        (ManualCheckResult::Presented, State::Idle),
    ];
    for (result, want) in table {
        let (check, recorder, ..) = answered(result).await;
        assert_eq!(check.state(), want, "{result:?}");
        state_of(&recorder, want);
    }
}

#[tokio::test(start_paused = true)]
async fn i2b_a_request_dropped_unanswered_reads_failed() {
    let (check, recorder, queue, tx, mut rx) = controller(4);
    check.click(&tx);
    drop(rx.try_recv().unwrap());
    settle().await;
    queue.drain();
    state_of(&recorder, State::Failed);
}

/// 🧬 Without the single-flight check, the second click queues a second request.
#[tokio::test(start_paused = true)]
async fn i3_a_click_during_a_check_sends_nothing() {
    let (check, recorder, _queue, tx, mut rx) = controller(4);
    check.click(&tx);
    check.click(&tx);
    assert!(rx.try_recv().is_ok());
    assert!(rx.try_recv().is_err(), "one request only");
    assert_eq!(recorder.count(State::Checking.label()), 1);
}

#[tokio::test(start_paused = true)]
async fn i4_a_full_or_closed_channel_fails_at_once() {
    let (check, recorder, queue, tx, _rx) = controller(1);
    let (stuck, _) = tokio::sync::oneshot::channel();
    tx.try_send(stuck).unwrap();
    check.click(&tx);
    assert_eq!(check.state(), State::Failed);
    state_of(&recorder, State::Failed);
    assert_eq!(queue.len(), 0);

    let (check, recorder, _queue, tx, rx) = controller(4);
    drop(rx);
    check.click(&tx);
    assert_eq!(check.state(), State::Failed);
    state_of(&recorder, State::Failed);
}

/// 🧬 Without the reply timeout, the item reads "Checking…" forever.
#[tokio::test(start_paused = true)]
async fn i5_no_answer_fails_at_90s_and_expires_the_request() {
    let (check, recorder, queue, tx, mut rx) = controller(4);
    check.click(&tx);
    let reply = rx.try_recv().unwrap();
    settle().await;

    tokio::time::advance(REPLY_TIMEOUT - Duration::from_secs(1)).await;
    settle().await;
    queue.drain();
    assert_eq!(check.state(), State::Checking);
    assert!(!reply.is_closed(), "still waiting");

    tokio::time::advance(Duration::from_secs(1)).await;
    settle().await;
    queue.drain();
    state_of(&recorder, State::Failed);
    assert!(
        reply.is_closed(),
        "the update task sees the tray gave up and drops or unfocuses the request"
    );
}

#[tokio::test(start_paused = true)]
async fn i6_a_result_reverts_after_five_minutes() {
    let (check, recorder, queue, ..) = answered(ManualCheckResult::UpToDate).await;

    tokio::time::advance(REVERT_AFTER - Duration::from_secs(1)).await;
    settle().await;
    queue.drain();
    assert_eq!(check.state(), State::UpToDate);

    tokio::time::advance(Duration::from_secs(1)).await;
    settle().await;
    queue.drain();
    state_of(&recorder, State::Idle);
}

#[tokio::test(start_paused = true)]
async fn i6b_a_shown_prompt_schedules_no_revert() {
    let (_check, _recorder, queue, ..) = answered(ManualCheckResult::Presented).await;
    tokio::time::advance(REVERT_AFTER * 2).await;
    settle().await;
    assert_eq!(queue.len(), 0);
}

/// 🧬 Checking the generation before posting, instead of inside the posted write, lets a revert
/// queued before a new click overwrite its "Checking…".
#[tokio::test(start_paused = true)]
async fn i7_a_stale_revert_never_overwrites_a_new_click() {
    // The revert is queued, then the user clicks before the main thread runs it.
    let (check, recorder, queue, tx, _rx) = answered(ManualCheckResult::UpToDate).await;
    tokio::time::advance(REVERT_AFTER).await;
    settle().await;
    assert_eq!(queue.len(), 1, "the revert is queued");
    check.click(&tx);
    queue.drain();
    assert_eq!(check.state(), State::Checking);
    state_of(&recorder, State::Checking);

    // The main thread runs the revert first, then the click.
    let (check, recorder, queue, tx, _rx) = answered(ManualCheckResult::UpToDate).await;
    tokio::time::advance(REVERT_AFTER).await;
    settle().await;
    queue.drain();
    check.click(&tx);
    assert_eq!(check.state(), State::Checking);
    state_of(&recorder, State::Checking);
}

#[tokio::test(start_paused = true)]
async fn i8_label_writes_after_the_click_wait_for_the_main_thread() {
    let (check, recorder, queue, tx, mut rx) = controller(4);
    check.click(&tx);
    rx.try_recv()
        .unwrap()
        .send(ManualCheckResult::UpToDate)
        .unwrap();
    settle().await;
    assert_eq!(queue.len(), 1);
    assert_eq!(
        check.state(),
        State::Checking,
        "nothing changes off the main thread"
    );
    state_of(&recorder, State::Checking);
    queue.drain();
    state_of(&recorder, State::UpToDate);
}

#[test]
fn i10_the_item_exists_where_a_click_reaches_an_update_task() {
    let table = [
        (true, false, true),
        (false, false, false),
        (false, true, true),
        (true, true, true),
    ];
    for (poll, webdriver, want) in table {
        assert_eq!(
            tray_item_enabled(poll, webdriver),
            want,
            "{poll} {webdriver}"
        );
    }
}

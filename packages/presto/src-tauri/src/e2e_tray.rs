//! WebDriver builds only: the update task with a stub feed check, and a driver that clicks "Check
//! for Updates…" through the production dispatch and reports what the native item showed.
//!
//! Every test hook lives here, behind the one `cfg` on `mod e2e_tray`, so no shipped binary carries
//! them or the report variable's name.

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use presto::update_menu::{State, ITEM_ID};
use presto::updater::{CheckOutcome, ManualCheckReceiver};
use presto_core::update_schedule::CheckReason;
use tauri::menu::{Menu, MenuItem};
use tauri::{AppHandle, Wry};
use tokio::sync::oneshot;

const REPORT_ENV: &str = "PRESTO_E2E_TRAY_REPORT";

/// Long enough to observe a result, short enough for the driver to watch the revert.
pub const REVERT: Duration = Duration::from_secs(2);

/// Label writes are posted to the main thread, so each expected state gets this long to appear.
const STEP_DEADLINE: Duration = Duration::from_secs(20);

#[derive(Default)]
struct Stub {
    /// Answers for tray requests, in order, each held until the driver releases it.
    held: Mutex<VecDeque<(CheckOutcome, oneshot::Receiver<()>)>>,
    manual_calls: AtomicU32,
    other_calls: AtomicU32,
}

impl Stub {
    /// Queues the answer to the next tray request; it is given once the returned sender fires.
    fn hold(&self, outcome: CheckOutcome) -> oneshot::Sender<()> {
        let (release, held) = oneshot::channel();
        self.lock().push_back((outcome, held));
        release
    }

    /// Never finds an update, so no prompt window can open mid-test.
    async fn check(&self, manual: bool) -> CheckOutcome {
        if !manual {
            self.other_calls.fetch_add(1, Ordering::SeqCst);
            return CheckOutcome::UpToDate;
        }
        self.manual_calls.fetch_add(1, Ordering::SeqCst);
        let next = self.lock().pop_front();
        match next {
            Some((outcome, held)) => {
                let _ = held.await;
                outcome
            }
            None => CheckOutcome::UpToDate,
        }
    }

    fn lock(&self) -> MutexGuard<'_, VecDeque<(CheckOutcome, oneshot::Receiver<()>)>> {
        self.held.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// Runs the update task on the stub always, so the tray item never talks to a closed channel, and
/// the driver when the report path is set.
pub fn start(app: &AppHandle, manual: ManualCheckReceiver, menu: Menu<Wry>) {
    let stub = Arc::new(Stub::default());
    let checker = Arc::clone(&stub);
    crate::spawn_update_task(app.clone(), manual, move |reason| {
        let stub = Arc::clone(&checker);
        let manual = matches!(reason, CheckReason::Manual(_));
        async move { stub.check(manual).await }
    });
    if let Ok(report) = std::env::var(REPORT_ENV) {
        tauri::async_runtime::spawn(drive(app.clone(), stub, menu, PathBuf::from(report)));
    }
}

async fn drive(app: AppHandle, stub: Arc<Stub>, menu: Menu<Wry>, report: PathBuf) {
    let item = menu
        .get(ITEM_ID)
        .and_then(|kind| kind.as_menuitem().cloned());
    let mut steps = Vec::new();
    let complete = match &item {
        Some(item) => script(&app, &stub, item, &mut steps).await.is_some(),
        None => false,
    };
    let body = serde_json::json!({
        "steps": steps,
        "stub_calls": stub.manual_calls.load(Ordering::SeqCst),
        "launch_calls": stub.other_calls.load(Ordering::SeqCst),
        "menu_has_item": item.is_some(),
        "complete": complete,
    });
    if let Err(error) = write_report(&report, &body.to_string()) {
        tracing::error!(%error, path = %report.display(), "Could not write the tray report");
    }
}

/// Stops at the first state that does not appear; the report then shows what did.
async fn script(
    app: &AppHandle,
    stub: &Stub,
    item: &MenuItem<Wry>,
    steps: &mut Vec<(String, bool)>,
) -> Option<()> {
    observe(item, State::Idle, steps).await?;

    // The answer is held until the driver has seen "Checking…" and clicked again, so the
    // transient state is always observable and the duplicate click lands mid-check.
    let release = stub.hold(CheckOutcome::UpToDate);
    click(app).await;
    observe(item, State::Checking, steps).await?;
    click(app).await;
    let _ = release.send(());
    observe(item, State::UpToDate, steps).await?;
    observe(item, State::Idle, steps).await?;

    let release = stub.hold(CheckOutcome::Failed);
    click(app).await;
    observe(item, State::Checking, steps).await?;
    let _ = release.send(());
    observe(item, State::Failed, steps).await
}

/// Posts the production menu dispatch to the main thread, where a native click runs it, and waits
/// for it to have run.
async fn click(app: &AppHandle) {
    let (done, ran) = oneshot::channel();
    let handle = app.clone();
    let posted = app.run_on_main_thread(move || {
        crate::on_tray_menu(&handle, ITEM_ID);
        let _ = done.send(());
    });
    if posted.is_ok() {
        let _ = ran.await;
    }
}

async fn observe(item: &MenuItem<Wry>, want: State, steps: &mut Vec<(String, bool)>) -> Option<()> {
    let deadline = tokio::time::Instant::now() + STEP_DEADLINE;
    loop {
        let seen = read(item).await;
        let matched = seen.0 == want.label() && seen.1 == want.enabled();
        if matched || tokio::time::Instant::now() >= deadline {
            steps.push(seen);
            return matched.then_some(());
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

/// The item's getters wait on the main thread, so they run off the async workers.
async fn read(item: &MenuItem<Wry>) -> (String, bool) {
    let item = item.clone();
    tokio::task::spawn_blocking(move || {
        (
            item.text().unwrap_or_default(),
            item.is_enabled().unwrap_or(false),
        )
    })
    .await
    .unwrap_or_default()
}

/// Renamed into place, so the spec never reads a partial report.
fn write_report(path: &Path, body: &str) -> std::io::Result<()> {
    let partial = path.with_extension("partial");
    std::fs::write(&partial, body)?;
    std::fs::rename(&partial, path)
}

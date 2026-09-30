//! The tray's "Check for Updates…" item: a label that reports one manual check at a time.
//!
//! A click runs on the main thread and writes "Checking…" inline. Every later label write is posted
//! back to the main thread, and each posted write re-checks the click generation it belongs to, so a
//! stale result or revert can never overwrite a newer click. No lock is held across a menu call:
//! off the main thread, menu setters block until the main thread runs them.
#![deny(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::arithmetic_side_effects
)]

use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use tokio::sync::mpsc::error::TrySendError;

use crate::updater::{ManualCheckResult, ManualCheckSender};

pub const ITEM_ID: &str = "check_updates";

/// A click that hears nothing back by then reads "Couldn't check". Dropping the reply receiver is
/// also how the update task learns the request expired.
pub const REPLY_TIMEOUT: Duration = Duration::from_secs(90);

/// How long a result label stays before the item reads "Check for Updates…" again.
pub const REVERT_AFTER: Duration = Duration::from_secs(5 * 60);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum State {
    Idle,
    Checking,
    UpToDate,
    Failed,
    Installing,
}

impl State {
    pub fn label(self) -> &'static str {
        match self {
            Self::Idle => "Check for Updates…",
            Self::Checking => "Checking…",
            Self::UpToDate => "Up to date",
            Self::Failed => "Couldn't check — try again",
            Self::Installing => "Installing update…",
        }
    }

    pub fn enabled(self) -> bool {
        self != Self::Checking
    }

    /// A shown prompt is its own answer, so the item goes straight back to Idle.
    fn after(result: ManualCheckResult) -> Self {
        match result {
            ManualCheckResult::UpToDate => Self::UpToDate,
            ManualCheckResult::Presented => Self::Idle,
            ManualCheckResult::Failed => Self::Failed,
            ManualCheckResult::Installing => Self::Installing,
        }
    }
}

/// The item exists wherever a click can reach an update task.
pub fn tray_item_enabled(poll_allowed: bool, webdriver: bool) -> bool {
    poll_allowed || webdriver
}

/// Where the label is shown: the native menu item, or a recorder in tests.
pub trait LabelSink: Send + Sync + 'static {
    fn show(&self, label: &str, enabled: bool);
}

impl LabelSink for tauri::menu::MenuItem<tauri::Wry> {
    fn show(&self, label: &str, enabled: bool) {
        if let Err(error) = self.set_text(label) {
            tracing::warn!(%error, "Could not set the update item's label");
        }
        if let Err(error) = self.set_enabled(enabled) {
            tracing::warn!(%error, "Could not enable or disable the update item");
        }
    }
}

pub type Job = Box<dyn FnOnce() + Send>;
pub type Task = Pin<Box<dyn Future<Output = ()> + Send>>;

/// Where the controller's work runs: label writes on the main thread, waits on the async runtime.
pub trait UiThread: Send + Sync + 'static {
    /// Jobs run one at a time on the thread `click` runs on, which is what lets `apply` release the
    /// state lock before writing the label.
    fn post(&self, job: Job);
    fn spawn(&self, task: Task);
}

/// The menu callback has no Tokio context, so waits go through Tauri's runtime.
pub struct TauriUi(pub tauri::AppHandle);

impl UiThread for TauriUi {
    fn post(&self, job: Job) {
        if let Err(error) = self.0.run_on_main_thread(job) {
            tracing::warn!(%error, "Could not post an update item label");
        }
    }

    fn spawn(&self, task: Task) {
        drop(tauri::async_runtime::spawn(task));
    }
}

pub type TrayManualCheck = Arc<ManualCheck<tauri::menu::MenuItem<tauri::Wry>, TauriUi>>;

pub struct ManualCheck<S, U> {
    sink: S,
    ui: U,
    revert_after: Duration,
    /// The state, and the click it belongs to.
    state: Mutex<(State, u64)>,
}

impl<S: LabelSink, U: UiThread> ManualCheck<S, U> {
    pub fn new(sink: S, ui: U, revert_after: Duration) -> Arc<Self> {
        Arc::new(Self {
            sink,
            ui,
            revert_after,
            state: Mutex::new((State::Idle, 0)),
        })
    }

    pub fn state(&self) -> State {
        self.lock().0
    }

    /// Main thread only. A click while a check runs does nothing.
    pub fn click(self: &Arc<Self>, requests: &ManualCheckSender) {
        let Some(generation) = self.try_begin() else {
            return;
        };
        self.sink
            .show(State::Checking.label(), State::Checking.enabled());
        let (reply, answer) = tokio::sync::oneshot::channel();
        if let Err(error) = requests.try_send(reply) {
            match error {
                TrySendError::Full(_) => tracing::warn!("Update task is not taking requests"),
                TrySendError::Closed(_) => tracing::warn!("Update task is not running"),
            }
            self.apply(generation, State::Failed);
            self.ui.spawn(Box::pin(Arc::clone(self).revert(generation)));
            return;
        }
        let this = Arc::clone(self);
        self.ui.spawn(Box::pin(async move {
            let result = match tokio::time::timeout(REPLY_TIMEOUT, answer).await {
                Ok(Ok(result)) => result,
                Ok(Err(_)) | Err(_) => ManualCheckResult::Failed,
            };
            this.settle(generation, State::after(result)).await;
        }));
    }

    fn try_begin(&self) -> Option<u64> {
        let mut state = self.lock();
        if state.0 == State::Checking {
            return None;
        }
        let generation = state.1.wrapping_add(1);
        *state = (State::Checking, generation);
        Some(generation)
    }

    async fn settle(self: Arc<Self>, generation: u64, next: State) {
        let this = Arc::clone(&self);
        self.ui.post(Box::new(move || this.apply(generation, next)));
        if next != State::Idle {
            self.revert(generation).await;
        }
    }

    async fn revert(self: Arc<Self>, generation: u64) {
        tokio::time::sleep(self.revert_after).await;
        let this = Arc::clone(&self);
        self.ui
            .post(Box::new(move || this.apply(generation, State::Idle)));
    }

    fn apply(&self, generation: u64, next: State) {
        {
            let mut state = self.lock();
            if state.1 != generation {
                return;
            }
            state.0 = next;
        }
        self.sink.show(next.label(), next.enabled());
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, (State, u64)> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

#[cfg(test)]
mod tests;

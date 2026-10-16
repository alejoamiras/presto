//! Developer mode's custom bb in the desktop app: the four Settings commands, the candidate they
//! share, and the state Settings, the tray and the approval popup show.
//!
//! The webview never names a file: a path comes from the native picker or from the stored pin.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

use presto_core::custom_bb::{
    self as core_bb, CustomBbActivity, CustomBbPin, Inspection, Refusal, Unavailable,
};
use presto_core::versions::AztecVersion;
use serde::{Deserialize, Serialize};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

use crate::commands::{
    now_unix_secs, require_label, try_mutate_config_at, ConfigState, ConfigStore, SharedAppState,
    SETTINGS_LABEL,
};

/// The file under review in Settings. Memory only; every review replaces it.
#[derive(Debug, Clone)]
pub struct Candidate {
    pub inspection: Inspection,
    /// `bb --version` exited 0 for exactly these bytes.
    pub tested: bool,
}

pub type CandidateState = parking_lot::Mutex<Option<Candidate>>;

/// Stands in for the native picker. Only WebDriver builds manage it.
pub struct TestPick(pub PathBuf);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReviewSource {
    Pick,
    /// The stored pin's path, for "Trust new build".
    Pinned,
}

#[derive(Debug, Serialize)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum Review {
    Cancelled,
    Inspected {
        path: String,
        sha256: String,
        size: u64,
        warnings: Vec<String>,
    },
    Refused(Refusal),
}

#[derive(Debug, Serialize)]
pub struct TestRunReport {
    pub version_suggestion: Option<String>,
    pub excerpt: String,
}

#[derive(Debug, Deserialize)]
pub struct SaveRequest {
    pub sha256: String,
    pub label: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum State {
    Off,
    InUse,
    Changed,
    Missing,
    /// Another account could now change the file or a folder above it.
    Unsafe,
    /// `BB_BINARY_PATH` outranks every route.
    Overridden,
    /// This build refuses the label as a vulnerable version, so no request can select it.
    Revoked,
}

#[derive(Debug, Serialize)]
pub struct Status {
    pub state: State,
    pub label: Option<String>,
    pub path: Option<String>,
    pub sha256: Option<String>,
    /// The file's hash now, when it no longer matches the pin.
    pub current_sha256: Option<String>,
    pub pinned_at: Option<i64>,
    pub refusal: Option<Refusal>,
    pub activity: CustomBbActivity,
}

/// The pin's state without the activity. Blocking: it rehashes the file.
struct Pinned {
    state: State,
    pin: Option<CustomBbPin>,
    current_sha256: Option<String>,
    refusal: Option<Refusal>,
}

fn pinned(config: &ConfigStore) -> Pinned {
    let Some(pin) = config.effective_custom_bb() else {
        return Pinned {
            state: State::Off,
            pin: None,
            current_sha256: None,
            refusal: None,
        };
    };
    let (mut current_sha256, mut refusal) = (None, None);
    let state = if core_bb::env_override_active() {
        State::Overridden
    } else if core_bb::check_label(pin.label.as_str()).is_err() {
        State::Revoked
    } else {
        match core_bb::verify_for_spawn(&pin) {
            Ok(_) => State::InUse,
            Err(Unavailable::Changed) => {
                current_sha256 = core_bb::inspect(&pin.path).ok().map(|i| i.sha256);
                State::Changed
            }
            Err(Unavailable::Missing) => State::Missing,
            Err(Unavailable::Unsafe(why)) => {
                refusal = Some(why);
                State::Unsafe
            }
            Err(Unavailable::Withdrawn) => State::Off,
        }
    };
    Pinned {
        state,
        pin: Some(pin),
        current_sha256,
        refusal,
    }
}

/// Blocking: it rehashes the pinned file.
pub fn status(config: &ConfigStore, activity: CustomBbActivity) -> Status {
    let Pinned {
        state,
        pin,
        current_sha256,
        refusal,
    } = pinned(config);
    Status {
        state,
        label: pin.as_ref().map(|p| p.label.as_str().to_string()),
        path: pin.as_ref().map(|p| core_bb::display_path(&p.path)),
        sha256: pin.as_ref().map(|p| p.sha256.clone()),
        current_sha256,
        pinned_at: pin.as_ref().map(|p| p.pinned_at),
        refusal,
        activity,
    }
}

/// The tray's line under the version, and the tooltip's suffix.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TraySummary {
    pub line: Option<String>,
    pub tooltip_suffix: Option<&'static str>,
}

pub fn tray_summary(state: State, label: Option<&str>) -> TraySummary {
    let line = match state {
        State::Off => None,
        State::InUse => Some(format!("Custom bb: {}", label.unwrap_or("?"))),
        State::Overridden => Some("Custom bb overridden".to_string()),
        State::Changed => Some("Custom bb changed: not used".to_string()),
        State::Missing => Some("Custom bb missing: not used".to_string()),
        State::Unsafe => Some("Custom bb unsafe: not used".to_string()),
        State::Revoked => Some("Custom bb revoked: not used".to_string()),
    };
    let tooltip_suffix = match state {
        State::Off => None,
        State::InUse => Some(" · custom bb on"),
        _ => Some(" · custom bb not used"),
    };
    TraySummary {
        line,
        tooltip_suffix,
    }
}

/// Blocking: it rehashes the pinned file.
pub fn current_tray_summary(config: &ConfigStore) -> TraySummary {
    let Pinned { state, pin, .. } = pinned(config);
    tray_summary(state, pin.as_ref().map(|p| p.label.as_str()))
}

/// The label the approval popup names: only while the request's first version is the one the
/// custom bb answers now.
pub fn popup_label(
    first_version: Option<&AztecVersion>,
    effective: Option<&CustomBbPin>,
    overridden: bool,
) -> Option<String> {
    let pin = effective.filter(|_| !overridden)?;
    (first_version? == &pin.label).then(|| pin.label.as_str().to_string())
}

const NOT_REVIEWED: &str = "Review the file again: this is not the file Presto inspected.";

/// Everything a save requires: developer mode, no override, the reviewed and tested candidate with
/// exactly these bytes, a label a request can select, and a fresh rehash that still matches.
/// `rehash` runs last, so a refusal costs no I/O.
pub(crate) fn check_save(
    candidate: Option<&Candidate>,
    request: &SaveRequest,
    developer_on: bool,
    overridden: bool,
    rehash: impl FnOnce(&CustomBbPin) -> Result<PathBuf, Unavailable>,
    now: i64,
) -> Result<CustomBbPin, String> {
    if !developer_on {
        return Err("Turn developer mode on first.".to_string());
    }
    if overridden {
        return Err(
            "BB_BINARY_PATH overrides every bb choice. Quit Presto and start it without it."
                .to_string(),
        );
    }
    let candidate = candidate
        .filter(|c| c.inspection.sha256 == request.sha256)
        .ok_or(NOT_REVIEWED)?;
    if !candidate.tested {
        return Err("Run the test first: it must pass for this file.".to_string());
    }
    let label = core_bb::check_label(&request.label)
        .map_err(|e| format!("{} {}.", request.label, e.reason()))?;
    let pin = CustomBbPin {
        path: candidate.inspection.path.clone(),
        sha256: request.sha256.clone(),
        label,
        pinned_at: now,
    };
    match rehash(&pin) {
        Ok(_) => Ok(pin),
        Err(Unavailable::Unsafe(refusal)) => Err(refusal.message),
        Err(Unavailable::Missing) => Err("The file is gone. Choose it again.".to_string()),
        Err(Unavailable::Changed | Unavailable::Withdrawn) => {
            Err("The file changed after the test run. Review it again.".to_string())
        }
    }
}

fn require_developer_mode(config: &ConfigStore) -> Result<(), String> {
    if config.read().developer.enabled {
        Ok(())
    } else {
        Err("Turn developer mode on first.".to_string())
    }
}

/// The tray line may be stale: rebuild it.
pub fn notify_changed(app: &tauri::AppHandle) {
    if let Some(changed) = app
        .try_state::<SharedAppState>()
        .and_then(|state| state.on_custom_bb_changed.clone())
    {
        changed();
    }
}

static PICKER_OPEN: AtomicBool = AtomicBool::new(false);

struct PickerOpen;

impl Drop for PickerOpen {
    fn drop(&mut self) {
        PICKER_OPEN.store(false, Ordering::Release);
    }
}

/// The native picker, parented to Settings, one at a time. `None` when the user cancels.
async fn pick(
    app: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
) -> Result<Option<PathBuf>, String> {
    if let Some(test) = app.try_state::<TestPick>() {
        return Ok(Some(test.0.clone()));
    }
    if PICKER_OPEN.swap(true, Ordering::AcqRel) {
        return Err("A file chooser is already open.".to_string());
    }
    let _open = PickerOpen;
    let (chosen, answer) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_parent(window)
        .set_title("Choose your bb")
        .pick_file(move |file| {
            let _ = chosen.send(file);
        });
    let file = answer
        .await
        .map_err(|_| "The file chooser closed unexpectedly.".to_string())?;
    file.map(|f| f.into_path().map_err(|e| e.to_string()))
        .transpose()
}

/// Inspect a file without running it and make it the candidate: picked, or the stored pin's path
/// for "Trust new build". A refusal clears the candidate.
#[tauri::command]
pub async fn custom_bb_review(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    config: tauri::State<'_, ConfigState>,
    candidate: tauri::State<'_, CandidateState>,
    source: ReviewSource,
) -> Result<Review, String> {
    require_label(window.label(), SETTINGS_LABEL)?;
    require_developer_mode(&config)?;
    let path = match source {
        ReviewSource::Pinned => {
            config
                .effective_custom_bb()
                .ok_or("No custom bb is set.")?
                .path
        }
        ReviewSource::Pick => match pick(&app, &window).await? {
            Some(path) => path,
            None => return Ok(Review::Cancelled),
        },
    };
    let inspected = tauri::async_runtime::spawn_blocking(move || core_bb::inspect(&path))
        .await
        .map_err(|e| e.to_string())?;
    let mut slot = candidate.lock();
    Ok(match inspected {
        Ok(inspection) => {
            let review = Review::Inspected {
                path: core_bb::display_path(&inspection.path),
                sha256: inspection.sha256.clone(),
                size: inspection.size,
                warnings: inspection.warnings.clone(),
            };
            *slot = Some(Candidate {
                inspection,
                tested: false,
            });
            review
        }
        Err(refusal) => {
            *slot = None;
            Review::Refused(refusal)
        }
    })
}

/// Runs the candidate once as the user (`bb --version`, under proof containment, holding the prove
/// permit). Containment is not a sandbox: the file can do anything the user can.
#[tauri::command]
pub async fn custom_bb_test_run(
    window: tauri::WebviewWindow,
    config: tauri::State<'_, ConfigState>,
    candidate: tauri::State<'_, CandidateState>,
    shared: tauri::State<'_, SharedAppState>,
    sha256: String,
    acknowledged: bool,
) -> Result<TestRunReport, String> {
    require_label(window.label(), SETTINGS_LABEL)?;
    require_developer_mode(&config)?;
    if !acknowledged {
        return Err("Confirm that you trust this file first.".to_string());
    }
    let path = candidate
        .lock()
        .as_ref()
        .filter(|c| c.inspection.sha256 == sha256)
        .map(|c| c.inspection.path.clone())
        .ok_or(NOT_REVIEWED)?;
    let permit = core_bb::take_test_permit(&shared.prove_semaphore).map_err(|e| e.to_string())?;
    let run = match core_bb::test_run(&path, &sha256, permit).await {
        Ok(run) => run,
        Err(e) => {
            tracing::info!(%sha256, error = %e, "Custom bb test run failed");
            return Err(e.to_string());
        }
    };
    tracing::info!(%sha256, "Custom bb test run passed");
    if let Some(c) = candidate
        .lock()
        .as_mut()
        .filter(|c| c.inspection.sha256 == sha256)
    {
        c.tested = true;
    }
    Ok(TestRunReport {
        version_suggestion: run.version_suggestion.map(|v| v.as_str().to_string()),
        excerpt: run.excerpt,
    })
}

/// `None` stops using the custom bb, with no preconditions. A choice pins the tested candidate
/// for its label, only when [`check_save`] passes.
#[tauri::command]
pub async fn custom_bb_save(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    config: tauri::State<'_, ConfigState>,
    candidate: tauri::State<'_, CandidateState>,
    choice: Option<SaveRequest>,
) -> Result<(), String> {
    require_label(window.label(), SETTINGS_LABEL)?;
    let pin = match choice {
        None => None,
        Some(request) => {
            let reviewed = candidate.lock().clone();
            let store = config.inner().clone();
            let checked = tauri::async_runtime::spawn_blocking(move || {
                let developer_on = store.read().developer.enabled;
                check_save(
                    reviewed.as_ref(),
                    &request,
                    developer_on,
                    core_bb::env_override_active(),
                    core_bb::verify_for_spawn,
                    now_unix_secs(),
                )
            })
            .await
            .map_err(|e| e.to_string())??;
            Some(checked)
        }
    };
    let stopping = pin.is_none();
    try_mutate_config_at(&config, None, |cfg| {
        cfg.set_custom_bb(pin).map_err(|e| e.to_string())
    })?;
    *candidate.lock() = None;
    tracing::info!(stopping, "Custom bb saved");
    notify_changed(&app);
    Ok(())
}

/// Off, in use, or why it is not used, with the activity. Rehashes the file.
#[tauri::command]
pub async fn custom_bb_status(
    window: tauri::WebviewWindow,
    config: tauri::State<'_, ConfigState>,
    shared: tauri::State<'_, SharedAppState>,
) -> Result<Status, String> {
    require_label(window.label(), SETTINGS_LABEL)?;
    let store = config.inner().clone();
    let activity = shared.custom_bb_activity.lock().clone();
    tauri::async_runtime::spawn_blocking(move || status(&store, activity))
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests;

// Prevents additional console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod tray;
mod windows;

use presto::authorization::AuthorizationManager;
use presto::commands::{AuthState, ConfigState, PendingUpdate, SharedAppState};
use presto::server::{AppState, HeadlessState, ServerStatus};
use presto::{certs, commands, config, log_dir, verified_sites};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
// Only the background update loop uses Duration; that loop is gated off for webdriver builds.
#[cfg(not(feature = "webdriver"))]
use std::time::Duration;
use tauri::menu::MenuItemBuilder;
use tauri::Manager;
// AppHandle is only referenced by the (webdriver-gated) update-check fn.
#[cfg(not(feature = "webdriver"))]
use tauri::AppHandle;
use tracing_subscriber::fmt;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::EnvFilter;

/// Returns true in debug builds (`cargo tauri dev`), false in release.
fn is_dev_mode() -> bool {
    cfg!(debug_assertions)
}

/// B3 (observability): append one panic record to `path`, SYNCHRONOUSLY (create + append + flush). This
/// is the guaranteed on-disk record, independent of the async `non_blocking` tracing layer whose flush
/// may not run before `abort`. Extracted from the panic hook so the format/write is unit-testable (the
/// hook installation itself can't be — it ends in abort). Errors are swallowed: a panic handler must
/// never itself panic, and there is nothing better to do if the log write fails mid-crash.
fn write_panic_record(path: &Path, location: &str, payload: &str) {
    use std::io::Write;
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        let _ = writeln!(f, "[{secs}] PANIC at {location}: {payload}");
        // sync_all (fsync), not just flush: a `File` has no userspace buffer to flush, and we need the
        // record on the physical filesystem before the process aborts (codex) — flush would not guarantee
        // that.
        let _ = f.sync_all();
    }
}

/// Open a path or URL in the platform's default handler.
fn open_in_browser(target: &impl AsRef<Path>) {
    let path = target.as_ref();
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(path).spawn();
    #[cfg(target_os = "linux")]
    let result = std::process::Command::new("xdg-open").arg(path).spawn();
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("explorer").arg(path).spawn();

    if let Err(e) = result {
        tracing::warn!(path = %path.display(), error = %e, "Failed to open in browser");
    }
}

// ── HTTPS startup ────────────────────────────────────────────────────────

/// Pure launch-time HTTPS gate, separated so reset-vs-skip behavior is testable without mocks.
#[derive(Debug, PartialEq, Eq)]
enum LaunchHttpsGate {
    /// HTTPS is off — do nothing.
    Disabled,
    /// Enabled but certs are missing/invalid — reset `https_enabled` so the user re-enables.
    MissingCertsReset,
    /// Certs present but the CA isn't trusted in the Keychain — skip WITHOUT reset (keep the opt-in).
    UntrustedSkip,
    /// Certs present and trusted — proceed to load TLS + spawn.
    Ready,
}

/// Classify the launch HTTPS gate. `certs_exist` and `ca_trusted` are thunks so the original
/// short-circuit holds exactly: `certs_exist` is not evaluated unless `https_enabled`, and
/// `ca_trusted` not unless `certs_exist` too. Trust is only ever VERIFIED at launch (the thunk wraps
/// `is_ca_trusted`), never installed — launch must never raise the macOS Keychain prompt.
fn classify_launch_https(
    https_enabled: bool,
    certs_exist: impl FnOnce() -> bool,
    ca_trusted: impl FnOnce() -> bool,
) -> LaunchHttpsGate {
    if !https_enabled {
        LaunchHttpsGate::Disabled
    } else if !certs_exist() {
        LaunchHttpsGate::MissingCertsReset
    } else if !ca_trusted() {
        LaunchHttpsGate::UntrustedSkip
    } else {
        LaunchHttpsGate::Ready
    }
}

/// The BLOCKING half of the launch-time HTTPS bring-up: classify the gate, rotate (Linux), load TLS.
///
/// **Must be called while holding the HTTPS lifecycle lock.** Every cert read and write in here —
/// `certs_exist`, `is_ca_trusted`, the rotation's `swap_into`, the TLS load — has to be serialized
/// against the enable and renewal paths, or launch can observe a MIXED new-leaf/old-key set mid-swap
/// and then reset `https_enabled` over an enable that just succeeded.
/// `None` ⇒ don't start a listener.
#[expect(
    clippy::cognitive_complexity,
    reason = "the launch gate, optional rotation, and TLS load are one fail-closed certificate decision"
)]
fn prepare_launch_https(
    state: &AppState,
) -> Option<std::sync::Arc<tokio_rustls::rustls::ServerConfig>> {
    let cfg = config::load();
    // The pre-load gate is a tested pure classifier; the load-failure reset stays below
    // (it depends on load_rustls_config's Result, not on these three booleans).
    //
    // Linux trust is inherently per-browser/partial, and a bound-but-untrusted loopback
    // listener is harmless — browsers fast-fail the HTTPS probe and the SDK falls back to HTTP. So
    // serve whenever certs are valid, decoupled from trust (which the *wizard* still checks). macOS
    // and Windows keep the verify-trust gate (they'd otherwise present an untrusted cert with a real
    // dialog behind it).
    #[cfg(target_os = "linux")]
    let ca_trusted = || true;
    #[cfg(not(target_os = "linux"))]
    let ca_trusted = certs::is_ca_trusted;
    match classify_launch_https(cfg.https_enabled, certs::certs_exist, ca_trusted) {
        LaunchHttpsGate::Disabled => return None,
        LaunchHttpsGate::MissingCertsReset => {
            tracing::warn!("HTTPS enabled but certs missing/invalid — resetting config");
            reset_https_enabled(state);
            return None;
        }
        LaunchHttpsGate::UntrustedSkip => {
            tracing::warn!("CA not trusted in Keychain — skipping HTTPS");
            return None;
        }
        LaunchHttpsGate::Ready => {}
    }

    // Pre-expiry renewal (§7). Linux: SILENT rotation (user NSS needs no prompt) done BEFORE loading +
    // binding the TLS config, so the FRESH leaf is what we serve. Doing it after the bind left the
    // acceptor holding the OLD leaf for the whole session — a long-running tray app would eventually
    // serve an EXPIRED cert. macOS/Windows do NOT rotate here — the setup
    // closure surfaces a renewal *consent window* instead of a surprise background OS trust prompt.
    #[cfg(target_os = "linux")]
    if let Err(e) = certs::regenerate_leaf_if_expiring() {
        tracing::warn!("Background leaf renewal: {e}");
    }

    match certs::load_rustls_config() {
        Ok(c) => Some(c),
        Err(e) => {
            // A broken/mismatched cert set (e.g. a crash mid-rotation leaving a new leaf with the old
            // key) must NOT silently wedge HTTPS. Reset https_enabled so the user re-enables and a
            // fresh, matched, trusted set is generated, instead of HTTPS being dead every launch.
            tracing::warn!("Failed to load TLS config ({e}) — resetting https_enabled to recover");
            reset_https_enabled(state);
            None
        }
    }
}

/// Launch-time HTTPS bring-up, fully serialized against the enable and renewal paths.
///
/// Runs entirely off the setup thread. It **waits** for the HTTPS lifecycle lock rather than standing
/// down on a failed try-lock: renewal can own that lock without ever binding a listener, so standing
/// down would leave HTTPS unstarted for the whole session. After acquiring
/// it, re-check `https_bound` — an enable path may have completed the entire bring-up while we waited.
/// The blocking cert work then runs on a blocking thread so it never occupies an async worker.
#[expect(
    clippy::cognitive_complexity,
    reason = "lifecycle locking, blocking preparation, and bind readiness are one launch transaction"
)]
async fn launch_https(state: AppState) {
    // Cheap config read — no lock needed to learn HTTPS is simply off.
    if !config::load().https_enabled {
        return;
    }

    let guard = presto::server::claim_https_lifecycle(&state).await;

    if state.https_bound.load(Ordering::Relaxed) {
        tracing::debug!("HTTPS already bound by another path — launch gate has nothing to do");
        return; // `guard` drops here
    }

    let prep_state = state.clone();
    let tls_config =
        match tauri::async_runtime::spawn_blocking(move || prepare_launch_https(&prep_state)).await
        {
            Ok(Some(tls)) => tls,
            Ok(None) => return, // gate said no (or reset) — `guard` drops
            Err(e) => {
                tracing::error!("HTTPS prepare task failed: {e}");
                return;
            }
        };

    // Await the bind while still HOLDING the guard, so no other path can start a competing bring-up
    // or mutate the cert set while our listener is coming up. `guard` drops at end of scope,
    // releasing the lock for enable/renewal/removal; the serving loop itself runs unlocked.
    let ready = presto::server::spawn_https(state, tls_config);
    match ready.await {
        Ok(true) => tracing::info!("HTTPS listener started at launch"),
        _ => tracing::warn!("HTTPS listener did not bind at launch — continuing HTTP-only"),
    }
    drop(guard);
}

/// Disable HTTPS in config (certs missing/invalid/untrusted) so the user can re-enable to
/// regenerate a fresh, trusted cert set.
fn reset_https_enabled(state: &AppState) {
    if let Some(ref store) = state.config {
        // q7e3-F-13: shared core helper; swallow the save error (best-effort reset, unchanged policy).
        // B4: persist only with the capability; a newer-schema config is reset in-memory only.
        match store.cap.as_ref() {
            Some(cap) => {
                let _ = config::lock_mutate_save(&store.lock, cap, |cfg| {
                    cfg.https_enabled = false;
                    true
                });
            }
            None => store.lock.write().https_enabled = false,
        }
    }
}

// ── Auto-update ──────────────────────────────────────────────────────────

/// Whether the background update poller should run.
///
/// A non-production build must never poll the prod updater feed or pop the
/// update-prompt window:
/// - `webdriver` builds are handled at compile time (this fn + the spawn site
///   are `#[cfg(not(feature = "webdriver"))]`), so the poller cannot exist there.
/// - `debug_assertions` (a developer's `cargo tauri dev`, and the `_e2e.yml`
///   `cargo run` desktop app) are disabled by default — opt back in with
///   `PRESTO_FORCE_UPDATE_CHECK=1`.
/// - `PRESTO_NO_UPDATE=1` is a universal kill switch (logged, for audit).
///
/// The shipped release desktop binary (release profile, no `webdriver`, no env
/// overrides) returns `true` — auto-update behavior is unchanged.
#[cfg(not(feature = "webdriver"))]
#[expect(
    clippy::cognitive_complexity,
    reason = "the two environment gates are the complete update-poller policy"
)]
fn should_poll_for_updates() -> bool {
    if std::env::var("PRESTO_NO_UPDATE").is_ok() {
        tracing::warn!("PRESTO_NO_UPDATE set — background update checks suppressed");
        return false;
    }
    if cfg!(debug_assertions) && std::env::var("PRESTO_FORCE_UPDATE_CHECK").is_err() {
        tracing::info!(
            "Debug build — background update checks disabled (set PRESTO_FORCE_UPDATE_CHECK=1 to enable)"
        );
        return false;
    }
    true
}

/// Background update check wrapper. Calls the shared updater module and
/// shows the prompt window if an update is available and the user hasn't chosen yet.
///
/// Not compiled for `webdriver` builds: the prompt window would steal the
/// active WebDriver browsing context mid-test (see
/// implementations-plan/ci-reliability-2026-05-29/diagnosis.md).
#[cfg(not(feature = "webdriver"))]
async fn run_update_check(app: &AppHandle, config_state: &ConfigState) {
    if let Some(update) = presto::updater::check_for_update(app, config_state).await {
        let auto_update_pref = { config_state.read().auto_update };
        let current_version = env!("CARGO_PKG_VERSION").to_string();
        let new_version = update.version().to_string();

        // Store the update so respond_update_prompt can use it directly
        if let Some(pending) = app.try_state::<PendingUpdate>() {
            pending.set(update);
        }

        // Show prompt for both None (first time) and Some(false) (manual mode).
        // Some(true) users never reach here — check_for_update auto-installs for them.
        tracing::info!(
            ?auto_update_pref,
            version = %new_version,
            "Showing update prompt"
        );
        windows::show_update_prompt_window(app, &current_version, &new_version);
    }
}

// ── Exit handling ────────────────────────────────────────────────────────

/// Returns true if the exit should be prevented.
/// Window-close events have code=None and should be prevented (tray-only app).
/// Explicit exits (Quit menu, restart) have code=Some(_) and must go through.
fn should_prevent_exit(code: Option<i32>) -> bool {
    code.is_none()
}

// ── Main ─────────────────────────────────────────────────────────────────

/// Spawn the HTTP presto server, classifying an `AddrInUse` bind failure structurally. A
/// redundant Windows instance (Task Scheduler logon trigger + autostart Run key both fire) bows out
/// with exit(0) when a healthy Aztec already owns :59833; any other failure surfaces in the tray and
/// stays resident. (F-03: extracted verbatim from the `.setup` closure.)
fn spawn_http_server(
    state: presto::server::AppState,
    status: tauri::menu::MenuItem<tauri::Wry>,
    tray: tauri::tray::TrayIcon<tauri::Wry>,
    app_handle: tauri::AppHandle,
) {
    tauri::async_runtime::spawn(async move {
        if let Err(e) = presto::server::start(state).await {
            // Classify AddrInUse STRUCTURALLY (by ErrorKind), not by display text — the OS string
            // differs per platform (Windows WSAEADDRINUSE reads "Only one usage of each socket
            // address…"), so a string match would miss it on Windows and skip the whole dual-launch
            // fix on its target platform. bind_with_retry returns the io::Error, boxed by `?`.
            let addr_in_use = e
                .downcast_ref::<std::io::Error>()
                .is_some_and(|io| io.kind() == std::io::ErrorKind::AddrInUse);
            // A redundant instance loses the :59833 bind — the autostart entry AND the crash-recovery
            // launcher can both start us at logon. If a HEALTHY Aztec instance already owns the port,
            // bow out with exit(0) rather than ghosting a tray with no server (exit 0 so the
            // supervisor's restart-on-failure does NOT loop us). A foreign process / no answer is a
            // real error: surface it and stay resident. WINDOWS-ONLY for now (the dual-launch is a new
            // Windows issue); the `&&` short-circuits so /health is only probed on Windows.
            // F-03 sink A: `/health` answering "ok" proves only that SOMETHING is listening — both
            // fields are public contract, so any local process can say it and evict the real app,
            // taking its HTTPS listener down with it (which is what opens F-01 on Windows). Ask the
            // OS who owns the socket as well.
            //
            // D-ITEM7 polarity: `may_bow_out` exits unless the owner is POSITIVELY foreign, so
            // `Ours` and `Unknown` both behave exactly as before. This path runs every minute on
            // Windows (the crash-recovery task's PT1M trigger), so treating a transient lookup
            // failure as "stay resident" would strand duplicate tray processes.
            if addr_in_use && cfg!(target_os = "windows") {
                // ONE connection answers both questions. Probing health and identifying the owner
                // separately is a deterministic bypass, not a race: a one-shot listener can accept
                // the health request, close its listening socket, answer healthy over the accepted
                // socket, and leave the second lookup with nothing to find — which is `Unknown`, and
                // `Unknown` exits (post-impl codex round 7). Blocking, so it runs off the async
                // runtime's worker.
                let (healthy, owner) =
                    tokio::task::spawn_blocking(|| presto::server::probe_and_identify(59833))
                        .await
                        .unwrap_or((false, presto::server::PortOwner::Unknown));
                if presto::server::may_bow_out(healthy, owner) {
                    tracing::warn!(
                        ?owner,
                        "Another healthy Aztec instance owns :59833 — this instance is redundant; exiting cleanly"
                    );
                    app_handle.exit(0);
                    return;
                }
                if healthy {
                    tracing::error!(
                        ?owner,
                        "A process answering /health owns :59833 but is NOT our image — staying resident rather than letting it evict us"
                    );
                }
            }
            let msg = if addr_in_use {
                presto::server::PORT_CONFLICT_GUIDANCE
            } else {
                "Error: server failed"
            };
            tracing::error!("Presto server error: {e}. {msg}");
            let _ = status.set_text(msg);
            let _ = tray.set_tooltip(Some(msg));
        }
    });
}

/// Spawn the background update poller (5s warm-up, then every 12h). (F-03: extracted from `.setup`.)
#[cfg(not(feature = "webdriver"))]
fn spawn_update_poller(app_handle: AppHandle, config: ConfigState) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(5)).await;
        loop {
            run_update_check(&app_handle, &config).await;
            tokio::time::sleep(Duration::from_secs(12 * 3600)).await;
        }
    });
}

/// Spawn the F-004 Layer B post-launch floor tracker. Once THIS build's OWN presto server has
/// answered `/health` — as a healthy Aztec reporting OUR exact version — 3 consecutive times, advance
/// the monotonic version floor to the running version. Two guards matter (audit H3):
///   - 3 consecutive HEALTHY probes (not merely "process started") means a build that boots but
///     immediately wedges its server never ratchets the floor;
///   - the reported `/health.version` must equal `CARGO_PKG_VERSION`, AND this process must actually
///     own the `:59833` bind. The version match alone does NOT prove we are observing our own server
///     — the comment here used to claim it did, which is what made F-03 sink B look safe. On
///     macOS/Linux a broken new build that LOST the bind still sees the healthy INCUMBENT's
///     `/health`, and any local process can serve those fields. Ownership of the bind is the
///     in-process fact that cannot be forged.
///
/// Runs once; gated off for webdriver builds.
#[cfg(not(feature = "webdriver"))]
fn spawn_floor_tracker() {
    tauri::async_runtime::spawn(async move {
        let want = env!("CARGO_PKG_VERSION");
        let mut consecutive = 0u32;
        // Bounded (~2 min) so a genuinely unhealthy build never commits the floor.
        for _ in 0..40 {
            tokio::time::sleep(Duration::from_secs(3)).await;
            // F-03 sink B: the probe proves the server SERVES (a bound-but-wedged build must never
            // ratchet the floor), and `we_own_the_bind()` proves the server is OURS. Neither alone
            // is sufficient, and the probe alone was forgeable by any local process.
            let probed = presto::server::healthy_aztec_version_on_port().await;
            if presto::server::should_commit_floor(
                presto::server::we_own_the_bind(),
                probed.as_deref(),
                want,
            ) {
                consecutive += 1;
                if consecutive >= 3 {
                    presto::updater::commit_launch_floor();
                    return;
                }
            } else {
                consecutive = 0;
            }
        }
        tracing::warn!(
            version = want,
            "Launch never reached 3 consecutive healthy version-matched probes; version floor not advanced this run"
        );
    });
}

// ── Desktop bootstrap ────────────────────────────────────────────────────
// The setup sequence stays explicit because CA-key migration must precede HTTPS, and shared state
// must be managed before commands, WebDriver windows, or either server can observe it.

/// Build the tray menu + icon with the static menu-event handler.
fn build_tray(
    app: &tauri::App,
    dev_mode: bool,
    bundled_version: &str,
    status: &tauri::menu::MenuItem<tauri::Wry>,
) -> Result<tauri::tray::TrayIcon, Box<dyn std::error::Error>> {
    let menu = tray::build_tray_menu(&app.handle().clone(), dev_mode, bundled_version, status)?;
    tray::build_tray_icon(app, &menu, move |app, event| match event.id().as_ref() {
        "quit" => {
            // The repeating-trigger crash-recovery task relaunches anything not
            // running, so an intentional quit must delete it first or the app
            // returns within ~1 min. A crash skips this path → the task survives
            // → relaunch. Windows-only: mac/linux key on exit code (launchd
            // SuccessfulExit:false / systemd on-failure), so a clean quit is a
            // no-op there and the recovery entry must persist across quit.
            // codex #7: surface (log) a non-confirmed disarm — an unconfirmed disable here means the
            // Task Scheduler recovery entry may survive and relaunch the app within ~1 min of this quit.
            // Piece 2 (A5): the disarm is serialized behind autostart.lock inside the seam —
            // it cannot interleave with the marker reconcile's arm→remove span.
            #[cfg(target_os = "windows")]
            presto::autostart::quit_disarm();
            app.exit(0);
        }
        "show_logs" => open_in_browser(&log_dir()),
        "open_github" => {
            open_in_browser(&"https://github.com/alejoamiras/presto");
        }
        "settings" => windows::open_settings_window(app),
        _ => {}
    })
}

/// Wire the desktop `AppState`: the versions-changed tray rebuild, the auth popup, and the
/// status-text/tooltip/animation callback. **Consumes `status`** (it moves into the versions-changed
/// callback) — anything the caller needs afterwards must be cloned BEFORE this call, which turns the
/// old "clone before the move" comment into a compiler-enforced property.
#[allow(clippy::too_many_arguments)]
fn build_desktop_state(
    app: &tauri::App,
    dev_mode: bool,
    bundled_version: String,
    status: tauri::menu::MenuItem<tauri::Wry>,
    tray: &tauri::tray::TrayIcon,
    is_animating: &Arc<AtomicBool>,
    config_state: &ConfigState,
    auth_manager: &AuthState,
) -> AppState {
    let on_versions_changed = versions_changed_callback(
        app.handle().clone(),
        dev_mode,
        bundled_version.clone(),
        status.clone(),
        tray.clone(),
    );
    let show_auth_popup = auth_popup_callback(app.handle().clone(), auth_manager.clone());
    let on_status = status_callback(status, tray.clone(), is_animating.clone());

    let core = HeadlessState::headless(
        env!("CARGO_PKG_VERSION"),
        Some(bundled_version),
        Some(config_state.clone()),
        Some(auth_manager.clone()),
    );
    AppState::desktop(core, on_status, on_versions_changed, show_auth_popup)
}

#[expect(
    clippy::cognitive_complexity,
    reason = "the callback has one development gate and one tray-menu rebuild result"
)]
fn versions_changed_callback(
    app: tauri::AppHandle,
    dev_mode: bool,
    bundled_version: String,
    status: tauri::menu::MenuItem<tauri::Wry>,
    tray_icon: tauri::tray::TrayIcon,
) -> presto::server::VersionsChangedCallback {
    Arc::new(move || {
        if !dev_mode {
            return;
        }
        match tray::build_tray_menu(&app, dev_mode, &bundled_version, &status) {
            Ok(menu) => {
                let _ = tray_icon.set_menu(Some(menu));
                tracing::info!("Tray menu rebuilt (versions changed)");
            }
            Err(error) => tracing::warn!("Failed to rebuild tray menu: {error}"),
        }
    })
}

fn auth_popup_callback(
    app: tauri::AppHandle,
    auth_manager: AuthState,
) -> presto::server::ShowAuthPopupCallback {
    Arc::new(move |origin, request_id| {
        windows::show_auth_popup_window(&app, origin, request_id, &auth_manager);
    })
}

#[expect(
    clippy::cognitive_complexity,
    reason = "menu text, tooltip, and animation must observe the same server-status transition"
)]
fn status_callback(
    status_item: tauri::menu::MenuItem<tauri::Wry>,
    tray_icon: tauri::tray::TrayIcon,
    is_animating: Arc<AtomicBool>,
) -> presto::server::StatusCallback {
    Arc::new(move |status: ServerStatus| {
        let text = status.display_text();
        tracing::info!(text, "on_status callback fired");
        if let Err(error) = status_item.set_text(text) {
            tracing::error!("set_text failed: {error}");
        }
        if let Err(error) = tray_icon.set_tooltip(Some(text)) {
            tracing::error!("set_tooltip failed: {error}");
        }
        is_animating.store(status.is_busy(), Ordering::Release);
    })
}

/// Print per-store results for NSIS and fail its uninstall hook if CA removal is incomplete.
fn handle_remove_ca_trust() -> bool {
    if !std::env::args().any(|arg| arg == "--remove-ca-trust") {
        return false;
    }
    let report = presto::trust::remove_ca_trust(&certs::live_ca_cert_path());
    for store in &report.stores {
        println!(
            "{}: {}",
            store.store,
            if store.installed {
                "still trusted"
            } else {
                "removed / absent"
            }
        );
    }
    if report.removal_incomplete() {
        eprintln!("error: CA trust removal was incomplete — see the per-store lines above");
        std::process::exit(1);
    }
    true
}

/// Print ownership-checked teardown results for NSIS and fail its hook if cleanup is incomplete.
fn handle_prepare_uninstall() -> bool {
    if !std::env::args().any(|arg| arg == "--prepare-uninstall") {
        return false;
    }
    let outcome = presto::uninstall::prepare_uninstall();
    for line in outcome.report_lines() {
        println!("{line}");
    }
    if outcome.incomplete() {
        eprintln!("error: uninstall cleanup was incomplete — see the lines above");
        std::process::exit(1);
    }
    true
}

/// Generate the real certificate set for headless packaging tests; trust installation remains external.
fn handle_generate_certs() -> bool {
    if !std::env::args().any(|arg| arg == "--generate-certs-only") {
        return false;
    }
    match certs::generate_and_save() {
        Ok(()) => {
            println!(
                "generated CA + leaf at {}",
                certs::live_ca_cert_path().display()
            );
            true
        }
        Err(error) => {
            eprintln!("error: certificate generation failed: {error}");
            std::process::exit(1);
        }
    }
}

fn install_panic_hook(log_path: &Path) {
    let panic_log = log_path.join("panic.log");
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let location = info
            .location()
            .map(|location| {
                format!(
                    "{}:{}:{}",
                    location.file(),
                    location.line(),
                    location.column()
                )
            })
            .unwrap_or_else(|| "unknown".to_string());
        let payload = info
            .payload()
            .downcast_ref::<&str>()
            .map(|message| (*message).to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "<non-string panic payload>".to_string());
        write_panic_record(&panic_log, &location, &payload);
        tracing::error!(%location, payload = %payload, "PANIC");
        previous(info);
    }));
}

fn initialize_logging() -> tracing_appender::non_blocking::WorkerGuard {
    let log_path = log_dir();
    std::fs::create_dir_all(&log_path).ok();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&log_path, std::fs::Permissions::from_mode(0o700));
    }
    let file_appender = tracing_appender::rolling::RollingFileAppender::builder()
        .rotation(tracing_appender::rolling::Rotation::DAILY)
        .filename_prefix("presto")
        .filename_suffix("log")
        .max_log_files(7)
        .build(&log_path)
        .expect("failed to create log appender");
    let (file_writer, guard) = tracing_appender::non_blocking(file_appender);
    let env_filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    tracing_subscriber::registry()
        .with(env_filter)
        .with(fmt::layer().with_writer(std::io::stdout))
        .with(fmt::layer().with_writer(file_writer).with_ansi(false))
        .init();
    tracing::info!(log_dir = %log_path.display(), "Logging initialized");
    install_panic_hook(&log_path);
    guard
}

#[cfg_attr(
    not(feature = "webdriver"),
    expect(
        clippy::cognitive_complexity,
        reason = "marker reconciliation must precede both healing and intent-keyed recovery rearming"
    )
)]
fn reconcile_startup_autostart(app: &tauri::AppHandle) {
    if !presto::autostart::startup_reconcile() {
        return;
    }
    #[cfg(not(feature = "webdriver"))]
    match presto::autostart::heal_if_broken(app) {
        presto::autostart::HealOutcome::Healed { from, to } => {
            tracing::info!(%from, %to, "startup autostart heal applied");
        }
        presto::autostart::HealOutcome::Failed(error) => {
            tracing::warn!("startup autostart heal failed: {error}");
        }
        presto::autostart::HealOutcome::Skipped(reason) => {
            tracing::debug!("startup autostart heal skipped: {reason}");
        }
        presto::autostart::HealOutcome::NotNeeded => {}
    }
    presto::autostart::startup_rearm(app);
}

fn spawn_launch_https(state: &AppState) {
    match certs::migrate_legacy_ca_key() {
        Ok(()) => {
            tauri::async_runtime::spawn(launch_https(state.clone()));
        }
        Err(error) => {
            tracing::error!(
                error = %error,
                "SECURITY: legacy ca.key could not be removed — HTTPS NOT started (HTTP unaffected)"
            );
        }
    };
}

fn report_missing_bb(
    status: &tauri::menu::MenuItem<tauri::Wry>,
    tray_icon: &tauri::tray::TrayIcon,
) {
    if presto::bb::find_bb(None).is_ok() {
        return;
    }
    tracing::warn!("bb binary not found at startup");
    let _ = status.set_text("Warning: bb not found");
    let _ = tray_icon.set_tooltip(Some("Warning: bb not found"));
}

fn show_startup_windows(app: &tauri::AppHandle, _config_state: &ConfigState) {
    #[cfg(not(feature = "webdriver"))]
    if _config_state.read().onboarding_version < config::ONBOARDING_VERSION {
        windows::show_onboarding_window(app);
    }
    #[cfg(all(
        any(target_os = "macos", target_os = "windows"),
        not(feature = "webdriver")
    ))]
    maybe_show_renewal_window(app);
    #[cfg(feature = "webdriver")]
    windows::open_settings_window(app);
}

#[cfg(all(
    any(target_os = "macos", target_os = "windows"),
    not(feature = "webdriver")
))]
fn maybe_show_renewal_window(app: &tauri::AppHandle) {
    const RENEWAL_THROTTLE_SECS: i64 = 20 * 3600;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0);
    let config = config::load();
    let recently_prompted = config
        .last_rotation_prompt_at
        .is_some_and(|time| now.saturating_sub(time) < RENEWAL_THROTTLE_SECS);
    if config.https_enabled
        && !recently_prompted
        && certs::certs_exist()
        && certs::leaf_is_expiring()
    {
        windows::show_renewal_window(app);
    }
}

#[cfg(not(feature = "webdriver"))]
fn start_background_tasks(app: &tauri::AppHandle, config_state: &ConfigState) {
    if should_poll_for_updates() {
        spawn_update_poller(app.clone(), config_state.clone());
        spawn_floor_tracker();
    }
}

fn setup_desktop(
    app: &mut tauri::App,
    dev_mode: bool,
    config_state: &ConfigState,
    auth_manager: &AuthState,
) -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(target_os = "macos")]
    app.set_activation_policy(tauri::ActivationPolicy::Accessory);

    let bundled_version = env!("AZTEC_BB_VERSION").to_string();
    let status = MenuItemBuilder::with_id("status", "Ready")
        .enabled(false)
        .build(app)?;
    reconcile_startup_autostart(app.handle());

    let tray_icon = build_tray(app, dev_mode, &bundled_version, &status)?;
    let is_animating = Arc::new(AtomicBool::new(false));
    tray::start_animation_loop(
        tray_icon.clone(),
        app.handle().clone(),
        is_animating.clone(),
    );

    let diagnostic_status = status.clone();
    let diagnostic_tray = tray_icon.clone();
    let state = build_desktop_state(
        app,
        dev_mode,
        bundled_version,
        status,
        &tray_icon,
        &is_animating,
        config_state,
        auth_manager,
    );
    spawn_launch_https(&state);
    // Commands and WebDriver windows must not run before the shared state is managed.
    app.manage::<SharedAppState>(Arc::new(state.clone()));
    report_missing_bb(&diagnostic_status, &diagnostic_tray);
    show_startup_windows(app.handle(), config_state);
    spawn_http_server(
        state,
        diagnostic_status,
        diagnostic_tray,
        app.handle().clone(),
    );
    #[cfg(not(feature = "webdriver"))]
    start_background_tasks(app.handle(), config_state);
    Ok(())
}

#[cfg_attr(
    feature = "webdriver",
    expect(
        clippy::cognitive_complexity,
        reason = "webdriver adds one compile-time plugin-registration branch to the startup sequence"
    )
)]
fn main() {
    if handle_remove_ca_trust() || handle_prepare_uninstall() {
        return;
    }

    // Install a default rustls CryptoProvider. Both aws-lc-rs (from tauri-plugin-updater)
    // and ring (from tokio-rustls) are available — rustls panics if it can't auto-detect.
    let _ = tokio_rustls::rustls::crypto::aws_lc_rs::default_provider().install_default();

    // Certificate generation needs the CryptoProvider, but intentionally starts no GUI or server.
    if handle_generate_certs() {
        return;
    }
    let _logging_guard = initialize_logging();

    let dev_mode = is_dev_mode();
    if dev_mode {
        tracing::info!("Developer mode enabled");
    }

    // Load config early so it can be shared with AppState and Tauri commands. B4: two-stage save-capable
    // load — the minted capability rides inside the shared ConfigStore and gates every later persist (a
    // newer-schema config yields none).
    let config_state: ConfigState = Arc::new(config::ConfigStore::new(config::load_with_cap()));
    let auth_manager: AuthState = Arc::new(AuthorizationManager::new());

    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    #[cfg(feature = "webdriver")]
    {
        builder = builder.plugin(tauri_plugin_webdriver::init());
        tracing::info!("WebDriver plugin registered (port 4445)");
    }

    builder
        .manage(config_state.clone())
        .manage(auth_manager.clone())
        .manage::<commands::VerifiedSitesState>(Arc::new(
            verified_sites::VerifiedSitesRegistry::load(),
        ))
        .manage::<PendingUpdate>(PendingUpdate::default())
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::get_autostart_enabled,
            commands::set_autostart,
            commands::repair_autostart,
            commands::set_speed,
            commands::set_theme,
            commands::remove_approved_origin,
            commands::get_system_info,
            commands::get_verified_info,
            commands::get_pending_auth,
            commands::respond_auth,
            commands::enable_https,
            commands::disable_https,
            commands::remove_https_trust,
            commands::get_onboarding_state,
            commands::complete_onboarding,
            commands::renew_cert,
            commands::record_renewal_prompt,
            commands::set_auto_update,
            commands::respond_update_prompt,
        ])
        .setup(move |app| setup_desktop(app, dev_mode, &config_state, &auth_manager))
        .build(tauri::generate_context!())
        .expect("error while building Presto")
        .run(|_app, event| {
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
                if should_prevent_exit(code) {
                    api.prevent_exit();
                } else {
                    // B3 (F6): the app IS exiting (explicit tray quit → app.exit(0), or the auto-updater's
                    // app.restart()) — both fire ExitRequested here, so this ONE choke point reaps the
                    // in-flight bb TREE before we go. `kill_on_drop` only reaps the direct child on an
                    // in-process future-drop, never on process exit and never grandchildren. (Windows also
                    // reaps via the Job Object's KILL_ON_JOB_CLOSE when the process handle closes, which
                    // additionally covers the updater's internal `process::exit` on the NSIS handoff.)
                    presto::bb::terminate_inflight();
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exit_prevented_for_window_close() {
        // code=None is sent when the last window closes — must be prevented (tray-only app)
        assert!(should_prevent_exit(None));
    }

    #[test]
    fn exit_allowed_for_explicit_quit() {
        // code=Some(0) is sent by app.exit(0) from the Quit menu
        assert!(!should_prevent_exit(Some(0)));
    }

    #[test]
    fn exit_allowed_for_restart() {
        // code=Some(i32::MAX) is sent by app.restart() during auto-update
        assert!(!should_prevent_exit(Some(i32::MAX)));
    }

    #[test]
    fn write_panic_record_appends_location_and_payload() {
        // B3 (observability): the synchronous panic writer must APPEND (not overwrite) a legible record
        // carrying the location + payload — the guaranteed on-disk crash trail. Neutering the write makes
        // the file empty and fails this.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("panic.log");
        write_panic_record(&path, "src/foo.rs:10:5", "boom");
        write_panic_record(&path, "src/bar.rs:2:1", "kaboom");
        let contents = std::fs::read_to_string(&path).unwrap();
        assert!(
            contents.contains("src/foo.rs:10:5"),
            "missing first location: {contents}"
        );
        assert!(contents.contains("boom"), "missing first payload");
        assert!(
            contents.contains("src/bar.rs:2:1"),
            "second record must APPEND, not overwrite"
        );
        assert!(contents.contains("kaboom"));
        assert_eq!(contents.lines().count(), 2, "one line per panic");
    }

    // The four outcomes pin reset-vs-skip behavior; panicking thunks prove both short-circuits.
    #[test]
    fn launch_gate_disabled_short_circuits_everything() {
        assert_eq!(
            classify_launch_https(
                false,
                || panic!("certs_exist must not be checked when https is off"),
                || panic!("trust must not be checked when https is off"),
            ),
            LaunchHttpsGate::Disabled
        );
    }

    #[test]
    fn launch_gate_missing_certs_resets_and_short_circuits_trust() {
        // certs missing → reset; is_ca_trusted MUST NOT be called (preserves the original short-circuit).
        assert_eq!(
            classify_launch_https(
                true,
                || false,
                || panic!("trust must not be checked when certs are missing")
            ),
            LaunchHttpsGate::MissingCertsReset
        );
    }

    #[test]
    fn launch_gate_untrusted_skips_without_reset() {
        // Certs present but untrusted preserve the user's opt-in rather than resetting it.
        assert_eq!(
            classify_launch_https(true, || true, || false),
            LaunchHttpsGate::UntrustedSkip
        );
    }

    #[test]
    fn launch_gate_ready_when_present_and_trusted() {
        assert_eq!(
            classify_launch_https(true, || true, || true),
            LaunchHttpsGate::Ready
        );
    }
}

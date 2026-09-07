//! `/prove` origin authorization.
//!
//! Approves persisted origins (and localhost only when `auto_approve_localhost` is set — desktop
//! default is prompt-once, SEC-04); otherwise popup-gates the request with a 60s auto-deny
//! (`AUTH_DECISION_TIMEOUT`). Headless mode (no popup callback) denies unapproved origins. All
//! requests are first constrained to a loopback `Host` (SEC-01a, `super::host`). Extracted from
//! server.rs (Q2).

use crate::authorization::{AuthDecision, AuthorizationManager, CanonicalOrigin, RequestError};
use crate::config;

use super::{AppState, ProveError, AUTH_QUEUE_BACKSTOP};

/// Check if the request origin is authorized. Returns Ok(()) if approved.
pub(crate) async fn authorize_origin(
    state: &AppState,
    headers: &axum::http::HeaderMap,
) -> Result<(), ProveError> {
    let Some(auth_manager) = state.auth_manager.as_ref() else {
        return Ok(());
    };
    let Some(origin) = parse_request_origin(headers)? else {
        return Ok(());
    };
    if origin_is_approved(state, &origin) {
        return Ok(());
    }
    if state.show_auth_popup.is_none() {
        tracing::info!(origin = %origin, "Origin not approved (no popup available), denying");
        return Err(ProveError::OriginDenied(origin.to_string()));
    }

    let decision = request_authorization(state, auth_manager, &origin).await?;
    match decision {
        AuthDecision::Allow => persist_approved_origin(state, origin),
        AuthDecision::Deny => {
            tracing::info!(origin = %origin, "Origin denied");
            Err(ProveError::OriginDenied(origin.to_string()))
        }
    }
}

fn parse_request_origin(
    headers: &axum::http::HeaderMap,
) -> Result<Option<CanonicalOrigin>, ProveError> {
    let raw_origin = match headers
        .get(http::header::ORIGIN)
        .and_then(|v| v.to_str().ok())
    {
        Some(o) => o,
        // No Origin header → auto-approve. Browsers always send Origin on cross-origin
        // requests, so this only applies to curl/scripts/same-origin. Non-browser clients
        // can bypass auth by omitting Origin, but this is inherent to localhost services —
        // CORS/Origin is a browser-only mechanism, not a general access control boundary.
        None => return Ok(None),
    };

    let origin = match CanonicalOrigin::parse(raw_origin) {
        Some(canon) => canon,
        None => {
            tracing::warn!(raw_origin = %raw_origin, "Invalid Origin header (path/query/userinfo/unknown scheme); rejecting");
            return Err(ProveError::InvalidOrigin);
        }
    };
    Ok(Some(origin))
}

fn origin_is_approved(state: &AppState, origin: &CanonicalOrigin) -> bool {
    state.config.as_ref().is_some_and(|cfg| {
        let cfg = cfg.read();
        AuthorizationManager::is_approved(origin, &cfg.approved_origins, cfg.auto_approve_localhost)
    })
}

async fn request_authorization(
    state: &AppState,
    auth_manager: &AuthorizationManager,
    origin: &CanonicalOrigin,
) -> Result<AuthDecision, ProveError> {
    tracing::info!(origin = %origin, "Origin not approved, requesting authorization");
    // B2 (F9): `request` checks the post-deny cooldown atomically with the insert (so a concurrent Deny
    // can't slip in and let a just-denied origin re-popup). A cooling-down origin is refused WITHOUT a
    // prompt; only reached for a non-approved, non-headless origin, so approved sites are never affected
    // and expiry restores normal prompt-once behavior.
    let (rx, request_id, is_first, _is_active) = auth_manager
        .request(origin)
        .map_err(|error| map_request_error(origin, error))?;

    if let (true, Some(show_popup)) = (is_first, state.show_auth_popup.as_ref()) {
        // The popup arms its deadline when the request becomes active, not while it waits in the queue.
        show_popup(origin, &request_id);
    }

    // C9 (D18): wait up to the QUEUE BACKSTOP, not 60 s-from-enqueue. The real per-popup 60 s deadline is
    // the popup's activation-armed auto-deny (which resolves Deny → this `rx`), so a request queued behind
    // a busy popup is never denied before the user actually sees it.
    tokio::time::timeout(AUTH_QUEUE_BACKSTOP, rx)
        .await
        .map_err(|_| {
            tracing::warn!(origin = %origin, "Authorization queue backstop elapsed");
            auth_manager.resolve(&request_id, AuthDecision::Deny);
            ProveError::AuthorizationTimeout
        })?
        .map_err(|_| ProveError::AuthorizationCancelled)
}

#[expect(
    clippy::cognitive_complexity,
    reason = "the metric expands tracing fields; this is a two-variant error mapping"
)]
fn map_request_error(origin: &CanonicalOrigin, error: RequestError) -> ProveError {
    match error {
        RequestError::Cooldown => {
            tracing::info!(origin = %origin, "Origin in post-deny cooldown; refusing without re-prompting");
            ProveError::AuthorizationCooldown
        }
        RequestError::TooMany => {
            tracing::warn!(origin = %origin, "Too many pending authorization requests");
            ProveError::TooManyRequests
        }
    }
}

#[expect(
    clippy::cognitive_complexity,
    reason = "the capability and duplicate-origin branches make durable authorization fail closed"
)]
fn persist_approved_origin(state: &AppState, origin: CanonicalOrigin) -> Result<(), ProveError> {
    tracing::info!(origin = %origin, "Origin authorized (persistent)");
    // Unconditional: there is no ephemeral Allow any more. The popup discloses that approving
    // is permanent, so this write IS the thing the user consented to.
    if let Some(ref store) = state.config {
        // q7e3-F-13: shared core helper; the closure's bool keeps the conditional save (only
        // when the origin is new) — no always-write on the piggyback-Allow path. Warn-and-
        // continue on save failure (a config-write error must NOT fail an approved prove).
        // NOTE this is why the popup copy says "stays approved until you remove it in
        // Settings" rather than promising the write succeeded: if it fails the user is asked
        // again, which is safer than promised, never less safe.
        // B4: persist only with the capability — a config written by a NEWER build yields none, so
        // an older app must not overwrite it (the approval simply isn't remembered; the user is
        // re-asked next time — safer, per the popup copy, never less safe).
        match store.cap.as_ref() {
            Some(cap) => {
                if let Err(e) = config::lock_mutate_save_to(
                    &store.lock,
                    state.core.config_path.as_deref(),
                    cap,
                    |cfg| {
                        if cfg.approved_origins.contains(&origin) {
                            false
                        } else {
                            cfg.approved_origins.push(origin);
                            true
                        }
                    },
                ) {
                    tracing::warn!(error = %e, "Failed to persist approved origin");
                }
            }
            None => tracing::warn!(
                "Config was written by a newer build; not persisting approved origin (read-only)"
            ),
        }
    }
    Ok(())
}

//! `/prove` request handler + version/thread resolution.
//!
//! The core proving path: authorize the origin, buffer the body under a 50MB cap (bounded by the
//! inflight-waiters gate, NOT the prove permit — A1), resolve+download the requested bb version, then
//! acquire the single prove permit and run the proof (bb already uses all cores), returning base64 +
//! an `x-prove-duration-ms` header. Extracted from server.rs (Q2).

use std::future::Future;
use std::sync::Arc;
use std::time::Duration;

use axum::body::{Body, Bytes};
use axum::extract::{Request, State};
use axum::http::HeaderValue;
use axum::response::IntoResponse;
use serde_json::json;
use tokio::sync::{Notify, OwnedSemaphorePermit, Semaphore};

use crate::{bb, versions};

use super::auth::{authorize_origin, Approval};
use super::ultra_honk::{OriginSlot, OriginSlots};
use super::{AppState, ProveError, ServerStatus, StatusCallback};

/// Drop guard that resets tray status to Idle when the prove handler exits for any reason
/// (success, error, client disconnect, panic).
struct StatusGuard {
    cb: Option<StatusCallback>,
}

impl Drop for StatusGuard {
    fn drop(&mut self) {
        if let Some(ref cb) = self.cb {
            cb(ServerStatus::Idle);
        }
    }
}

/// Validate and resolve the requested Aztec version. Downloads the bb binary if needed.
/// Outcome of version resolution: the validated version for `bb::prove` (`None` = bundled default)
/// and whether `prove()` must download it first. **Pure** — no status emission, no download. (F-08:
/// the old `Option<&str>` + `Option<AztecVersion>` double representation is collapsed into ONE
/// validated `AztecVersion` + a `needs_download` flag; `prove` owns the whole
/// Proving→Downloading→Proving status sequence so it lives in one place.)
#[derive(Debug)]
pub(crate) struct ResolvedVersion {
    pub(crate) version: Option<versions::AztecVersion>,
    /// Only meaningful when `version` is `Some` (the bundled default is never downloaded).
    pub(crate) needs_download: bool,
}

pub(crate) fn resolve_version(
    state: &AppState,
    requested: &Option<String>,
) -> Result<ResolvedVersion, ProveError> {
    let Some(requested) = requested else {
        return Ok(ResolvedVersion {
            version: None,
            needs_download: false,
        });
    };
    let version = parse_selectable_version(requested)?;
    tracing::info!(version = %version, "Requested Aztec version");

    let bundled = state
        .bundled_version
        .as_deref()
        .unwrap_or(super::DEFAULT_BB_VERSION);

    // F-007: normalize an explicit bundled request to `None` — the bundled bb ships as the sidecar, never
    // the version cache, so it resolves via `find_bb(None)`. This also makes any `Some(v)` downstream an
    // unambiguously NON-bundled request, so `find_bb` can hard-error on a bad cache entry without a
    // wrong-version fallback (a bundled `Some(v)` would otherwise be indistinguishable).
    if requested == bundled {
        return Ok(ResolvedVersion {
            version: None,
            needs_download: false,
        });
    }

    // Re-download when the cache entry is absent OR present-but-marker-invalid (tampered/legacy), not
    // merely when the path is missing — `verify_cached_bb` rehashes the binary against its marker (F-007).
    let needs_download = versions::verify_cached_bb(&version).is_err();
    if needs_download {
        tracing::info!(version = %version, "Version not cached (or unverified), will download");
    }

    Ok(ResolvedVersion {
        version: Some(version),
        needs_download,
    })
}

fn parse_selectable_version(requested: &str) -> Result<versions::AztecVersion, ProveError> {
    // The validated value is the traversal guard for every downstream path and URL sink.
    let version = versions::AztecVersion::parse(requested)
        .ok_or_else(|| ProveError::InvalidVersion(requested.to_string()))?;
    // Apply revocations before the bundled shortcut: a revoked bundled version must also fail closed.
    if let Err(rejection) = versions::check_version_selectable(&version) {
        tracing::warn!(version = %version, reason = rejection.reason(), "Refused remote Aztec version");
        return Err(ProveError::VersionNotAllowed {
            version: version.to_string(),
            reason: rejection.reason(),
        });
    }
    Ok(version)
}

/// Read the speed setting from config and convert to thread count.
/// Returns None for "full" (let bb use its default).
pub(crate) fn compute_threads(state: &AppState) -> Option<usize> {
    state.config.as_ref().and_then(|cfg| {
        let cfg = cfg.read();
        if cfg.speed.is_full() {
            None
        } else {
            Some(cfg.speed.to_threads())
        }
    })
}

const MAX_BODY_SIZE: usize = 50 * 1024 * 1024; // 50MB

/// F-009: absolute deadline for buffering the request body. Bounds a slowloris/stalled uploader —
/// after A1 the body is read WITHOUT the prove permit, so this deadline caps how long a slow upload
/// occupies an inflight slot (not the prover). 30s is generous for 50MB over loopback (~1.7 MiB/s);
/// it is a whole-body deadline, not an idle timeout, so drip-feeding cannot extend it.
const BODY_READ_TIMEOUT: Duration = Duration::from_secs(30);

/// Reject an honestly-declared oversize body BEFORE acquiring the prove permit, so a client
/// advertising `Content-Length > MAX_BODY_SIZE` is turned away without occupying the single
/// permit. Chunked/underreported requests are still bounded by `to_bytes` — this is a cheap
/// fast-path, never the sole limit.
fn reject_declared_oversize(headers: &axum::http::HeaderMap) -> Result<(), ProveError> {
    // Inspect EVERY Content-Length value, and each comma-separated element within it (HTTP/2 and
    // some proxies emit a duplicate-but-consistent list). Parse as u64 so a value that would
    // overflow usize on 32-bit targets can't wrap below the cap; reject if any element exceeds the
    // cap or is malformed. Cheap pre-permit fast-path — the to_bytes limit remains authoritative.
    let mut seen: Option<u64> = None;
    for value in headers.get_all(axum::http::header::CONTENT_LENGTH) {
        let Ok(s) = value.to_str() else {
            return Err(ProveError::PayloadTooLarge(
                "non-ASCII Content-Length".to_string(),
            ));
        };
        for part in s.split(',') {
            let part = part.trim();
            // RFC 7230 §3.3.2: a Content-Length is `1*DIGIT`. Reject empty/partial/non-digit
            // elements (a permissive skip let `""`, `","`, `1,`, `,1` slip past); parse as u64 so
            // an over-long value can't wrap below the cap.
            if part.is_empty() || !part.bytes().all(|b| b.is_ascii_digit()) {
                return Err(ProveError::PayloadTooLarge(format!(
                    "malformed Content-Length {part:?}"
                )));
            }
            let len: u64 = part.parse().map_err(|_| {
                ProveError::PayloadTooLarge(format!("unparsable Content-Length {part:?}"))
            })?;
            if len > MAX_BODY_SIZE as u64 {
                return Err(ProveError::PayloadTooLarge(format!(
                    "declared Content-Length {len} exceeds {MAX_BODY_SIZE}"
                )));
            }
            // RFC 7230 §3.3.2: multiple Content-Length values must all agree.
            match seen {
                Some(prev) if prev != len => {
                    return Err(ProveError::PayloadTooLarge(format!(
                        "conflicting Content-Length values {prev} and {len}"
                    )));
                }
                _ => seen = Some(len),
            }
        }
    }
    Ok(())
}

/// Buffer the request body under the size cap and an absolute read timeout WITHOUT holding the prove
/// permit: a slow (slowloris) upload may occupy an inflight slot, never the CPU-bound prover. Residency
/// stays bounded by `MAX_INFLIGHT_PROVE × MAX_BODY_SIZE` through the inflight cap the caller holds.
async fn read_body(
    raw_body: Body,
    max_body_size: usize,
    read_timeout: Duration,
) -> Result<Bytes, ProveError> {
    tokio::time::timeout(read_timeout, axum::body::to_bytes(raw_body, max_body_size))
        .await
        .map_err(|_| {
            tracing::warn!(
                timeout_secs = read_timeout.as_secs(),
                "Timed out reading /prove request body"
            );
            ProveError::BodyReadTimeout
        })?
        .map_err(|e| {
            tracing::warn!("Failed to read request body: {e}");
            ProveError::PayloadTooLarge(e.to_string())
        })
}

#[cfg(test)]
mod on_task_tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};

    /// Records, at its own drop, whether the work it was handed to had finished.
    struct Probe {
        finished: Arc<AtomicBool>,
        finished_at_drop: Arc<AtomicBool>,
        dropped: Arc<AtomicBool>,
    }

    impl Drop for Probe {
        fn drop(&mut self) {
            self.finished_at_drop
                .store(self.finished.load(Ordering::SeqCst), Ordering::SeqCst);
            self.dropped.store(true, Ordering::SeqCst);
        }
    }

    #[tokio::test]
    async fn dropping_the_request_keeps_held_until_the_cancelled_work_returns() {
        let finished = Arc::new(AtomicBool::new(false));
        let finished_at_drop = Arc::new(AtomicBool::new(false));
        let dropped = Arc::new(AtomicBool::new(false));
        let probe = Probe {
            finished: finished.clone(),
            finished_at_drop: finished_at_drop.clone(),
            dropped: dropped.clone(),
        };
        let done = finished.clone();
        // The work is a stand-in for bb: it blocks until cancelled, then "reaps" and returns.
        let request = on_task(probe, |probe, cancel| async move {
            cancel.notified().await;
            tokio::time::sleep(Duration::from_millis(50)).await;
            done.store(true, Ordering::SeqCst);
            (probe, ())
        });
        // The client goes away: the request future is dropped mid-flight.
        assert!(tokio::time::timeout(Duration::from_millis(20), request)
            .await
            .is_err());
        for _ in 0..100 {
            if dropped.load(Ordering::SeqCst) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert!(
            dropped.load(Ordering::SeqCst),
            "held must still be released"
        );
        assert!(
            finished_at_drop.load(Ordering::SeqCst),
            "held must be released only after the work observed the cancel and returned"
        );
    }

    #[tokio::test]
    async fn completed_work_hands_held_back() {
        let (held, out) = on_task(7u8, |held, _cancel| async move { (held, held + 1) })
            .await
            .unwrap();
        assert_eq!((held, out), (7, 8));
    }
}

/// F-009: try to enter the bounded set of in-flight + waiting authorized `/prove` requests.
/// Non-blocking: if the cap (`MAX_INFLIGHT_PROVE` permits) is full, shed immediately with 429
/// (`ProveQueueFull`) rather than queueing. The returned guard must be held for the whole request
/// so it is released (RAII) on every exit path. Testable seam.
fn try_enter(waiters: Arc<Semaphore>) -> Result<OwnedSemaphorePermit, ProveError> {
    waiters
        .try_acquire_owned()
        .map_err(|_| ProveError::ProveQueueFull)
}

pub(crate) async fn prove(
    State(state): State<AppState>,
    request: Request,
) -> Result<impl IntoResponse, ProveError> {
    tracing::info!("Received /prove request");
    let admitted = admit(&state, request, None).await?;
    let prover = acquire_prover(&state, &admitted.requested_version).await?;
    let held = Held { admitted, prover };

    let start = std::time::Instant::now();
    let (_held, result) = on_task(held, |held, cancel| async move {
        let result = bb::prove_cancellable(
            &held.admitted.body,
            held.prover.version.as_ref(),
            held.prover.threads,
            cancel,
        )
        .await;
        (held, result)
    })
    .await?;
    let elapsed = start.elapsed();
    log_prove_outcome(result.as_ref().map(Vec::len), elapsed);

    let proof = result.map_err(|e| ProveError::ProveFailed(e.to_string()))?;
    let encoded = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &proof);
    let mut response = axum::Json(json!({ "proof": encoded })).into_response();
    set_duration_header(&mut response, elapsed);
    Ok(response)
}

/// Everything a request holds while bb runs, moved INTO the task that runs it (see [`on_task`]): a
/// request the client abandons must keep its seats until the killed bb is reaped, not drop them
/// the instant the handler future is dropped.
pub(super) struct Held {
    pub(super) admitted: Admitted,
    pub(super) prover: Prover,
}

/// Notifies the run's cancel signal when the awaiting future is dropped.
struct CancelOnDrop(bb::Cancel);

impl Drop for CancelOnDrop {
    fn drop(&mut self) {
        self.0.notify_one();
    }
}

/// Run `work` on its own task, which owns `held` until `work` returns. Dropping this future (client
/// disconnect) does not stop the task; it fires `cancel`, on which bb kills its tree and waits for the
/// reap before returning — so `held` is released only after bb is gone. Testable seam.
pub(super) async fn on_task<H, T, F>(
    held: H,
    work: impl FnOnce(H, bb::Cancel) -> F,
) -> Result<(H, T), ProveError>
where
    H: Send + 'static,
    T: Send + 'static,
    F: Future<Output = (H, T)> + Send + 'static,
{
    let cancel: bb::Cancel = Arc::new(Notify::new());
    let _cancel_on_drop = CancelOnDrop(cancel.clone());
    tokio::spawn(work(held, cancel))
        .await
        .map_err(|_| ProveError::ProveFailed("prove task failed".into()))
}

/// What a scheme handler holds after the shared admission gate. Field order is the drop order:
/// the tray returns to Idle before the inflight slot is released, exactly as the inlined handler did;
/// the per-origin slot goes last.
pub(super) struct Admitted {
    pub(super) body: Bytes,
    pub(super) requested_version: Option<String>,
    pub(super) approval: Approval,
    _status: StatusGuard,
    _inflight: OwnedSemaphorePermit,
    _origin_slot: Option<OriginSlot>,
}

/// Stage 1 of every prove: authorize → (per-origin slot, when the scheme caps one) → inflight slot →
/// declared-size reject → capped, timed body read → version header → `Proving`. Nothing here depends
/// on the body's meaning (chonk hands it to bb verbatim; ultra_honk validates it next) and nothing
/// here touches the download, lease, or permit.
pub(super) async fn admit(
    state: &AppState,
    request: Request,
    origin_slots: Option<&OriginSlots>,
) -> Result<Admitted, ProveError> {
    // Extract headers before consuming the request body. Run authorization FIRST
    // so unapproved origins are rejected without buffering the (potentially large) body.
    let (parts, raw_body) = request.into_parts();
    let approval = authorize_origin(state, &parts.headers).await?;

    // Taken before the body is buffered so one origin cannot fill the inflight cap for other sites.
    let origin_slot = match (origin_slots, approval.origin.as_ref()) {
        (Some(slots), Some(origin)) => Some(slots.try_enter(origin)?),
        _ => None,
    };

    // F-009: cap total in-flight + waiting authorized /prove requests. Held (RAII) for the whole
    // request; a burst beyond MAX_INFLIGHT_PROVE is shed immediately with 429 instead of queueing
    // behind slow uploaders and stacking fresh per-request read timeouts.
    let inflight = try_enter(state.prove_waiters.clone())?;

    // F-009: turn away an honestly-declared oversize body before taking the prove permit.
    reject_declared_oversize(&parts.headers)?;

    // A1: buffer the body under ONLY the inflight cap (memory bounded to MAX_INFLIGHT_PROVE × 50MB),
    // NOT the single prove permit — so a slow uploader occupies just an inflight slot for ≤30s and can't
    // block the prover. The prove permit is acquired later, only around the CPU-bound proof itself.
    let body = read_body(raw_body, MAX_BODY_SIZE, BODY_READ_TIMEOUT).await?;
    tracing::debug!(payload_bytes = body.len(), "Prove request payload size");

    let requested_version = requested_version(&parts.headers);

    if let Some(ref cb) = state.on_status {
        cb(ServerStatus::Proving);
    }
    let status = StatusGuard {
        cb: state.on_status.clone(),
    };
    Ok(Admitted {
        body,
        requested_version,
        approval,
        _status: status,
        _inflight: inflight,
        _origin_slot: origin_slot,
    })
}

/// What is held while bb runs. Field order is the drop order: the prove permit is released before
/// the version lease, exactly as the inlined handler did.
pub(super) struct Prover {
    pub(super) version: Option<versions::AztecVersion>,
    pub(super) threads: Option<usize>,
    _permit: OwnedSemaphorePermit,
    _version_lease: Option<versions::Lease>,
}

/// Stage 2 of every prove: resolve → download (owning the Downloading→Proving status transition) →
/// thread cap → version lease → the single prove permit.
pub(super) async fn acquire_prover(
    state: &AppState,
    requested_version: &Option<String>,
) -> Result<Prover, ProveError> {
    // Version resolution itself remains side-effect free; download_if_needed owns the temporary
    // Downloading→Proving transition.
    let resolved = resolve_version(state, requested_version)?;
    download_if_needed(state, &resolved).await?;
    let threads = compute_threads(state);

    // Lease the version BEFORE waiting for the prove permit: this request may sit in the permit queue
    // for the length of another proof, and a cleanup pass in that window would evict the binary out
    // from under it. `bb::prove` leases too, but only once it runs. Held (RAII) for the rest of the
    // handler.
    //
    // `None` means a cleanup is deleting this version right now; report unavailable rather than race
    // it. The next request re-downloads.
    let version_lease = acquire_version_lease(resolved.version.as_ref())?;

    // A1: acquire the single prove permit ONLY now — around the CPU-bound proof — not across the body
    // read + version download above (which ran concurrently under the inflight cap). bb saturates all
    // cores, so proofs still run strictly one at a time; only the serialized *proving* is gated, not I/O.
    // Held (RAII) until the handler returns.
    let permit = state
        .prove_semaphore
        .clone()
        .acquire_owned()
        .await
        .map_err(|_| ProveError::ServiceUnavailable)?;
    Ok(Prover {
        version: resolved.version,
        threads,
        _permit: permit,
        _version_lease: version_lease,
    })
}

fn log_prove_outcome<E: std::fmt::Display>(result: Result<usize, &E>, elapsed: Duration) {
    match result {
        Ok(proof_bytes) => log_prove_success(proof_bytes, elapsed),
        Err(e) => log_prove_failure(e, elapsed),
    }
}

fn log_prove_success(proof_bytes: usize, elapsed: Duration) {
    tracing::info!("Proving succeeded");
    tracing::debug!(
        elapsed_ms = elapsed.as_millis() as u64,
        proof_bytes,
        "Proving timing and size"
    );
}

fn log_prove_failure(error: &impl std::fmt::Display, elapsed: Duration) {
    tracing::error!("Proving failed: {error}");
    tracing::debug!(
        elapsed_ms = elapsed.as_millis() as u64,
        "Failed prove timing"
    );
}

/// `x-prove-duration-ms` is bb's wall time only — never queue, download, or authorization time.
pub(super) fn set_duration_header(response: &mut axum::response::Response, elapsed: Duration) {
    response.headers_mut().insert(
        "x-prove-duration-ms",
        HeaderValue::from_str(&elapsed.as_millis().to_string()).unwrap(),
    );
}

fn requested_version(headers: &axum::http::HeaderMap) -> Option<String> {
    headers
        .get("x-aztec-version")
        .and_then(|value| value.to_str().ok())
        .map(str::to_string)
}

async fn download_if_needed(
    state: &AppState,
    resolved: &ResolvedVersion,
) -> Result<(), ProveError> {
    let Some(version) = resolved
        .version
        .as_ref()
        .filter(|_| resolved.needs_download)
    else {
        return Ok(());
    };
    if let Some(callback) = state.on_status.as_ref() {
        callback(ServerStatus::Downloading);
    }
    versions::download_bb(version).await.map_err(|error| {
        tracing::error!(version = %version, error = %error, "Failed to download bb");
        ProveError::DownloadFailed {
            version: version.to_string(),
            detail: error.to_string(),
        }
    })?;
    tracing::info!(version = %version, "Download complete");
    spawn_cache_cleanup(state, version);
    // The established observable sequence is Proving → Downloading → Proving → Idle.
    if let Some(callback) = state.on_status.as_ref() {
        callback(ServerStatus::Proving);
    }
    Ok(())
}

fn spawn_cache_cleanup(state: &AppState, version: &versions::AztecVersion) {
    let bundled = state
        .bundled_version
        .as_deref()
        .unwrap_or(super::DEFAULT_BB_VERSION)
        .to_string();
    let in_use = version.as_str().to_string();
    let on_versions_changed = state.on_versions_changed.clone();
    tokio::spawn(async move {
        if let Some(bundled) = versions::AztecVersion::parse(&bundled) {
            let in_use = versions::AztecVersion::parse(&in_use);
            versions::cleanup_old_versions(&bundled, in_use.as_ref()).await;
        }
        if let Some(callback) = on_versions_changed {
            callback();
        }
    });
}

fn acquire_version_lease(
    version: Option<&versions::AztecVersion>,
) -> Result<Option<versions::Lease>, ProveError> {
    let Some(version) = version else {
        return Ok(None);
    };
    versions::acquire_lease(version.as_str())
        .map(Some)
        .ok_or_else(|| {
            tracing::warn!(version = %version, "Version is being evicted; refusing rather than racing deletion");
            ProveError::VersionEvicting
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::{header::CONTENT_LENGTH, HeaderMap};

    fn content_length(v: &str) -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert(CONTENT_LENGTH, HeaderValue::from_str(v).unwrap());
        h
    }

    #[test]
    fn declared_oversize_rejected_before_permit() {
        // F-009: an honestly-declared oversize Content-Length is turned away up front.
        assert!(matches!(
            reject_declared_oversize(&content_length(&(MAX_BODY_SIZE + 1).to_string())),
            Err(ProveError::PayloadTooLarge(_))
        ));
        // At/under the cap and absent are allowed (still bounded later by to_bytes).
        assert!(reject_declared_oversize(&content_length(&MAX_BODY_SIZE.to_string())).is_ok());
        assert!(reject_declared_oversize(&HeaderMap::new()).is_ok());
        // Comma-list (HTTP/2 duplicate) with an oversize element must NOT slip past.
        assert!(matches!(
            reject_declared_oversize(&content_length(&format!("{0}, {0}", MAX_BODY_SIZE + 1))),
            Err(ProveError::PayloadTooLarge(_))
        ));
        // Malformed / empty / partial values are rejected, not silently ignored.
        for bad in ["not-a-number", "", ",", "1,", ",1", "1 2"] {
            assert!(
                matches!(
                    reject_declared_oversize(&content_length(bad)),
                    Err(ProveError::PayloadTooLarge(_))
                ),
                "must reject malformed Content-Length {bad:?}"
            );
        }
        // Conflicting comma-list values (RFC 7230 §3.3.2) are rejected even when each is under cap.
        assert!(matches!(
            reject_declared_oversize(&content_length("10, 20")),
            Err(ProveError::PayloadTooLarge(_))
        ));
        // Agreeing duplicates under the cap are fine.
        assert!(reject_declared_oversize(&content_length("10, 10")).is_ok());
    }

    #[test]
    fn waiter_cap_sheds_excess_with_queue_full() {
        // F-009: fill the cap; the next entry is shed with ProveQueueFull; a slot frees on drop.
        let waiters = Arc::new(Semaphore::new(2));
        let g1 = try_enter(waiters.clone()).expect("slot 1");
        let _g2 = try_enter(waiters.clone()).expect("slot 2");
        assert!(matches!(
            try_enter(waiters.clone()),
            Err(ProveError::ProveQueueFull)
        ));
        drop(g1);
        assert!(try_enter(waiters.clone()).is_ok(), "slot freed on drop");
    }

    #[tokio::test]
    async fn body_read_does_not_hold_the_prove_permit() {
        // A1: reading the body must NOT depend on or hold the single prove permit — a slow uploader
        // therefore can't block the prover. With zero prove permits available, a READY body still reads.
        let sem = Arc::new(Semaphore::new(0)); // no prove permits at all
        let body = read_body(
            Body::from(Bytes::from_static(b"ready")),
            1024,
            Duration::from_secs(30),
        )
        .await
        .expect("body reads without any prove permit");
        assert_eq!(&body[..], &b"ready"[..]);
        assert_eq!(
            sem.available_permits(),
            0,
            "read_body never touches the prove semaphore"
        );
    }

    // (A1: the "permit only around proving" placement in prove() is exercised end-to-end by the
    // prove-handler integration tests, not a unit test — a standalone semaphore-RAII assertion would only
    // test tokio, not this code, so it was removed per the re-audit.)

    #[tokio::test]
    async fn oversized_body_errs() {
        let res = read_body(
            Body::from(vec![0u8; 10]),
            4, // tiny cap to force the length error deterministically
            Duration::from_secs(30),
        )
        .await;
        assert!(matches!(res, Err(ProveError::PayloadTooLarge(_))));
    }

    #[tokio::test(start_paused = true)]
    async fn stalled_body_times_out() {
        // A body whose stream never yields → to_bytes never completes → the read timeout fires.
        // Under start_paused the virtual clock auto-advances to the only pending timer.
        let body =
            Body::from_stream(futures_util::stream::pending::<Result<Bytes, std::io::Error>>());
        let res = read_body(body, 1024, Duration::from_secs(30)).await;
        assert!(matches!(res, Err(ProveError::BodyReadTimeout)));
    }
}

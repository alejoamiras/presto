//! `POST /prove/ultra-honk`: one Noir circuit + witness (+ optional verification key) → raw proof.
//!
//! Rides every `/prove` guard through the shared `admit`/`acquire_prover` stages and adds what the
//! chonk path does not need: a JSON body whose fields are validated before bb sees them, a per-origin
//! admission cap, a re-check that the origin was not removed in Settings while the job queued, and a
//! blocking worker that owns every guard while it decodes and inflates the inputs — so a client that
//! disconnects mid-validation cannot release the permit under a still-running decode.

use std::collections::HashMap;
use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::extract::{Request, State};
use axum::response::IntoResponse;
use base64::engine::{DecodePaddingMode, GeneralPurpose, GeneralPurposeConfig};
use base64::Engine;
use serde::de::{self, IgnoredAny, MapAccess, Visitor};
use serde_json::json;

use crate::authorization::CanonicalOrigin;
use crate::bb::{self, UltraHonkJob, VerifierTarget};

use super::auth::Approval;
use super::prove::{acquire_prover, admit, set_duration_header, Admitted, Prover};
use super::{AppState, ProveError, MAX_INFLIGHT_PROVE};

/// Half the global inflight cap: a multi-tab dApp still queues on the prove permit like chonk, while
/// one Noir origin can never shed every other site to WASM by filling the cap. Admission fairness only.
pub(crate) const MAX_ULTRA_HONK_PER_ORIGIN: usize = MAX_INFLIGHT_PROVE / 2;

/// Decoded-size caps per field. Resource policy, not a measured circuit ceiling; the real boundary
/// stays bb's contained process.
const MAX_BYTECODE_BYTES: usize = 16 * 1024 * 1024;
const MAX_WITNESS_BYTES: usize = 32 * 1024 * 1024;
const MAX_VK_BYTES: usize = 64 * 1024;
/// Cap on what a gzipped field may inflate to (a bomb guard; witnesses of 2^20-gate circuits fit).
const MAX_INFLATED_BYTES: u64 = 256 * 1024 * 1024;
const INFLATE_CHUNK: usize = 64 * 1024;

/// Standard alphabet, padding-indifferent — bb.js decodes leniently and Noir artifacts are not
/// guaranteed to carry canonical padding.
const BASE64: GeneralPurpose = GeneralPurpose::new(
    &base64::alphabet::STANDARD,
    GeneralPurposeConfig::new().with_decode_padding_mode(DecodePaddingMode::Indifferent),
);

/// Live UltraHonk admissions per origin, keyed by canonical origin string.
#[derive(Clone, Default)]
pub(crate) struct OriginSlots(Arc<Mutex<HashMap<String, usize>>>);

impl OriginSlots {
    /// Take one of this origin's slots, or 429 when it holds `MAX_ULTRA_HONK_PER_ORIGIN` already.
    pub(crate) fn try_enter(&self, origin: &CanonicalOrigin) -> Result<OriginSlot, ProveError> {
        let key = origin.to_string();
        let mut slots = self.0.lock().unwrap();
        let count = slots.entry(key.clone()).or_insert(0);
        if *count >= MAX_ULTRA_HONK_PER_ORIGIN {
            tracing::warn!(origin = %key, "Origin has too many UltraHonk proofs in flight");
            return Err(ProveError::OriginQueueFull);
        }
        *count += 1;
        Ok(OriginSlot {
            slots: self.clone(),
            key,
        })
    }

    #[cfg(test)]
    pub(crate) fn in_flight(&self, origin: &CanonicalOrigin) -> usize {
        self.0
            .lock()
            .unwrap()
            .get(origin.as_str())
            .copied()
            .unwrap_or(0)
    }
}

/// RAII release of one per-origin admission.
pub(crate) struct OriginSlot {
    slots: OriginSlots,
    key: String,
}

impl Drop for OriginSlot {
    fn drop(&mut self) {
        let mut slots = self.slots.0.lock().unwrap();
        if let Some(count) = slots.get_mut(&self.key) {
            *count -= 1;
            if *count == 0 {
                slots.remove(&self.key);
            }
        }
    }
}

/// The wire body, still base64. Unknown keys are ignored (the contract evolves additively, like
/// `/health`); a repeated key is rejected so no field can be smuggled past a validator that saw the
/// first occurrence.
struct RawRequest {
    bytecode: String,
    witness: String,
    vk: Option<String>,
    verifier_target: String,
}

impl<'de> serde::Deserialize<'de> for RawRequest {
    fn deserialize<D: de::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_map(RawRequestVisitor)
    }
}

struct RawRequestVisitor;

impl<'de> Visitor<'de> for RawRequestVisitor {
    type Value = RawRequest;

    fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("an object with bytecode, witness, verifier_target, and optional vk")
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<RawRequest, A::Error> {
        let mut bytecode = None;
        let mut witness = None;
        let mut vk = None;
        let mut verifier_target = None;
        while let Some(key) = map.next_key::<String>()? {
            let slot = match key.as_str() {
                "bytecode" => &mut bytecode,
                "witness" => &mut witness,
                "vk" => &mut vk,
                "verifier_target" => &mut verifier_target,
                _ => {
                    map.next_value::<IgnoredAny>()?;
                    continue;
                }
            };
            if slot.is_some() {
                return Err(de::Error::custom(format!("duplicate field {key}")));
            }
            *slot = Some(map.next_value::<String>()?);
        }
        Ok(RawRequest {
            bytecode: bytecode.ok_or_else(|| de::Error::missing_field("bytecode"))?,
            witness: witness.ok_or_else(|| de::Error::missing_field("witness"))?,
            vk,
            verifier_target: verifier_target
                .ok_or_else(|| de::Error::missing_field("verifier_target"))?,
        })
    }
}

/// A request that passed the cheap, runtime-thread checks: shape, target, and encoded-length caps.
pub(crate) struct ParsedRequest {
    raw: RawRequest,
    target: VerifierTarget,
}

/// Longest base64 text whose decoded form can fit in `decoded_cap` bytes.
fn encoded_cap(decoded_cap: usize) -> usize {
    decoded_cap.div_ceil(3) * 4
}

/// Runs on the runtime thread before any download, lease, or permit: no decoding, no allocation
/// beyond the JSON parse of an already-capped body.
pub(crate) fn parse_request(body: &[u8]) -> Result<ParsedRequest, ProveError> {
    let raw: RawRequest = serde_json::from_slice(body)
        .map_err(|e| ProveError::InvalidRequest(format!("body is not the expected JSON ({e})")))?;
    let target: VerifierTarget = raw
        .verifier_target
        .parse()
        .map_err(|e: bb::UnknownVerifierTarget| ProveError::InvalidVerifierTarget(e.0))?;
    for (name, value, cap) in [
        ("bytecode", raw.bytecode.as_str(), MAX_BYTECODE_BYTES),
        ("witness", raw.witness.as_str(), MAX_WITNESS_BYTES),
        ("vk", raw.vk.as_deref().unwrap_or(""), MAX_VK_BYTES),
    ] {
        if value.len() > encoded_cap(cap) {
            return Err(ProveError::InvalidRequest(format!(
                "{name} exceeds {} bytes",
                cap
            )));
        }
    }
    Ok(ParsedRequest { raw, target })
}

struct DecodedJob {
    bytecode: Vec<u8>,
    witness: Vec<u8>,
    vk: Option<Vec<u8>>,
}

fn decode_field(name: &str, value: &str, cap: usize) -> Result<Vec<u8>, ProveError> {
    let bytes = BASE64
        .decode(value)
        .map_err(|_| ProveError::InvalidRequest(format!("{name} is not base64")))?;
    if bytes.len() > cap {
        return Err(ProveError::InvalidRequest(format!(
            "{name} exceeds {cap} bytes"
        )));
    }
    Ok(bytes)
}

fn require_gzip(name: &str, bytes: &[u8]) -> Result<(), ProveError> {
    if bytes.len() < 2 || bytes[0] != 0x1f || bytes[1] != 0x8b {
        return Err(ProveError::InvalidRequest(format!("{name} is not gzip")));
    }
    Ok(())
}

/// Inflate `bytes` into a counting sink so a gzip bomb is caught here, bounded, rather than inside bb.
/// The trailer's ISIZE is attacker-writable, so the stream is actually walked, and every concatenated
/// member is counted because bb accepts multi-member input. `cancel` is polled per chunk: a
/// disconnected client's job stops within one chunk instead of inflating to the cap.
fn inflate_dry_run(
    name: &str,
    bytes: &[u8],
    cap: u64,
    cancel: &AtomicBool,
) -> Result<(), ProveError> {
    let mut decoder = flate2::read::MultiGzDecoder::new(bytes);
    let mut sink = [0u8; INFLATE_CHUNK];
    let mut total: u64 = 0;
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err(ProveError::ProveFailed("request cancelled".into()));
        }
        let n = decoder
            .read(&mut sink)
            .map_err(|_| ProveError::InvalidRequest(format!("{name} is corrupt gzip")))?;
        if n == 0 {
            return Ok(());
        }
        total += n as u64;
        if total > cap {
            return Err(ProveError::InvalidRequest(format!(
                "{name} inflates past {cap} bytes"
            )));
        }
    }
}

/// The heavy validation, run on a blocking worker under the prove permit.
fn decode_and_check(raw: &RawRequest, cancel: &AtomicBool) -> Result<DecodedJob, ProveError> {
    let bytecode = decode_field("bytecode", raw.bytecode.as_str(), MAX_BYTECODE_BYTES)?;
    require_gzip("bytecode", &bytecode)?;
    inflate_dry_run("bytecode", &bytecode, MAX_INFLATED_BYTES, cancel)?;
    let witness = decode_field("witness", raw.witness.as_str(), MAX_WITNESS_BYTES)?;
    require_gzip("witness", &witness)?;
    inflate_dry_run("witness", &witness, MAX_INFLATED_BYTES, cancel)?;
    let vk = raw
        .vk
        .as_deref()
        .map(|vk| decode_field("vk", vk, MAX_VK_BYTES))
        .transpose()?;
    Ok(DecodedJob {
        bytecode,
        witness,
        vk,
    })
}

/// Sets the worker's cancellation flag when the handler future is dropped (client disconnect).
struct CancelOnDrop(Arc<AtomicBool>);

impl Drop for CancelOnDrop {
    fn drop(&mut self) {
        self.0.store(true, Ordering::Relaxed);
    }
}

/// Everything the request holds while the worker runs. Moved INTO the blocking closure and handed
/// back on completion: tokio cannot cancel a blocking task, so if the request future is dropped these
/// guards must die with the worker, not before it.
struct Held {
    admitted: Admitted,
    prover: Prover,
}

/// Generic over what is held so the ownership rule can be tested without a whole server state.
async fn decode_on_worker<H: Send + 'static>(
    held: H,
    raw: RawRequest,
) -> Result<(H, DecodedJob), ProveError> {
    let cancel = Arc::new(AtomicBool::new(false));
    let _cancel_on_drop = CancelOnDrop(cancel.clone());
    let worker = tokio::task::spawn_blocking(move || {
        let decoded = decode_and_check(&raw, &cancel);
        (held, decoded)
    });
    let (held, decoded) = worker
        .await
        .map_err(|_| ProveError::ProveFailed("validation worker failed".into()))?;
    Ok((held, decoded?))
}

/// A Settings removal that happened after this request's grant means the user withdrew consent
/// while the job was queued; chonk keeps its authorize-once behaviour, this path re-checks.
fn ensure_not_revoked(state: &AppState, approval: &Approval) -> Result<(), ProveError> {
    if let (Some(manager), Some(origin)) = (state.auth_manager.as_ref(), approval.origin.as_ref()) {
        if manager.revoked_since(origin, approval.granted_at) {
            tracing::info!(origin = %origin, "Origin removed in Settings while the job was queued; denying");
            return Err(ProveError::OriginDenied(origin.to_string()));
        }
    }
    Ok(())
}

pub(crate) async fn prove_ultra_honk(
    State(state): State<AppState>,
    request: Request,
) -> Result<impl IntoResponse, ProveError> {
    tracing::info!("Received /prove/ultra-honk request");
    let mut admitted = admit(&state, request, Some(&state.ultra_honk_slots)).await?;
    // The parsed strings replace the raw body; free the buffered copy before waiting for the permit.
    let body = std::mem::take(&mut admitted.body);
    let parsed = parse_request(&body)?;
    drop(body);

    let prover = acquire_prover(&state, &admitted.requested_version).await?;
    ensure_not_revoked(&state, &admitted.approval)?;
    let held = Held { admitted, prover };
    let (held, decoded) = decode_on_worker(held, parsed.raw).await?;
    ensure_not_revoked(&state, &held.admitted.approval)?;

    let job = UltraHonkJob {
        bytecode: decoded.bytecode,
        witness: decoded.witness,
        vk: decoded.vk,
        target: parsed.target,
    };
    let start = Instant::now();
    let result = bb::prove_ultra_honk(job, held.prover.version.as_ref(), held.prover.threads).await;
    let elapsed = start.elapsed();
    log_outcome(
        &held.admitted.approval,
        parsed.target,
        result.is_ok(),
        elapsed,
    );

    let out = result.map_err(|e| ProveError::ProveFailed(e.to_string()))?;
    let mut response = axum::Json(render(&out)).into_response();
    set_duration_header(&mut response, elapsed);
    Ok(response)
}

/// Per-job accounting at info level: the metering follow-up reads these lines.
fn log_outcome(approval: &Approval, target: VerifierTarget, ok: bool, elapsed: Duration) {
    let origin = approval
        .origin
        .as_ref()
        .map_or("(no origin)", CanonicalOrigin::as_str);
    tracing::info!(
        scheme = "ultra_honk",
        origin,
        target = %target,
        ok,
        elapsed_ms = elapsed.as_millis() as u64,
        "UltraHonk prove finished"
    );
}

fn render(out: &bb::UltraHonkOutput) -> serde_json::Value {
    let mut body = json!({
        "proof": BASE64.encode(&out.proof),
        "public_inputs": BASE64.encode(&out.public_inputs),
    });
    if let Some(vk) = &out.vk {
        body["vk"] = json!(BASE64.encode(vk));
    }
    body
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gz(payload: &[u8]) -> Vec<u8> {
        use std::io::Write;
        let mut enc = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        enc.write_all(payload).unwrap();
        enc.finish().unwrap()
    }

    fn body(bytecode: &[u8], witness: &[u8], vk: Option<&[u8]>, target: &str) -> Vec<u8> {
        let mut v = json!({
            "bytecode": BASE64.encode(bytecode),
            "witness": BASE64.encode(witness),
            "verifier_target": target,
        });
        if let Some(vk) = vk {
            v["vk"] = json!(BASE64.encode(vk));
        }
        serde_json::to_vec(&v).unwrap()
    }

    #[test]
    fn parse_accepts_the_contract_and_names_every_rejection() {
        let ok = parse_request(&body(b"a", b"b", Some(b"k"), "evm-no-zk")).unwrap();
        assert_eq!(ok.target, VerifierTarget::EvmNoZk);
        assert!(ok.raw.vk.is_some());

        let extra = br#"{"bytecode":"YQ==","witness":"Yg==","verifier_target":"evm","future":1}"#;
        assert!(parse_request(extra).is_ok(), "unknown keys are tolerated");

        let dup =
            br#"{"bytecode":"YQ==","bytecode":"YQ==","witness":"Yg==","verifier_target":"evm"}"#;
        assert!(
            matches!(parse_request(dup), Err(ProveError::InvalidRequest(m)) if m.contains("duplicate"))
        );

        assert!(matches!(
            parse_request(br#"{"witness":"Yg==","verifier_target":"evm"}"#),
            Err(ProveError::InvalidRequest(m)) if m.contains("bytecode")
        ));
        assert!(matches!(
            parse_request(b"not json"),
            Err(ProveError::InvalidRequest(_))
        ));
        assert!(matches!(
            parse_request(&body(b"a", b"b", None, "evm_no_zk")),
            Err(ProveError::InvalidVerifierTarget(t)) if t == "evm_no_zk"
        ));
        let huge = "A".repeat(encoded_cap(MAX_VK_BYTES) + 4);
        let oversize = format!(
            r#"{{"bytecode":"YQ==","witness":"Yg==","vk":"{huge}","verifier_target":"evm"}}"#
        );
        assert!(matches!(
            parse_request(oversize.as_bytes()),
            Err(ProveError::InvalidRequest(m)) if m.starts_with("vk exceeds")
        ));
    }

    #[test]
    fn decode_requires_gzip_fields_and_bounds_inflation() {
        let cancel = AtomicBool::new(false);
        let good = RawRequest {
            bytecode: BASE64.encode(gz(b"acir")),
            witness: BASE64.encode(gz(b"witness")),
            vk: Some(BASE64.encode(b"key")),
            verifier_target: "evm".into(),
        };
        let decoded = decode_and_check(&good, &cancel).unwrap();
        assert_eq!(decoded.vk.as_deref(), Some(b"key".as_slice()));

        let unpadded = RawRequest {
            bytecode: BASE64.encode(gz(b"acir")).trim_end_matches('=').to_string(),
            ..good_clone(&good)
        };
        assert!(
            decode_and_check(&unpadded, &cancel).is_ok(),
            "padding is indifferent"
        );

        let not_gzip = RawRequest {
            witness: BASE64.encode(b"plain"),
            ..good_clone(&good)
        };
        assert!(matches!(
            decode_and_check(&not_gzip, &cancel),
            Err(ProveError::InvalidRequest(m)) if m == "witness is not gzip"
        ));

        let mut truncated = gz(b"acir bytes that get cut");
        truncated.truncate(truncated.len() - 6);
        let corrupt = RawRequest {
            bytecode: BASE64.encode(&truncated),
            ..good_clone(&good)
        };
        assert!(matches!(
            decode_and_check(&corrupt, &cancel),
            Err(ProveError::InvalidRequest(m)) if m == "bytecode is corrupt gzip"
        ));

        let not_b64 = RawRequest {
            vk: Some("@@@".into()),
            ..good_clone(&good)
        };
        assert!(matches!(
            decode_and_check(&not_b64, &cancel),
            Err(ProveError::InvalidRequest(m)) if m == "vk is not base64"
        ));
    }

    fn good_clone(r: &RawRequest) -> RawRequest {
        RawRequest {
            bytecode: r.bytecode.clone(),
            witness: r.witness.clone(),
            vk: r.vk.clone(),
            verifier_target: r.verifier_target.clone(),
        }
    }

    #[test]
    fn inflate_dry_run_stops_at_the_cap_counts_every_member_and_honours_cancel() {
        // 4 MiB of zeros compresses to a few KiB; a cap below it must trip without allocating it.
        let four_mib = 4 * 1024 * 1024;
        let bomb = gz(&vec![0u8; four_mib as usize]);
        let live = AtomicBool::new(false);
        assert!(inflate_dry_run("witness", &bomb, four_mib, &live).is_ok());
        assert!(matches!(
            inflate_dry_run("witness", &bomb, four_mib - 1, &live),
            Err(ProveError::InvalidRequest(m)) if m == format!("witness inflates past {} bytes", four_mib - 1)
        ));
        // Two concatenated members inflate to twice the size; bb reads such input, so both count.
        let two_members = [bomb.clone(), bomb.clone()].concat();
        assert!(inflate_dry_run("witness", &two_members, 2 * four_mib, &live).is_ok());
        assert!(inflate_dry_run("witness", &two_members, four_mib, &live).is_err());
        let cancelled = AtomicBool::new(true);
        assert!(matches!(
            inflate_dry_run("witness", &bomb, four_mib, &cancelled),
            Err(ProveError::ProveFailed(m)) if m == "request cancelled"
        ));
    }

    #[test]
    fn origin_slots_cap_each_origin_and_release_on_drop() {
        let slots = OriginSlots::default();
        let a = CanonicalOrigin::parse("https://a.example").unwrap();
        let b = CanonicalOrigin::parse("https://b.example").unwrap();
        let held: Vec<_> = (0..MAX_ULTRA_HONK_PER_ORIGIN)
            .map(|_| slots.try_enter(&a).unwrap())
            .collect();
        assert!(matches!(
            slots.try_enter(&a),
            Err(ProveError::OriginQueueFull)
        ));
        assert!(slots.try_enter(&b).is_ok(), "another origin is unaffected");
        drop(held);
        assert_eq!(slots.in_flight(&a), 0);
        assert!(slots.try_enter(&a).is_ok());
    }

    #[tokio::test]
    async fn a_dropped_request_releases_its_guards_only_after_the_worker_returns() {
        let permit_owner = Arc::new(tokio::sync::Semaphore::new(1));
        let permit = permit_owner.clone().acquire_owned().await.unwrap();
        // 64 MiB of zeros is a few KiB on the wire but takes the worker well past the drop below.
        let big = BASE64.encode(gz(&vec![0u8; 64 * 1024 * 1024]));
        let raw = RawRequest {
            bytecode: big.clone(),
            witness: big,
            vk: None,
            verifier_target: "evm".into(),
        };
        {
            let request = decode_on_worker(permit, raw);
            tokio::pin!(request);
            // Like a client disconnecting mid-validation: the request future is dropped at the end
            // of this block while the worker is still inflating.
            assert!(
                tokio::time::timeout(Duration::from_millis(20), &mut request)
                    .await
                    .is_err()
            );
        }
        assert!(
            permit_owner.try_acquire().is_err(),
            "still held by the detached worker"
        );
        let released = tokio::time::timeout(Duration::from_secs(10), async {
            while permit_owner.try_acquire().is_err() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await;
        assert!(
            released.is_ok(),
            "the cancel flag stops the worker within a chunk and the permit follows"
        );
    }

    #[test]
    fn render_includes_the_key_only_when_present() {
        let out = bb::UltraHonkOutput {
            proof: vec![1; 32],
            public_inputs: vec![],
            vk: None,
        };
        let v = render(&out);
        assert_eq!(v["public_inputs"], "");
        assert!(v.get("vk").is_none());
        let with = bb::UltraHonkOutput {
            vk: Some(vec![9]),
            ..out
        };
        assert_eq!(render(&with)["vk"], BASE64.encode([9u8]));
    }
}

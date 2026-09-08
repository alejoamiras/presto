//! `/prove/ultra-honk` against the REAL bb over the committed Noir fixtures. `#[ignore]`d: it needs a
//! bb binary (`BB_BINARY_PATH` or the usual search chain) and the CRS, so CI runs it in a dedicated
//! lane with `-- --ignored`; the ordinary unit suite stays bb-free.
//!
//! Byte equality is asserted only for the fixture's `noir-recursive-no-zk` target: ZK targets add
//! prover randomness, so the other supported targets are proven and natively verified, never
//! byte-compared.

use std::path::{Path, PathBuf};

use axum::body::{Body, Bytes};
use axum::http::{Request, StatusCode};
use base64::Engine;
use presto_core::server::{router, AppState};
use tower::util::ServiceExt;

/// Every target bb 5.2.0 proves. It also lists `starknet` / `starknet-no-zk` after `-t` but rejects
/// them at prove time ("Invalid proof system settings"); see `starknet_targets_are_refused_by_bb`.
const SUPPORTED_TARGETS: [&str; 6] = [
    "evm",
    "evm-no-zk",
    "noir-recursive",
    "noir-recursive-no-zk",
    "noir-rollup",
    "noir-rollup-no-zk",
];

struct Fixture {
    dir: PathBuf,
    bytecode: String,
    witness: Vec<u8>,
    vk: Vec<u8>,
    proof: Vec<u8>,
    public_inputs: Vec<u8>,
    target: String,
}

fn fixture(name: &str) -> Fixture {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../fixtures/noir")
        .join(name);
    let read = |f: &str| std::fs::read(dir.join(f)).unwrap_or_else(|e| panic!("{name}/{f}: {e}"));
    let artifact: serde_json::Value = serde_json::from_slice(&read("circuit.json")).unwrap();
    let manifest: serde_json::Value = serde_json::from_slice(&read("manifest.json")).unwrap();
    Fixture {
        bytecode: artifact["bytecode"].as_str().unwrap().to_string(),
        witness: read("witness.gz"),
        vk: read("vk"),
        proof: read("proof"),
        public_inputs: read("public_inputs"),
        target: manifest["verifierTarget"].as_str().unwrap().to_string(),
        dir,
    }
}

fn b64(bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

fn unb64(s: &str) -> Vec<u8> {
    base64::engine::general_purpose::STANDARD.decode(s).unwrap()
}

async fn post(fx: &Fixture, target: &str, vk: Option<&[u8]>) -> (StatusCode, Bytes) {
    let mut body = serde_json::json!({
        "bytecode": fx.bytecode,
        "witness": b64(&fx.witness),
        "verifier_target": target,
    });
    if let Some(vk) = vk {
        body["vk"] = serde_json::json!(b64(vk));
    }
    let request = Request::builder()
        .header("host", "127.0.0.1:59833")
        .method("POST")
        .uri("/prove/ultra-honk")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&body).unwrap()))
        .unwrap();
    let response = router(AppState::default()).oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    (status, bytes)
}

async fn prove(fx: &Fixture, target: &str, vk: Option<&[u8]>) -> serde_json::Value {
    let (status, bytes) = post(fx, target, vk).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "{} / {target}: {}",
        fx.dir.display(),
        String::from_utf8_lossy(&bytes)
    );
    serde_json::from_slice(&bytes).unwrap()
}

/// `bb verify` exits 1 both for an invalid proof and for a crash, so success is the only signal.
fn bb_verifies(proof: &[u8], public_inputs: &[u8], vk: &[u8], target: &str) -> bool {
    let bb = presto_core::bb::find_bb(None).expect("a real bb is required for this test");
    let dir = tempfile::tempdir().unwrap();
    for (name, bytes) in [
        ("proof", proof),
        ("public_inputs", public_inputs),
        ("vk", vk),
    ] {
        std::fs::write(dir.path().join(name), bytes).unwrap();
    }
    let status = std::process::Command::new(bb)
        .args(["verify", "--scheme", "ultra_honk", "-p"])
        .arg(dir.path().join("proof"))
        .arg("-i")
        .arg(dir.path().join("public_inputs"))
        .arg("-k")
        .arg(dir.path().join("vk"))
        .args(["-t", target])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .unwrap();
    status.success()
}

#[tokio::test]
#[ignore = "needs a real bb binary and the CRS; run in the ultra-honk-real-bb CI lane"]
async fn native_proofs_match_the_wasm_reference_and_verify() {
    for name in ["square", "nopub"] {
        let fx = fixture(name);
        let with_key = prove(&fx, &fx.target, Some(&fx.vk)).await;
        assert_eq!(
            unb64(with_key["proof"].as_str().unwrap()),
            fx.proof,
            "{name} proof bytes"
        );
        assert_eq!(
            unb64(with_key["public_inputs"].as_str().unwrap()),
            fx.public_inputs,
            "{name} public inputs"
        );
        assert!(
            with_key.get("vk").is_none(),
            "{name}: a client key is not echoed"
        );
        assert!(bb_verifies(
            &fx.proof,
            &fx.public_inputs,
            &fx.vk,
            &fx.target
        ));

        let computed = prove(&fx, &fx.target, None).await;
        assert_eq!(
            unb64(computed["vk"].as_str().unwrap()),
            fx.vk,
            "{name}: --write_vk equals the WASM key"
        );
        assert_eq!(
            unb64(computed["proof"].as_str().unwrap()),
            fx.proof,
            "{name}: same proof without a key"
        );

        let mut tampered = fx.proof.clone();
        tampered[100] ^= 0x01;
        assert!(
            !bb_verifies(&tampered, &fx.public_inputs, &fx.vk, &fx.target),
            "{name}: tampered proof must fail"
        );
    }
}

#[tokio::test]
#[ignore = "needs a real bb binary and the CRS; run in the ultra-honk-real-bb CI lane"]
async fn every_supported_target_proves_and_verifies() {
    let fx = fixture("square");
    for target in SUPPORTED_TARGETS {
        let out = prove(&fx, target, None).await;
        let proof = unb64(out["proof"].as_str().unwrap());
        let public_inputs = unb64(out["public_inputs"].as_str().unwrap());
        let vk = unb64(out["vk"].as_str().unwrap());
        assert_eq!(proof.len() % 32, 0, "{target}: proof is whole fields");
        assert_eq!(
            public_inputs, fx.public_inputs,
            "{target}: public inputs are target-independent"
        );
        assert!(
            bb_verifies(&proof, &public_inputs, &vk, target),
            "{target}: native verify"
        );
        if target == fx.target {
            assert_eq!(
                proof, fx.proof,
                "{target}: deterministic target matches the reference"
            );
        }
    }
}

/// Pins the bb 5.2.0 behaviour the route passes through unchanged: the request is well-formed, bb
/// itself refuses the settings, and the caller sees an ordinary `prove_failed`. When a bb release
/// starts proving these targets this test flips and the supported list above grows.
#[tokio::test]
#[ignore = "needs a real bb binary and the CRS; run in the ultra-honk-real-bb CI lane"]
async fn starknet_targets_are_refused_by_bb() {
    let fx = fixture("square");
    for target in ["starknet", "starknet-no-zk"] {
        let (status, body) = post(&fx, target, None).await;
        let text = String::from_utf8_lossy(&body);
        assert_eq!(
            status,
            StatusCode::INTERNAL_SERVER_ERROR,
            "{target}: {text}"
        );
        assert!(text.contains("prove_failed"), "{target}: {text}");
    }
}

/// bb's default `--vk_policy` trusts the supplied key, so a key from another circuit is not caught
/// up front: the route returns whatever bb produced, and it verifies against neither key. Getting
/// the key right is the caller's job; the invariant here is that a wrong key can never yield a proof
/// that verifies, and never takes the server down.
#[tokio::test]
#[ignore = "needs a real bb binary and the CRS; run in the ultra-honk-real-bb CI lane"]
async fn a_key_from_another_circuit_never_yields_a_verifying_proof() {
    let square = fixture("square");
    let nopub = fixture("nopub");
    let (status, body) = post(&square, &square.target, Some(&nopub.vk)).await;
    if status != StatusCode::OK {
        let text = String::from_utf8_lossy(&body);
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR, "{text}");
        assert!(text.contains("prove_failed"), "{text}");
        return;
    }
    let out: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let proof = unb64(out["proof"].as_str().unwrap());
    let public_inputs = unb64(out["public_inputs"].as_str().unwrap());
    assert!(
        !bb_verifies(&proof, &public_inputs, &square.vk, &square.target),
        "verifies against the real key"
    );
    assert!(
        !bb_verifies(&proof, &public_inputs, &nopub.vk, &square.target),
        "verifies against the wrong key"
    );
}

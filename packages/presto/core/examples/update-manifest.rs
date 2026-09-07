//! F-004 release-pipeline tool: assemble, splice, and verify the signed update-manifest envelope.
//!
//! The Tauri signer (`tauri signer sign`) does the actual minisign signing with the release key; this
//! tool only assembles the exact bytes to sign and, afterwards, embeds + verifies them — reusing the
//! SAME `presto_core::update_manifest` code the app runs, so the published feed is gated by the
//! production verifier before it ever reaches a user.
//!
//! Pipeline (see release-presto.yml):
//!   1. `update-manifest envelope --feed latest.json > envelope.json`
//!   2. `tauri signer sign envelope.json`            # → envelope.json.sig (base64 of the minisign doc)
//!   3. `update-manifest splice --feed latest.json --envelope envelope.json --sig envelope.json.sig \
//!         > latest.signed.json`
//!   4. `update-manifest verify --feed latest.signed.json --pubkey pubkey.b64`   # exit 0 ⇒ publishable
//!   5. `update-manifest verify-artifact --artifact app.tar.gz --sig app.tar.gz.sig \
//!         --pubkey pubkey.b64` # release signer verifies every updater payload before upload
//!
//! Encoding contract (kept in lockstep with `verify_manifest`):
//!   - `manifest` = base64(envelope.json bytes); verify base64-decodes it then verifies the sig.
//!   - `manifest_sig` = the `.sig` file content VERBATIM. Tauri already writes it as base64(minisign
//!     doc), which is exactly what verify base64-decodes back into the minisign document.

use std::process::ExitCode;

use base64::Engine as _;
use presto_core::update_manifest::{build_signed_envelope, verify_manifest};

fn die(msg: String) -> ! {
    eprintln!("update-manifest: {msg}");
    std::process::exit(2);
}

fn read_to_string(path: &str) -> String {
    std::fs::read_to_string(path).unwrap_or_else(|e| die(format!("read {path}: {e}")))
}

fn read_json(path: &str) -> serde_json::Value {
    serde_json::from_str(&read_to_string(path))
        .unwrap_or_else(|e| die(format!("parse {path}: {e}")))
}

/// Value of `--flag <value>` from argv, or exit with a usage error.
fn flag(args: &[String], name: &str) -> String {
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1))
        .cloned()
        .unwrap_or_else(|| die(format!("missing required {name}")))
}

fn envelope(args: &[String]) -> ExitCode {
    let feed = read_json(&flag(args, "--feed"));
    match build_signed_envelope(&feed) {
        Ok(bytes) => {
            use std::io::Write as _;
            if let Err(error) = std::io::stdout().write_all(&bytes) {
                die(format!("write stdout: {error}"));
            }
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("envelope assembly failed: {error}");
            ExitCode::from(1)
        }
    }
}

fn splice(args: &[String]) -> ExitCode {
    let mut feed = read_json(&flag(args, "--feed"));
    let envelope = std::fs::read(flag(args, "--envelope"))
        .unwrap_or_else(|error| die(format!("read envelope: {error}")));
    let signature = read_to_string(&flag(args, "--sig"));
    let base64 = base64::engine::general_purpose::STANDARD;
    feed["manifest"] = serde_json::Value::String(base64.encode(envelope));
    // The signer output is already base64(minisign document); encoding it again would corrupt it.
    feed["manifest_sig"] = serde_json::Value::String(signature.trim().to_string());
    println!("{}", serde_json::to_string_pretty(&feed).unwrap());
    ExitCode::SUCCESS
}

fn verify_feed(args: &[String]) -> ExitCode {
    let feed = read_json(&flag(args, "--feed"));
    let pubkey = read_to_string(&flag(args, "--pubkey"));
    let version = feed["version"]
        .as_str()
        .unwrap_or_else(|| die("feed has no string `version`".into()));
    let platforms = feed["platforms"]
        .as_object()
        .unwrap_or_else(|| die("feed has no `platforms` object".into()));
    if platforms.is_empty() {
        die("feed has no platforms to verify".into());
    }
    let all_valid = platforms.iter().all(|(target, platform)| {
        let url = platform["url"].as_str().unwrap_or_default();
        let signature = platform["signature"].as_str().unwrap_or_default();
        match verify_manifest(&feed, pubkey.trim(), version, url, signature) {
            Ok(verified) => {
                println!(
                    "OK  {target}: v{} ({} bytes)",
                    verified.version, verified.size
                );
                true
            }
            Err(error) => {
                eprintln!("FAIL {target}: {error}");
                false
            }
        }
    });
    if !all_valid {
        return ExitCode::from(1);
    }
    println!(
        "verify: all {} platform(s) bound to the signed envelope",
        platforms.len()
    );
    ExitCode::SUCCESS
}

fn decode_minisign_document(path: &str, kind: &str) -> String {
    let encoded = read_to_string(path);
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(encoded.trim())
        .unwrap_or_else(|error| die(format!("decode {path}: {error}")));
    String::from_utf8(decoded).unwrap_or_else(|error| die(format!("{kind} is not UTF-8: {error}")))
}

fn verify_artifact(args: &[String]) -> ExitCode {
    let artifact_path = flag(args, "--artifact");
    let artifact = std::fs::read(&artifact_path)
        .unwrap_or_else(|error| die(format!("read {artifact_path}: {error}")));
    let signature = minisign_verify::Signature::decode(&decode_minisign_document(
        &flag(args, "--sig"),
        "signature",
    ))
    .unwrap_or_else(|error| die(format!("decode signature document: {error}")));
    let public_key = minisign_verify::PublicKey::decode(&decode_minisign_document(
        &flag(args, "--pubkey"),
        "public key",
    ))
    .unwrap_or_else(|error| die(format!("decode public key document: {error}")));
    match public_key.verify(&artifact, &signature, false) {
        Ok(()) => {
            println!("OK  artifact: {artifact_path} ({} bytes)", artifact.len());
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("artifact signature verification failed: {error}");
            ExitCode::from(1)
        }
    }
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("envelope") => envelope(&args),
        Some("splice") => splice(&args),
        Some("verify") => verify_feed(&args),
        Some("verify-artifact") => verify_artifact(&args),
        _ => {
            eprintln!("usage: update-manifest <envelope|splice|verify|verify-artifact> [--flags]");
            ExitCode::from(2)
        }
    }
}

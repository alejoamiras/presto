//! Aztec release metadata: platform naming, download URLs, the shared HTTP client, and the GitHub
//! asset-digest lookup (SEC-02 caveat inline). q7e3-F-07: split from the `versions` module root; the
//! root re-exports keep external paths unchanged.

use super::version_policy::AztecVersion;
use std::error::Error;
use std::time::Duration;

/// Shared timeouts and agent for every outbound call here, so the two clients cannot drift.
fn client_builder() -> reqwest::ClientBuilder {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(300))
        .connect_timeout(Duration::from_secs(30))
        .user_agent("presto")
}

/// HTTP client with reasonable timeouts for downloading bb binaries. Follows redirects: a release
/// asset URL is answered with one, to the CDN that actually holds the bytes.
///
/// Errors rather than falling back to a default client: the fallback silently drops the deadlines in
/// [`client_builder`], and this download runs inside a `/prove` request, so an untimed one hangs the
/// caller's proof rather than failing it.
pub(crate) fn http_client() -> reqwest::Result<reqwest::Client> {
    client_builder().build()
}

/// Client for the API lookup, which carries a bearer token: redirects are REFUSED, not followed.
///
/// `reqwest` strips a sensitive header only when the next hop differs from the one before it, while
/// every hop is rebuilt from the ORIGINAL header map — so a chain that leaves `api.github.com` and
/// then redirects again inside the new host restores the token and hands it over. (Upstream fixed
/// the replay in `tower-http` 0.7; `reqwest` 0.13 still pins 0.6.) Release-by-tag answers 200, but
/// GitHub does redirect legitimately — a moved repository, say — and such a lookup now stops with an
/// explicit status instead of proceeding: the conservative trade, deliberately taken, because the
/// request carries a credential. Errors rather than falling back to a default client, which would
/// follow redirects and reinstate the leak.
fn metadata_client() -> reqwest::Result<reqwest::Client> {
    client_builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
}

/// The metadata GET, with the token attached when there is one. Separated so a test can inspect the
/// built request's headers without a live endpoint.
fn metadata_request(
    client: &reqwest::Client,
    api_url: &str,
    token: Option<&str>,
) -> reqwest::RequestBuilder {
    let request = client
        .get(api_url)
        .header("accept", "application/vnd.github+json");
    match token {
        Some(token) => request.bearer_auth(token),
        None => request,
    }
}

/// Returns the current platform identifier for download URLs.
///
/// Format: `{ARCH}-{OS}` matching Aztec release naming:
/// - `aarch64-apple-darwin` → `arm64-darwin`
/// - `x86_64-apple-darwin`  → `amd64-darwin`
/// - `x86_64-unknown-linux-gnu` → `amd64-linux`
/// - `aarch64-unknown-linux-gnu` → `arm64-linux`
pub fn current_platform() -> &'static str {
    #[cfg(all(target_arch = "aarch64", target_os = "macos"))]
    {
        "arm64-darwin"
    }
    #[cfg(all(target_arch = "x86_64", target_os = "macos"))]
    {
        "amd64-darwin"
    }
    #[cfg(all(target_arch = "x86_64", target_os = "linux"))]
    {
        "amd64-linux"
    }
    #[cfg(all(target_arch = "aarch64", target_os = "linux"))]
    {
        "arm64-linux"
    }
    #[cfg(all(target_arch = "x86_64", target_os = "windows"))]
    {
        "amd64-windows"
    }
}

/// Returns the download URL for a bb tarball from Aztec's GitHub releases.
///
/// Format: `https://github.com/AztecProtocol/aztec-packages/releases/download/v{VERSION}/barretenberg-{PLATFORM}.tar.gz`
/// q7e3-F-08: takes the validated `&AztecVersion` — an unvalidated string can no longer reach this
/// URL-building sink.
pub fn download_url(version: &AztecVersion) -> String {
    format!(
        "https://github.com/AztecProtocol/aztec-packages/releases/download/v{}/barretenberg-{}.tar.gz",
        version,
        current_platform(),
    )
}

/// Compute SHA-256 hex digest of the given bytes.
pub(crate) fn sha256_hex(data: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    hex::encode(Sha256::digest(data))
}

/// The GitHub API token to authenticate the digest lookup with, when the environment carries one.
///
/// Anonymous callers share a 60-request-per-hour budget per source address, which CI runners
/// exhaust between them; the lookup then fails and no proof can be produced. An authenticated call
/// is billed to the token's own, far larger quota instead. `download-bb.ts` reads the same
/// variable for the same reason — keep the two in step.
fn github_api_token() -> Option<String> {
    normalize_token(std::env::var("GITHUB_TOKEN").ok())
}

/// A set-but-blank variable counts as absent, so an empty export cannot send a `Bearer` with no
/// credential after it (GitHub answers that with 401, which reads as a broken token, not an unset one).
fn normalize_token(raw: Option<String>) -> Option<String> {
    let token = raw?;
    let token = token.trim();
    (!token.is_empty()).then(|| token.to_string())
}

/// Why a release-metadata request was refused, phrased for whoever reads the failure. The anonymous
/// rate limit is the likeliest cause of a 403 or 429 here and is invisible in the status alone, so
/// name it and name the way out.
fn refusal_reason(status: reqwest::StatusCode, authenticated: bool) -> String {
    let throttled = status == reqwest::StatusCode::FORBIDDEN
        || status == reqwest::StatusCode::TOO_MANY_REQUESTS;
    let hint = if throttled && !authenticated {
        " (anonymous GitHub API calls are capped at 60/hour per address — set GITHUB_TOKEN)"
    } else {
        ""
    };
    format!("GitHub API returned {status}{hint}")
}

/// Fetch the expected SHA-256 digest for a release asset from the GitHub API.
///
/// GitHub stores a `digest` field (e.g. `"sha256:abcd..."`) on every release asset. This catches
/// download corruption and CDN issues.
///
/// `Ok(None)` means the release answered but lists no asset of that name, or lists one carrying no
/// `sha256:`-prefixed digest. (A prefixed but malformed value is returned as-is and fails later,
/// against the downloaded bytes.) A refused request is an `Err` carrying the status instead. The
/// caller rejects both, so the distinction is diagnostic rather than behavioural: only `Ok(None)`
/// says anything about what the release publishes, and reporting a throttled lookup as one points
/// debugging at the wrong system.
///
/// SECURITY (SEC-02, deferred — circular trust): the digest is fetched from the SAME GitHub control
/// plane (`api.github.com`) that serves the binary, so an attacker who compromises the upstream
/// release (account/CI) — or MITMs both endpoints — can serve a malicious `bb` tarball AND a matching
/// digest; the check passes and the binary is installed + executed. A pure network MITM is blocked
/// (both hops are HTTPS), but supply-chain compromise is NOT. The real fix is verifying an UPSTREAM
/// PUBLISHER SIGNATURE pinned in the shipped app (minisign/cosign/TUF), the way our own auto-updater
/// already does — but Aztec does not yet sign `bb` releases. Pinning known-good digests in the app is
/// NOT a workaround: barretenberg nightlies ship EVERY night, so a pinned-digest manifest would be
/// perpetually stale. Revisit once Aztec signs `bb`.
/// Tracking: `implementations-plan/security-hardening-2026-06-09` (SEC-02) + a GitHub issue.
pub(crate) async fn fetch_github_asset_digest(
    version: &str,
    asset_name: &str,
) -> Result<Option<String>, Box<dyn Error + Send + Sync>> {
    let api_url = format!(
        "https://api.github.com/repos/AztecProtocol/aztec-packages/releases/tags/v{version}"
    );
    let token = github_api_token();
    let response = metadata_request(&metadata_client()?, &api_url, token.as_deref())
        .send()
        .await?;

    if !response.status().is_success() {
        tracing::warn!(
            version,
            status = %response.status(),
            authenticated = token.is_some(),
            "Release metadata request refused"
        );
        return Err(refusal_reason(response.status(), token.is_some()).into());
    }

    let release: serde_json::Value = response.json().await?;
    let assets = release["assets"].as_array();
    if let Some(assets) = assets {
        for asset in assets {
            if asset["name"].as_str() == Some(asset_name) {
                if let Some(digest) = asset["digest"].as_str() {
                    // Format: "sha256:abcdef..."
                    if let Some(hex) = digest.strip_prefix("sha256:") {
                        return Ok(Some(hex.to_string()));
                    }
                }
            }
        }
    }
    Ok(None)
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blank_github_token_reads_as_absent() {
        assert_eq!(normalize_token(None), None);
        assert_eq!(normalize_token(Some(String::new())), None);
        assert_eq!(normalize_token(Some("   ".into())), None);
        assert_eq!(
            normalize_token(Some("  ghp_tok  ".into())),
            Some("ghp_tok".into())
        );
    }

    #[test]
    fn an_anonymous_throttle_names_the_way_out() {
        let anon = refusal_reason(reqwest::StatusCode::FORBIDDEN, false);
        assert!(anon.contains("403"), "{anon}");
        assert!(anon.contains("GITHUB_TOKEN"), "{anon}");
        assert!(
            refusal_reason(reqwest::StatusCode::TOO_MANY_REQUESTS, false).contains("GITHUB_TOKEN")
        );
    }

    #[test]
    fn a_token_already_set_is_not_told_to_set_one() {
        // An authenticated caller can be throttled too, so the status alone does not rule it out;
        // the hint is suppressed because naming the variable they already set helps nobody.
        assert!(!refusal_reason(reqwest::StatusCode::FORBIDDEN, true).contains("GITHUB_TOKEN"));
        // A missing release is never a throttle, with or without a token.
        assert!(!refusal_reason(reqwest::StatusCode::NOT_FOUND, false).contains("GITHUB_TOKEN"));
        assert!(refusal_reason(reqwest::StatusCode::NOT_FOUND, false).contains("404"));
    }

    #[test]
    fn the_token_rides_on_the_lookup_and_is_absent_without_one() {
        let client = metadata_client().expect("client builds");
        let url = "https://api.github.com/repos/x/y/releases/tags/v1";
        let carried = metadata_request(&client, url, Some("ghp_tok"))
            .build()
            .expect("request builds");
        assert_eq!(
            carried
                .headers()
                .get(reqwest::header::AUTHORIZATION)
                .unwrap(),
            "Bearer ghp_tok"
        );
        assert_eq!(
            carried.headers().get("accept").unwrap(),
            "application/vnd.github+json"
        );
        let anonymous = metadata_request(&client, url, None)
            .build()
            .expect("request builds");
        assert!(anonymous
            .headers()
            .get(reqwest::header::AUTHORIZATION)
            .is_none());
    }

    /// Serve one 302 from an ephemeral loopback port and return its URL. Port 0, so this is safe
    /// beside a live presto and other agents' runs on the same machine.
    async fn serve_one_redirect(location: &str) -> String {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let location = location.to_string();
        tokio::spawn(async move {
            let Ok((mut sock, _)) = listener.accept().await else {
                return;
            };
            let mut scratch = [0u8; 1024];
            let _ = sock.read(&mut scratch).await;
            let head =
                format!("HTTP/1.1 302 Found\r\nlocation: {location}\r\ncontent-length: 0\r\n\r\n");
            let _ = sock.write_all(head.as_bytes()).await;
        });
        format!("http://{addr}/releases/tags/v1")
    }

    #[tokio::test]
    async fn the_lookup_refuses_to_follow_a_redirect() {
        let url = serve_one_redirect("http://elsewhere.invalid/collect").await;
        let response = metadata_request(&metadata_client().unwrap(), &url, Some("ghp_tok"))
            .send()
            .await
            .expect("the 302 itself is a response");
        // Following it would re-attach the bearer on any second hop within the destination host.
        assert_eq!(response.status(), reqwest::StatusCode::FOUND);
    }

    #[test]
    fn download_url_format() {
        let version = AztecVersion::parse("5.0.0-nightly.20260307").unwrap();
        let url = download_url(&version);
        assert!(url.starts_with("https://github.com/AztecProtocol/aztec-packages/releases/download/v5.0.0-nightly.20260307/barretenberg-"));
        assert!(url.ends_with(".tar.gz"));
    }

    #[test]
    fn current_platform_matches_aztec_naming() {
        // Aztec releases use "darwin" (not "macos") and "linux"
        let valid = [
            "arm64-darwin",
            "amd64-darwin",
            "amd64-linux",
            "arm64-linux",
            "amd64-windows",
        ];
        let platform = current_platform();
        assert!(
            valid.contains(&platform),
            "current_platform() returned '{platform}', expected one of {valid:?}. \
             Check Aztec release assets at https://github.com/AztecProtocol/aztec-packages/releases"
        );
    }

    /// Smoke test: verify the download URL for a known release actually resolves (HTTP HEAD).
    /// Gated behind PRESTO_DOWNLOAD_TEST to avoid network calls in regular CI.
    #[tokio::test]
    async fn download_url_resolves() {
        if std::env::var("PRESTO_DOWNLOAD_TEST").is_err() {
            eprintln!("Skipping download_url_resolves (set PRESTO_DOWNLOAD_TEST=1 to enable)");
            return;
        }
        // Use a known stable version that will always exist
        let version = std::env::var("AZTEC_BB_VERSION").unwrap_or("5.0.0-nightly.20260307".into());
        let version = AztecVersion::parse(&version).expect("test version is valid");
        let url = download_url(&version);
        let client = reqwest::Client::new();
        let resp = client
            .head(&url)
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .await
            .unwrap_or_else(|e| panic!("HEAD {url} failed: {e}"));
        assert!(
            resp.status().is_success() || resp.status().is_redirection(),
            "HEAD {url} returned {}, expected 2xx/3xx. \
             The download URL pattern may have changed — check Aztec release assets.",
            resp.status()
        );
    }

    #[test]
    fn sha256_hex_produces_correct_digest() {
        // SHA-256 of empty input is the well-known constant
        let digest = sha256_hex(b"");
        assert_eq!(
            digest,
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn sha256_hex_detects_different_inputs() {
        let a = sha256_hex(b"hello");
        let b = sha256_hex(b"world");
        assert_ne!(a, b);
        assert_eq!(a.len(), 64); // 32 bytes = 64 hex chars
    }
}

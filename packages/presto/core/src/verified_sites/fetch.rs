//! The one request the app makes for the list: a plain GET of the served envelope that carries
//! nothing about the user or the sites they visit. Verifying the answer is the caller's job; this
//! only bounds what an answer can cost.

use std::time::Duration;

use super::verify::ListKey;
use super::DOCUMENT_MAX_BYTES;

pub const PRODUCTION_URL: &str = "https://presto.build/releases/verified-sites.json";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const PRODUCTION_TIMEOUT: Duration = Duration::from_secs(30);
const DOCUMENT_MAX_LEN: u64 = DOCUMENT_MAX_BYTES as u64;

/// Where the list comes from and the key it must be signed with.
#[derive(Clone, Debug)]
pub struct Feed {
    pub url: String,
    pub key: ListKey,
    /// From connecting to the last body byte, so a drip or a hang ends here too.
    pub timeout: Duration,
    pub https_only: bool,
}

impl Feed {
    pub fn production(key: ListKey) -> Self {
        Self {
            url: PRODUCTION_URL.to_string(),
            key,
            timeout: PRODUCTION_TIMEOUT,
            https_only: true,
        }
    }
}

#[derive(Debug)]
pub enum FetchError {
    /// Any answer but 200, redirects included: a redirect is never followed.
    Status(u16),
    TooLarge,
    Network(reqwest::Error),
}

impl std::fmt::Display for FetchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Status(status) => write!(f, "HTTP {status}"),
            Self::TooLarge => write!(f, "over the {DOCUMENT_MAX_BYTES}-byte cap"),
            Self::Network(e) => write!(f, "{e}"),
        }
    }
}

/// The body of a 200 within [`DOCUMENT_MAX_BYTES`]. One attempt, no retries: the schedule retries.
pub async fn fetch_document(feed: &Feed) -> Result<Vec<u8>, FetchError> {
    let client = reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(feed.timeout)
        .redirect(reqwest::redirect::Policy::none())
        .https_only(feed.https_only)
        .user_agent("presto")
        .build()
        .map_err(FetchError::Network)?;
    let mut response = client
        .get(&feed.url)
        .send()
        .await
        .map_err(FetchError::Network)?;
    if response.status() != reqwest::StatusCode::OK {
        return Err(FetchError::Status(response.status().as_u16()));
    }
    // An advertised length fails fast; the running count is the real ceiling.
    if response
        .content_length()
        .is_some_and(|len| len > DOCUMENT_MAX_LEN)
    {
        return Err(FetchError::TooLarge);
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(FetchError::Network)? {
        if body.len().saturating_add(chunk.len()) > DOCUMENT_MAX_BYTES {
            return Err(FetchError::TooLarge);
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::arithmetic_side_effects
)]
mod tests {
    use std::sync::Arc;

    use parking_lot::Mutex;
    use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
    use tokio::net::TcpListener;
    use tokio::time::Instant;

    use super::*;

    const TEST_TIMEOUT: Duration = Duration::from_secs(1);
    /// Every case must end well inside this, or the production deadlines are not doing their job.
    const CASE_DEADLINE: Duration = Duration::from_secs(5);

    #[derive(Clone)]
    enum Script {
        /// A complete response: head (status line and headers, no blank line) and body.
        Reply(String, Vec<u8>),
        /// A chunked 200 that sends `chunks` of `size` bytes, then ends.
        Chunked { chunks: usize, size: usize },
        /// A chunked 200 that sends one byte every 100 ms, forever.
        Drip,
        /// Reads the request and never answers.
        Hang,
    }

    /// Serves `script` on an ephemeral loopback port (safe beside other runs) to every connection,
    /// recording each request head.
    async fn serve(script: Script) -> (String, Arc<Mutex<Vec<String>>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let requests = Arc::new(Mutex::new(Vec::new()));
        let seen = Arc::clone(&requests);
        tokio::spawn(async move {
            while let Ok((mut socket, _)) = listener.accept().await {
                let script = script.clone();
                let seen = Arc::clone(&seen);
                tokio::spawn(async move {
                    let mut head = Vec::new();
                    let mut byte = [0u8; 1];
                    while !head.ends_with(b"\r\n\r\n") {
                        if socket.read(&mut byte).await.unwrap_or(0) == 0 {
                            return;
                        }
                        head.push(byte[0]);
                    }
                    seen.lock()
                        .push(String::from_utf8_lossy(&head).into_owned());
                    answer(&mut socket, script).await;
                });
            }
        });
        (
            format!("http://{addr}/releases/verified-sites.json"),
            requests,
        )
    }

    async fn answer(socket: &mut tokio::net::TcpStream, script: Script) {
        const CHUNKED: &[u8] = b"HTTP/1.1 200 OK\r\ntransfer-encoding: chunked\r\n\r\n";
        match script {
            Script::Reply(head, body) => {
                let _ = socket.write_all(format!("{head}\r\n\r\n").as_bytes()).await;
                let _ = socket.write_all(&body).await;
            }
            Script::Chunked { chunks, size } => {
                let _ = socket.write_all(CHUNKED).await;
                for _ in 0..chunks {
                    let chunk = format!("{size:x}\r\n{}\r\n", "x".repeat(size));
                    if socket.write_all(chunk.as_bytes()).await.is_err() {
                        return;
                    }
                }
                let _ = socket.write_all(b"0\r\n\r\n").await;
            }
            Script::Drip => {
                let _ = socket.write_all(CHUNKED).await;
                while socket.write_all(b"1\r\nx\r\n").await.is_ok() {
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
            }
            Script::Hang => std::future::pending().await,
        }
    }

    fn feed(url: &str) -> Feed {
        let key = include_str!("../../tests/fixtures/verified_sites/test1.pub");
        Feed {
            url: url.to_string(),
            key: ListKey::from_document(key).unwrap(),
            timeout: TEST_TIMEOUT,
            https_only: false,
        }
    }

    async fn fetch(script: Script) -> (Result<Vec<u8>, FetchError>, Duration, Vec<String>) {
        let (url, requests) = serve(script).await;
        let started = Instant::now();
        let result = tokio::time::timeout(CASE_DEADLINE, fetch_document(&feed(&url)))
            .await
            .expect("the fetch outlived its own deadlines");
        let requests = requests.lock().clone();
        (result, started.elapsed(), requests)
    }

    fn reply(head: &str, body: &[u8]) -> Script {
        Script::Reply(head.to_string(), body.to_vec())
    }

    #[tokio::test]
    async fn a_200_returns_the_body_of_a_bare_get() {
        let body = br#"{"schema":"presto-verified-sites-envelope-v1"}"#;
        let head = format!(
            "HTTP/1.1 200 OK\r\ncontent-length: {}\r\nset-cookie: a=b",
            body.len()
        );
        let (result, _, requests) = fetch(reply(&head, body)).await;
        assert_eq!(result.unwrap(), body);
        let [request] = requests.as_slice() else {
            panic!("expected one request, got {requests:?}");
        };
        let request = request.to_ascii_lowercase();
        assert!(request.starts_with("get /releases/verified-sites.json http/1.1\r\n"));
        assert!(request.contains("\r\nuser-agent: presto\r\n"), "{request}");
        for absent in ["cookie:", "content-length:", "transfer-encoding:"] {
            assert!(!request.contains(absent), "{absent} in {request}");
        }
    }

    #[tokio::test]
    async fn anything_but_200_is_refused_and_never_followed() {
        let cases = [
            (
                "HTTP/1.1 302 Found\r\nlocation: /elsewhere\r\ncontent-length: 0",
                302,
            ),
            ("HTTP/1.1 404 Not Found\r\ncontent-length: 0", 404),
            ("HTTP/1.1 503 Service Unavailable\r\ncontent-length: 0", 503),
            ("HTTP/1.1 204 No Content", 204),
        ];
        for (head, status) in cases {
            let (result, _, requests) = fetch(reply(head, b"")).await;
            assert!(
                matches!(result, Err(FetchError::Status(s)) if s == status),
                "{head}: {result:?}"
            );
            assert_eq!(requests.len(), 1, "{head}: one request, no redirect hop");
        }
    }

    #[tokio::test]
    async fn an_advertised_oversized_body_is_refused_before_reading_it() {
        // The body never comes: only the header can end this before the timeout.
        let head = format!(
            "HTTP/1.1 200 OK\r\ncontent-length: {}",
            DOCUMENT_MAX_BYTES + 1
        );
        let (result, elapsed, _) = fetch(reply(&head, b"")).await;
        assert!(matches!(result, Err(FetchError::TooLarge)), "{result:?}");
        assert!(elapsed < TEST_TIMEOUT);
    }

    #[tokio::test]
    async fn a_chunked_body_is_counted_up_to_the_cap() {
        let at_cap = Script::Chunked {
            chunks: DOCUMENT_MAX_BYTES / 1024,
            size: 1024,
        };
        assert_eq!(fetch(at_cap).await.0.unwrap().len(), DOCUMENT_MAX_BYTES);
        let over = Script::Chunked {
            chunks: DOCUMENT_MAX_BYTES / 1024 + 1,
            size: 1024,
        };
        let (result, _, _) = fetch(over).await;
        assert!(matches!(result, Err(FetchError::TooLarge)), "{result:?}");
    }

    #[tokio::test]
    async fn a_drip_and_a_hang_end_at_the_timeout() {
        for script in [Script::Drip, Script::Hang] {
            let (result, elapsed, _) = fetch(script).await;
            match result {
                Err(FetchError::Network(e)) => assert!(e.is_timeout(), "{e}"),
                other => panic!("expected a timeout, got {other:?}"),
            }
            assert!(elapsed >= TEST_TIMEOUT && elapsed < TEST_TIMEOUT * 3);
        }
    }

    #[tokio::test]
    async fn the_production_feed_is_https_only() {
        let key = feed("unused").key;
        let production = Feed::production(key.clone());
        assert_eq!(production.url, PRODUCTION_URL);
        assert_eq!(
            production.url,
            "https://presto.build/releases/verified-sites.json"
        );
        assert!(production.https_only);
        assert_eq!(production.timeout, Duration::from_secs(30));
        assert_eq!(production.key.key_id(), key.key_id());

        let (url, requests) = serve(reply("HTTP/1.1 200 OK\r\ncontent-length: 0", b"")).await;
        let https_only = Feed {
            https_only: true,
            ..feed(&url)
        };
        assert!(matches!(
            fetch_document(&https_only).await,
            Err(FetchError::Network(_))
        ));
        assert!(
            requests.lock().is_empty(),
            "refused before sending anything"
        );
    }
}

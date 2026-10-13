//! The verified-sites list: a curated map from origin to display name, signed in CI with a key used
//! for nothing else and served by the release-feed Worker. The popup's badge reads it; authorization
//! never does, so the worst a bad list can do is name a site the user must still approve.
//!
//! Trust flows one way: list bytes become a [`list::SiteList`] only through
//! [`list::SiteList::parse_unsigned`] (bytes the caller already trusts, such as a compiled-in record)
//! or [`verify::verify_list`] / [`verify::verify_document`] (bytes from anywhere else).
//!
//! The app aborts on panic and crash recovery would turn a startup panic into a crash loop, so this
//! module denies the lints below.
#![deny(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::arithmetic_side_effects
)]

pub mod history;
pub mod list;
pub mod report;
pub mod verify;

/// Largest list accepted anywhere, checked before parsing or verifying.
pub const LIST_MAX_BYTES: usize = 64 * 1024;
/// Largest minisign signature file accepted.
pub const SIGNATURE_MAX_BYTES: usize = 1024;
/// Largest served envelope accepted, checked before parsing.
pub const DOCUMENT_MAX_BYTES: usize = 96 * 1024;
/// The largest integer JavaScript and JSON tooling represent exactly.
pub const MAX_VERSION: u64 = (1 << 53) - 1;
/// The signature's trusted comment, required byte for byte: it binds a signature to this use.
pub const TRUSTED_COMMENT: &str = "presto-verified-sites-v1";
/// The served envelope's `schema` field.
pub const ENVELOPE_SCHEMA: &str = "presto-verified-sites-envelope-v1";
/// The only `$schema` value a list may carry (editor documentation).
pub const LIST_SCHEMA_REF: &str = "./verified-sites.schema.json";

/// Why bytes were refused. Callers treat every variant alike; the detail is for logs and CI output.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ListError {
    TooLarge(&'static str),
    /// Not JSON, or JSON of the wrong shape (an unknown field, a missing one, a wrong type).
    Parse(String),
    /// Well-formed JSON that breaks a list rule.
    Rule(String),
    PublicKey(&'static str),
    /// The signature file is malformed or not in the one accepted form.
    Signature(&'static str),
    /// Signed by a key other than the one given.
    KeyMismatch,
    /// The Ed25519 check failed: the bytes or the signature were altered.
    SignatureInvalid,
    Envelope(&'static str),
}

impl std::fmt::Display for ListError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::TooLarge(what) => write!(f, "{what} is over its size cap"),
            Self::Parse(detail) => write!(f, "list does not parse: {detail}"),
            Self::Rule(detail) => write!(f, "list breaks a rule: {detail}"),
            Self::PublicKey(detail) => write!(f, "public key: {detail}"),
            Self::Signature(detail) => write!(f, "signature: {detail}"),
            Self::KeyMismatch => write!(f, "signed by a different key"),
            Self::SignatureInvalid => write!(f, "signature does not verify"),
            Self::Envelope(detail) => write!(f, "envelope: {detail}"),
        }
    }
}

impl std::error::Error for ListError {}

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::arithmetic_side_effects
)]
mod tests;

//! Signature checks for the list, its served envelope, and the version decision. Every accepted form
//! is the one form the signer writes; anything else is refused rather than normalized.

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};

use super::list::SiteList;
use super::{
    ListError, DOCUMENT_MAX_BYTES, ENVELOPE_SCHEMA, LIST_MAX_BYTES, SIGNATURE_MAX_BYTES,
    TRUSTED_COMMENT,
};

const KEY_COMMENT_PREFIX: &str = "untrusted comment: presto verified-sites public key ";
const SIGNATURE_COMMENT_PREFIX: &str = "untrusted comment: presto verified-sites list version ";
/// minisign's algorithm tags: `Ed` on keys, `ED` on prehashed (BLAKE2b-512) signatures.
const KEY_ALGORITHM: &[u8; 2] = b"Ed";

/// A pinned list key, parsed from its minisign public-key file. The key ID must be the first 8
/// bytes of SHA-256 of the key, so an ID names exactly one key.
#[derive(Clone, Debug)]
pub struct ListKey {
    key: minisign_verify::PublicKey,
    key_id: [u8; 8],
}

impl ListKey {
    /// Parse the two-line public-key file, `\n`-terminated, exactly as the signer writes it.
    pub fn from_document(document: &str) -> Result<Self, ListError> {
        let [comment, encoded] = exact_lines::<2>(document).ok_or(ListError::PublicKey(
            "expected two newline-terminated lines",
        ))?;
        let raw = BASE64
            .decode(encoded)
            .map_err(|_| ListError::PublicKey("not base64"))?;
        let (Some(algorithm), Some(key_id), Some(public)) =
            (raw.get(..2), raw.get(2..10), raw.get(10..))
        else {
            return Err(ListError::PublicKey("too short"));
        };
        if algorithm != KEY_ALGORITHM || public.len() != 32 {
            return Err(ListError::PublicKey("not an Ed25519 minisign key"));
        }
        let key_id: [u8; 8] = key_id
            .try_into()
            .map_err(|_| ListError::PublicKey("too short"))?;
        if Sha256::digest(public).get(..8) != Some(&key_id[..]) {
            return Err(ListError::PublicKey("key ID is not derived from the key"));
        }
        if comment != format!("{KEY_COMMENT_PREFIX}{}", key_id_hex(&key_id)) {
            return Err(ListError::PublicKey("unexpected comment line"));
        }
        let key = minisign_verify::PublicKey::from_base64(encoded)
            .map_err(|_| ListError::PublicKey("rejected by minisign"))?;
        Ok(Self { key, key_id })
    }

    pub fn key_id(&self) -> [u8; 8] {
        self.key_id
    }

    /// The key ID as minisign prints it.
    pub fn key_id_hex(&self) -> String {
        key_id_hex(&self.key_id)
    }
}

/// minisign prints a key ID as the little-endian integer of its 8 bytes, in upper-case hex.
pub fn key_id_hex(key_id: &[u8; 8]) -> String {
    format!("{:016X}", u64::from_le_bytes(*key_id))
}

/// The key ID a signature file claims, read without trusting it: for choosing which pinned or
/// retired key to verify with, never as evidence of who signed.
pub fn claimed_key_id(signature: &[u8]) -> Result<[u8; 8], ListError> {
    let [_, encoded, _, _] = signature_lines(signature)?;
    let raw = BASE64
        .decode(encoded)
        .map_err(|_| ListError::Signature("not base64"))?;
    raw.get(2..10)
        .and_then(|id| <[u8; 8]>::try_from(id).ok())
        .ok_or(ListError::Signature("too short"))
}

/// Verify `signature` over the exact `list` bytes with `key`, then parse the list.
pub fn verify_list(list: &[u8], signature: &[u8], key: &ListKey) -> Result<SiteList, ListError> {
    if list.len() > LIST_MAX_BYTES {
        return Err(ListError::TooLarge("list"));
    }
    let [comment, _, trusted, _] = signature_lines(signature)?;
    if trusted != format!("trusted comment: {TRUSTED_COMMENT}") {
        return Err(ListError::Signature("unexpected trusted comment"));
    }
    let text = std::str::from_utf8(signature).map_err(|_| ListError::Signature("not UTF-8"))?;
    let decoded = minisign_verify::Signature::decode(text)
        .map_err(|_| ListError::Signature("rejected by minisign"))?;
    // Prehashed `ED` only: `allow_legacy = false` refuses the older raw-message form.
    key.key.verify(list, &decoded, false).map_err(|e| match e {
        minisign_verify::Error::UnexpectedKeyId => ListError::KeyMismatch,
        minisign_verify::Error::UnexpectedAlgorithm => {
            ListError::Signature("legacy signature (not prehashed)")
        }
        _ => ListError::SignatureInvalid,
    })?;
    let parsed = SiteList::parse_unsigned(list)?;
    if comment != format!("{SIGNATURE_COMMENT_PREFIX}{}", parsed.version()) {
        return Err(ListError::Signature("unexpected comment line"));
    }
    Ok(parsed)
}

/// The served envelope and the client's cache file: one request carries both list and signature.
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Envelope {
    schema: String,
    list: String,
    signature: String,
}

/// Build the envelope for a list and its signature: compact JSON, fixed field order.
pub fn document(list: &[u8], signature: &[u8]) -> Vec<u8> {
    let envelope = Envelope {
        schema: ENVELOPE_SCHEMA.to_string(),
        list: BASE64.encode(list),
        signature: BASE64.encode(signature),
    };
    // Three string fields cannot fail to serialize.
    serde_json::to_vec(&envelope).unwrap_or_default()
}

/// A verified envelope: the list it carries and the signature file it was verified with.
#[derive(Debug, Clone)]
pub struct VerifiedDocument {
    pub list: SiteList,
    pub signature: Vec<u8>,
}

/// Verify an envelope from any source. Only the exact bytes [`document`] produces are accepted, so a
/// document's bytes identify it.
pub fn verify_document(bytes: &[u8], key: &ListKey) -> Result<VerifiedDocument, ListError> {
    let (list, signature) = document_parts(bytes)?;
    let list = verify_list(&list, &signature, key)?;
    Ok(VerifiedDocument { list, signature })
}

/// The list and signature an envelope carries, decoded but NOT verified: for choosing a key by
/// [`claimed_key_id`] before [`verify_document`], never for trusting the contents.
pub fn document_parts(bytes: &[u8]) -> Result<(Vec<u8>, Vec<u8>), ListError> {
    if bytes.len() > DOCUMENT_MAX_BYTES {
        return Err(ListError::TooLarge("document"));
    }
    let envelope: Envelope =
        serde_json::from_slice(bytes).map_err(|_| ListError::Envelope("not an envelope"))?;
    if envelope.schema != ENVELOPE_SCHEMA {
        return Err(ListError::Envelope("unknown schema"));
    }
    if envelope.list.len() > encoded_len(LIST_MAX_BYTES) {
        return Err(ListError::TooLarge("list"));
    }
    if envelope.signature.len() > encoded_len(SIGNATURE_MAX_BYTES) {
        return Err(ListError::TooLarge("signature"));
    }
    let list = BASE64
        .decode(&envelope.list)
        .map_err(|_| ListError::Envelope("list is not base64"))?;
    let signature = BASE64
        .decode(&envelope.signature)
        .map_err(|_| ListError::Envelope("signature is not base64"))?;
    if document(&list, &signature) != bytes {
        return Err(ListError::Envelope("not in canonical form"));
    }
    Ok((list, signature))
}

/// How a candidate list relates to the current one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Judgement {
    Accept,
    Unchanged,
    /// Same version, different bytes: two lists were signed for one version. Never accepted.
    Equivocation,
    /// Normal right after an app update, whose built-in list may be newer than the served one.
    Older,
}

pub fn judge(current: &SiteList, candidate: &SiteList) -> Judgement {
    use std::cmp::Ordering;
    match candidate.version().cmp(&current.version()) {
        Ordering::Greater => Judgement::Accept,
        Ordering::Less => Judgement::Older,
        Ordering::Equal if candidate.bytes() == current.bytes() => Judgement::Unchanged,
        Ordering::Equal => Judgement::Equivocation,
    }
}

/// Base64 length of `n` bytes, padded.
const fn encoded_len(n: usize) -> usize {
    n.div_ceil(3).saturating_mul(4)
}

/// The four lines of a signature file, which must be ASCII, `\n`-terminated and within the cap.
fn signature_lines(signature: &[u8]) -> Result<[&str; 4], ListError> {
    if signature.len() > SIGNATURE_MAX_BYTES {
        return Err(ListError::TooLarge("signature"));
    }
    let text = std::str::from_utf8(signature).map_err(|_| ListError::Signature("not UTF-8"))?;
    exact_lines::<4>(text).ok_or(ListError::Signature(
        "expected four newline-terminated lines",
    ))
}

/// Exactly `N` lines, each ending in `\n`, printable ASCII only (so no `\r` survives).
fn exact_lines<const N: usize>(text: &str) -> Option<[&str; N]> {
    if !text.ends_with('\n')
        || !text
            .bytes()
            .all(|b| b == b'\n' || (0x20..=0x7e).contains(&b))
    {
        return None;
    }
    let body = text.strip_suffix('\n')?;
    let lines: Vec<&str> = body.split('\n').collect();
    lines.try_into().ok()
}

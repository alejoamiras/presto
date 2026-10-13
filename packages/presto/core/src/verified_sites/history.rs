//! The repository's signed history, `verified-sites/history/<N>.json` with `<N>.json.minisig`, and
//! the decisions CI takes from it. Only the release bot writes records; nothing here runs in the app.

use std::path::Path;

use sha2::{Digest as _, Sha256};

use super::list::SiteList;
use super::verify::{
    claimed_key_id, document_parts, key_id_hex, verify_document, verify_list, ListKey,
};
use super::MAX_VERSION;

/// The most a new list's version may exceed the newest record's, so a typo cannot burn the counter.
pub const MAX_VERSION_STEP: u64 = 100;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Record {
    pub version: u64,
    pub list: Vec<u8>,
    pub signature: Vec<u8>,
}

/// Which key verified a record or a live document.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SignedBy {
    Pinned,
    /// A key moved to `retired-keys/<KEYID>.pub` at a rotation.
    Retired(String),
}

/// Every record in `dir` (none if it does not exist), in version order. Refuses any other file
/// name, a list without its signature or the reverse, and any `\r` (a CRLF checkout would change the
/// signed bytes).
pub fn read_records(dir: &Path) -> Result<Vec<Record>, String> {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(format!("read {}: {e}", dir.display())),
    };
    let mut lists = std::collections::BTreeMap::new();
    let mut signatures = std::collections::BTreeMap::new();
    for entry in entries {
        let entry = entry.map_err(|e| format!("read {}: {e}", dir.display()))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let (version, is_signature) =
            record_name(&name).ok_or_else(|| format!("unexpected file in history: {name}"))?;
        if !entry.file_type().is_ok_and(|t| t.is_file()) {
            return Err(format!("{name} is not a regular file"));
        }
        let bytes = std::fs::read(entry.path()).map_err(|e| format!("read {name}: {e}"))?;
        if bytes.contains(&b'\r') {
            return Err(format!("{name} contains a carriage return"));
        }
        let slot = if is_signature {
            &mut signatures
        } else {
            &mut lists
        };
        slot.insert(version, bytes);
    }
    let mut records = Vec::new();
    for (version, list) in lists {
        let signature = signatures
            .remove(&version)
            .ok_or_else(|| format!("{version}.json has no {version}.json.minisig"))?;
        records.push(Record {
            version,
            list,
            signature,
        });
    }
    if let Some(version) = signatures.keys().next() {
        return Err(format!("{version}.json.minisig has no {version}.json"));
    }
    Ok(records)
}

/// `<N>.json` or `<N>.json.minisig`, with `N` a positive version without leading zeros.
fn record_name(name: &str) -> Option<(u64, bool)> {
    let (stem, is_signature) = match name.strip_suffix(".json.minisig") {
        Some(stem) => (stem, true),
        None => (name.strip_suffix(".json")?, false),
    };
    let numeric = !stem.is_empty() && stem.bytes().all(|b| b.is_ascii_digit());
    if !numeric || stem.starts_with('0') {
        return None;
    }
    let version = stem.parse::<u64>().ok()?;
    (version <= MAX_VERSION).then_some((version, is_signature))
}

/// The key that must verify a signature: the pinned key, or the retired key its ID names.
fn key_for(
    signature: &[u8],
    pinned: &ListKey,
    retired: &Path,
) -> Result<(ListKey, SignedBy), String> {
    let id = claimed_key_id(signature).map_err(|e| e.to_string())?;
    if id == pinned.key_id() {
        return Ok((pinned.clone(), SignedBy::Pinned));
    }
    let hex = key_id_hex(&id);
    let path = retired.join(format!("{hex}.pub"));
    let document = std::fs::read_to_string(&path)
        .map_err(|_| format!("signed by key {hex}, which is neither pinned nor retired"))?;
    let key = ListKey::from_document(&document).map_err(|e| format!("{hex}.pub: {e}"))?;
    if key.key_id() != id {
        return Err(format!("{hex}.pub holds key {}", key.key_id_hex()));
    }
    Ok((key, SignedBy::Retired(hex)))
}

/// Verify a record under the key its signature names, which must be pinned or retired.
pub fn verify_record(
    record: &Record,
    pinned: &ListKey,
    retired: &Path,
) -> Result<(SiteList, SignedBy), String> {
    let name = record.version;
    let (key, signed_by) = key_for(&record.signature, pinned, retired)?;
    let list = verify_list(&record.list, &record.signature, &key)
        .map_err(|e| format!("record {name}: {e}"))?;
    if list.version() != record.version {
        return Err(format!("record {name} holds version {}", list.version()));
    }
    Ok((list, signed_by))
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

/// What `prepare` does with the source list.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SignPlan {
    pub source: SiteList,
    /// The newest record and the key that signed it, if history is not empty.
    pub previous: Option<(SiteList, SignedBy)>,
    pub sign: bool,
}

/// Sign iff the source differs from the newest record, or that record was signed by a retired key.
/// A list to sign must be above the newest record (0 before the first), by at most
/// [`MAX_VERSION_STEP`], so no list can push the counter out of reach.
pub fn plan_signing(
    source: &[u8],
    records: &[Record],
    pinned: &ListKey,
    retired: &Path,
) -> Result<SignPlan, String> {
    let source = SiteList::parse_unsigned(source).map_err(|e| format!("source: {e}"))?;
    let Some(newest) = records.last() else {
        if source.version() > MAX_VERSION_STEP {
            return Err(format!(
                "version {} is more than {MAX_VERSION_STEP} above 0, and there is no record yet",
                source.version()
            ));
        }
        return Ok(SignPlan {
            source,
            previous: None,
            sign: true,
        });
    };
    let (previous, signed_by) = verify_record(newest, pinned, retired)?;
    let unchanged = source.bytes() == previous.bytes();
    if unchanged && signed_by == SignedBy::Pinned {
        return Ok(SignPlan {
            source,
            previous: Some((previous, signed_by)),
            sign: false,
        });
    }
    let (have, newest) = (source.version(), previous.version());
    if have <= newest {
        return Err(if unchanged {
            format!("record {newest} is signed by a retired key: bump the version to sign it under the pinned key")
        } else {
            format!("version {have} must be above the newest record, {newest}")
        });
    }
    if have > newest.saturating_add(MAX_VERSION_STEP) {
        return Err(format!(
            "version {have} is more than {MAX_VERSION_STEP} above the newest record, {newest}"
        ));
    }
    Ok(SignPlan {
        source,
        previous: Some((previous, signed_by)),
        sign: true,
    })
}

/// Where the live document stands against history.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Live {
    Absent,
    /// It equals the record of its version, which is older than the newest record.
    Behind {
        version: u64,
        signed_by: SignedBy,
    },
    /// It equals the newest record.
    Current {
        version: u64,
        signed_by: SignedBy,
    },
}

/// Check a live document against the record of its version: the same list bytes, and a signature
/// that verifies under that record's key. A document ahead of history, or one that differs from its
/// version's record, means the live list was written outside this flow.
pub fn classify_live(
    document: Option<&[u8]>,
    records: &[Record],
    pinned: &ListKey,
    retired: &Path,
) -> Result<Live, String> {
    let Some(document) = document else {
        return Ok(Live::Absent);
    };
    let (_, signature) = document_parts(document).map_err(|e| format!("live: {e}"))?;
    let (key, signed_by) =
        key_for(&signature, pinned, retired).map_err(|e| format!("live: {e}"))?;
    let live = verify_document(document, &key)
        .map_err(|e| format!("live: {e}"))?
        .list;
    let version = live.version();
    let newest = records.last().map_or(0, |r| r.version);
    let Some(record) = records.iter().find(|r| r.version == version) else {
        return Err(if version > newest {
            format!("live version {version} is ahead of history ({newest})")
        } else {
            format!("live version {version} has no record")
        });
    };
    if record.list != live.bytes() {
        return Err(format!("live version {version} differs from its record"));
    }
    let (_, record_key) = verify_record(record, pinned, retired)?;
    if record_key != signed_by {
        return Err(format!(
            "live version {version} is signed by a different key than its record"
        ));
    }
    Ok(if version == newest {
        Live::Current { version, signed_by }
    } else {
        Live::Behind { version, signed_by }
    })
}

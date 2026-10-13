//! The list format and its one strict validator, shared by the app, the CLI, CI and every test.

use std::collections::{BTreeMap, HashSet};

use serde::Deserialize;

use super::{ListError, LIST_MAX_BYTES, LIST_SCHEMA_REF, MAX_VERSION};
use crate::authorization::canonicalize_origin;

const MAX_ENTRIES: usize = 256;
const MAX_ORIGINS_PER_ENTRY: usize = 16;
const MAX_ORIGIN_BYTES: usize = 256;
const MAX_NAME_BYTES: usize = 64;
const MAX_DESCRIPTION_BYTES: usize = 200;
const MAX_CURATOR_BYTES: usize = 39;
/// Banned in every string field, so no value can open a tag or close the approval summary's code
/// spans and fences.
const MARKUP: [char; 3] = ['<', '>', '`'];

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct RawList {
    #[serde(rename = "$schema")]
    schema: Option<String>,
    schema_version: u64,
    version: u64,
    entries: Vec<RawEntry>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct RawEntry {
    origins: Vec<String>,
    display_name: String,
    description: Option<String>,
    curated_by: String,
    added_at: String,
}

/// A list that passed every rule. It keeps the exact bytes it came from, because a list's identity
/// is its bytes: two lists with one version but different bytes are an equivocation, never a no-op.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SiteList {
    version: u64,
    names: BTreeMap<String, String>,
    bytes: Vec<u8>,
}

impl SiteList {
    /// Parse bytes the caller already trusts (a compiled-in record, or a source file CI is about to
    /// sign). Bytes from anywhere else go through [`super::verify::verify_list`].
    pub fn parse_unsigned(bytes: &[u8]) -> Result<Self, ListError> {
        if bytes.len() > LIST_MAX_BYTES {
            return Err(ListError::TooLarge("list"));
        }
        let raw: RawList =
            serde_json::from_slice(bytes).map_err(|e| ListError::Parse(e.to_string()))?;
        let rule = |detail: String| Err(ListError::Rule(detail));
        if raw.schema.as_deref().is_some_and(|s| s != LIST_SCHEMA_REF) {
            return rule(format!("$schema must be {LIST_SCHEMA_REF}"));
        }
        if raw.schema_version != 1 {
            return rule(format!("schemaVersion {} is not 1", raw.schema_version));
        }
        if raw.version == 0 || raw.version > MAX_VERSION {
            return rule(format!(
                "version {} is outside 1..={MAX_VERSION}",
                raw.version
            ));
        }
        if raw.entries.len() > MAX_ENTRIES {
            return rule(format!("more than {MAX_ENTRIES} entries"));
        }
        let mut names = BTreeMap::new();
        for entry in raw.entries {
            check_entry(&entry).map_err(ListError::Rule)?;
            for origin in entry.origins {
                if names.contains_key(&origin) {
                    return rule(format!("origin {origin} is listed twice"));
                }
                names.insert(origin, entry.display_name.clone());
            }
        }
        Ok(Self {
            version: raw.version,
            names,
            bytes: bytes.to_vec(),
        })
    }

    pub fn version(&self) -> u64 {
        self.version
    }

    /// The exact bytes this list was parsed from.
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    /// The display name for `origin`, which may be in any form the popup receives.
    pub fn display_name(&self, origin: &str) -> Option<&str> {
        let canonical = canonicalize_origin(origin)?;
        self.names.get(&canonical).map(String::as_str)
    }

    /// Every listed origin with its display name, in origin order.
    pub fn names(&self) -> &BTreeMap<String, String> {
        &self.names
    }
}

fn check_entry(entry: &RawEntry) -> Result<(), String> {
    let name = &entry.display_name;
    if entry.origins.is_empty() || entry.origins.len() > MAX_ORIGINS_PER_ENTRY {
        return Err(format!(
            "{name:?} needs 1..={MAX_ORIGINS_PER_ENTRY} origins"
        ));
    }
    let mut seen = HashSet::new();
    for origin in &entry.origins {
        check_origin(origin)?;
        if !seen.insert(origin) {
            return Err(format!("origin {origin} is listed twice"));
        }
    }
    check_display_name(name)?;
    if let Some(description) = &entry.description {
        check_description(description).map_err(|why| format!("{name:?} description {why}"))?;
    }
    if !is_github_username(&entry.curated_by) {
        return Err(format!("{name:?} curatedBy is not a GitHub username"));
    }
    if !is_calendar_date(&entry.added_at) {
        return Err(format!("{name:?} addedAt is not a YYYY-MM-DD date"));
    }
    Ok(())
}

fn check_origin(origin: &str) -> Result<(), String> {
    // Raw ASCII first: `url` would punycode a Unicode host, so the canonical form alone is too late.
    if origin.len() > MAX_ORIGIN_BYTES || !origin.is_ascii() {
        return Err(format!(
            "origin {:?} must be ASCII and at most {MAX_ORIGIN_BYTES} bytes",
            origin.escape_debug().to_string()
        ));
    }
    // A domain may carry a backtick through `url`'s host parsing; the summary's code spans may not.
    if origin.contains(MARKUP) {
        return Err(format!("origin {origin} contains <, > or a backtick"));
    }
    if !(origin.starts_with("https://") || origin.starts_with("chrome-extension://")) {
        return Err(format!(
            "origin {origin} is neither https nor chrome-extension"
        ));
    }
    if canonicalize_origin(origin).as_deref() != Some(origin) {
        return Err(format!("origin {origin} is not in canonical form"));
    }
    Ok(())
}

fn check_display_name(name: &str) -> Result<(), String> {
    let printable = name.bytes().all(|b| (0x20..=0x7e).contains(&b));
    if name.is_empty() || name.len() > MAX_NAME_BYTES || !printable {
        return Err(format!(
            "displayName {:?} must be 1..={MAX_NAME_BYTES} printable ASCII characters",
            name.escape_debug().to_string()
        ));
    }
    if name.contains(MARKUP) {
        return Err(format!("displayName {name:?} contains <, > or a backtick"));
    }
    if name.starts_with(' ') || name.ends_with(' ') {
        return Err(format!(
            "displayName {name:?} has a leading or trailing space"
        ));
    }
    Ok(())
}

fn check_description(description: &str) -> Result<(), &'static str> {
    if description.len() > MAX_DESCRIPTION_BYTES {
        return Err("is over 200 bytes");
    }
    if description.contains(MARKUP) {
        return Err("contains <, > or a backtick");
    }
    if description
        .chars()
        .any(|c| c.is_control() || is_invisible(c))
    {
        return Err("contains a control, bidi or zero-width character");
    }
    Ok(())
}

/// Bidi controls and zero-width characters: they change how text reads without being visible.
fn is_invisible(c: char) -> bool {
    matches!(
        c,
        '\u{061C}'
            | '\u{200B}'..='\u{200F}'
            | '\u{202A}'..='\u{202E}'
            | '\u{2060}'..='\u{2064}'
            | '\u{2066}'..='\u{2069}'
            | '\u{FEFF}'
    )
}

/// GitHub's username grammar: 1–39 ASCII alphanumerics or single hyphens, not at either end.
fn is_github_username(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= MAX_CURATOR_BYTES
        && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
        && !name.starts_with('-')
        && !name.ends_with('-')
        && !name.contains("--")
}

fn is_calendar_date(date: &str) -> bool {
    let b = date.as_bytes();
    let shaped = b.len() == 10
        && b.iter().enumerate().all(|(i, c)| match i {
            4 | 7 => *c == b'-',
            _ => c.is_ascii_digit(),
        });
    if !shaped {
        return false;
    }
    let field = |range: std::ops::Range<usize>| date.get(range).and_then(|s| s.parse::<u16>().ok());
    let (Some(year), Some(month), Some(day)) = (field(0..4), field(5..7), field(8..10)) else {
        return false;
    };
    let Ok(month) = u8::try_from(month).map(time::Month::try_from) else {
        return false;
    };
    let (Ok(month), Ok(day)) = (month, u8::try_from(day)) else {
        return false;
    };
    time::Date::from_calendar_date(i32::from(year), month, day).is_ok()
}

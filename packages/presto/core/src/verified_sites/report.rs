//! What changed between two lists, as Markdown for CI summaries. Every curator-written value is an
//! inline code span, which no list value can close (backticks are banned in every field), so a name
//! like `![Approved](https://…)` shows as text. Lists rather than tables: a `|` in a name would split
//! a table cell even inside a code span.

use super::list::SiteList;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ListDiff {
    /// `(origin, name)` pairs only in the newer list.
    pub added: Vec<(String, String)>,
    /// `(origin, name)` pairs only in the older list.
    pub removed: Vec<(String, String)>,
    /// `(origin, old name, new name)` for origins in both.
    pub renamed: Vec<(String, String, String)>,
}

pub fn diff(old: &SiteList, new: &SiteList) -> ListDiff {
    let mut out = ListDiff::default();
    for (origin, name) in new.names() {
        match old.names().get(origin) {
            None => out.added.push((origin.clone(), name.clone())),
            Some(before) if before != name => {
                out.renamed
                    .push((origin.clone(), before.clone(), name.clone()));
            }
            Some(_) => {}
        }
    }
    for (origin, name) in old.names() {
        if !new.names().contains_key(origin) {
            out.removed.push((origin.clone(), name.clone()));
        }
    }
    out
}

/// A value as an inline code span. Validated list values never contain a backtick.
pub fn code(value: &str) -> String {
    format!("`{value}`")
}

impl ListDiff {
    pub fn is_empty(&self) -> bool {
        self.added.is_empty() && self.removed.is_empty() && self.renamed.is_empty()
    }

    pub fn to_markdown(&self) -> String {
        if self.is_empty() {
            return "No origin or name changes.\n".to_string();
        }
        let mut out = String::new();
        let mut section = |title: &str, lines: Vec<String>| {
            if !lines.is_empty() {
                out.push_str(&format!("**{title}**\n\n"));
                for line in lines {
                    out.push_str(&format!("- {line}\n"));
                }
                out.push('\n');
            }
        };
        section(
            "Added",
            self.added
                .iter()
                .map(|(o, n)| format!("{} as {}", code(o), code(n)))
                .collect(),
        );
        section(
            "Removed",
            self.removed
                .iter()
                .map(|(o, n)| format!("{} ({})", code(o), code(n)))
                .collect(),
        );
        section(
            "Renamed",
            self.renamed
                .iter()
                .map(|(o, a, b)| format!("{}: {} → {}", code(o), code(a), code(b)))
                .collect(),
        );
        out
    }
}

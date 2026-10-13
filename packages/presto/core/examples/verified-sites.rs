//! CI tool for the signed verified-sites list, built on the same `presto_core::verified_sites` code
//! the app runs, so nothing is published that the app would refuse.
//!
//!   verified-sites check --source <list> --history <dir> --pubkey <key.pub> --retired <dir>
//!       (--live <document> | --live-absent) [--publish] [--commit <sha>]
//!       [--outputs <file>] [--summary <file>]
//!   verified-sites live --history <dir> --pubkey <key.pub> --retired <dir> (--live <document> | --live-absent)
//!   verified-sites document <list> <signature>
//!   verified-sites verify --document <file> --pubkey <key.pub> [--expect-sha256 <hex>] [--expect-version <n>]
//!   verified-sites diff <old list> <new list>
//!   verified-sites newest <history dir> [--pubkey <key.pub>]
//!
//! `check` without `--publish` only reports (the PR gate's version rules live in the repository
//! test). With `--publish` it is `prepare`'s decision: it fails on a source that may not be signed
//! or a live list written outside the flow, and writes `version`, `sha256` and `sign` outputs.

use std::io::Write as _;
use std::path::Path;
use std::process::ExitCode;

use presto_core::verified_sites::history::{
    classify_live, plan_signing, read_records, sha256_hex, verify_record, Live, Record, SignedBy,
};
use presto_core::verified_sites::list::SiteList;
use presto_core::verified_sites::report::{code, diff};
use presto_core::verified_sites::verify::{
    document, document_parts, verify_document, verify_list, ListKey,
};

fn die(msg: String) -> ! {
    eprintln!("verified-sites: {msg}");
    std::process::exit(2);
}

fn read(path: &str) -> Vec<u8> {
    std::fs::read(path).unwrap_or_else(|e| die(format!("read {path}: {e}")))
}

/// Value of `--flag <value>`, if present.
fn optional(args: &[String], name: &str) -> Option<String> {
    let at = args.iter().position(|a| a == name)?;
    match args.get(at + 1) {
        Some(value) if !value.starts_with("--") => Some(value.clone()),
        _ => die(format!("{name} needs a value")),
    }
}

fn flag(args: &[String], name: &str) -> String {
    optional(args, name).unwrap_or_else(|| die(format!("missing required {name}")))
}

fn key(args: &[String]) -> ListKey {
    let path = flag(args, "--pubkey");
    let text =
        String::from_utf8(read(&path)).unwrap_or_else(|_| die(format!("{path} is not UTF-8")));
    ListKey::from_document(&text).unwrap_or_else(|e| die(format!("{path}: {e}")))
}

fn records(dir: &str) -> Vec<Record> {
    read_records(Path::new(dir)).unwrap_or_else(|e| die(e))
}

/// The live document named by `--live`, or none with `--live-absent`; exactly one is required.
fn live_document(args: &[String]) -> Option<Vec<u8>> {
    match (
        optional(args, "--live"),
        args.iter().any(|a| a == "--live-absent"),
    ) {
        (Some(path), false) => Some(read(&path)),
        (None, true) => None,
        _ => die("pass exactly one of --live <document> or --live-absent".into()),
    }
}

fn signed_by(by: &SignedBy) -> String {
    match by {
        SignedBy::Pinned => "pinned".into(),
        SignedBy::Retired(id) => format!("retired:{id}"),
    }
}

fn describe_live(live: &Live) -> String {
    match live {
        Live::Absent => "absent".into(),
        Live::Behind { version, .. } => format!("version {version} (behind history)"),
        Live::Current { version, .. } => format!("version {version}"),
    }
}

fn append(path: Option<String>, text: &str) {
    let Some(path) = path else {
        print!("{text}");
        return;
    };
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .unwrap_or_else(|e| die(format!("open {path}: {e}")));
    file.write_all(text.as_bytes())
        .unwrap_or_else(|e| die(format!("write {path}: {e}")));
}

fn check(args: &[String]) -> ExitCode {
    let source = read(&flag(args, "--source"));
    let history = records(&flag(args, "--history"));
    let pinned = key(args);
    let retired = flag(args, "--retired");
    let live = live_document(args);
    if args.iter().any(|a| a == "--publish") {
        return check_publish(args, &source, &history, &pinned, Path::new(&retired), live);
    }
    let list = SiteList::parse_unsigned(&source).unwrap_or_else(|e| die(format!("source: {e}")));
    let mut summary = format!("## Verified-sites list: version {}\n\n", list.version());
    let against = match classify_live(live.as_deref(), &history, &pinned, Path::new(&retired)) {
        Ok(state @ (Live::Behind { .. } | Live::Current { .. })) => {
            summary.push_str(&format!("Live: {}.\n\n", describe_live(&state)));
            // classify_live verified it, under whichever pinned or retired key its record names.
            let parts = live.as_deref().and_then(|d| document_parts(d).ok());
            parts.and_then(|(list, _)| SiteList::parse_unsigned(&list).ok())
        }
        Ok(Live::Absent) => {
            summary.push_str("Live: absent, or the fetch failed.\n\n");
            None
        }
        Err(e) => {
            summary.push_str(&format!(
                "> [!WARNING]\n> The live list does not check out: {e}\n\n"
            ));
            None
        }
    };
    let baseline = against.or_else(|| {
        history.last().and_then(|r| {
            verify_record(r, &pinned, Path::new(&retired))
                .ok()
                .map(|(l, _)| l)
        })
    });
    match baseline {
        Some(old) => {
            summary.push_str(&format!("Changes against version {}:\n\n", old.version()));
            summary.push_str(&diff(&old, &list).to_markdown());
        }
        None => summary.push_str("No live or recorded list to compare against.\n"),
    }
    append(optional(args, "--summary"), &summary);
    ExitCode::SUCCESS
}

fn check_publish(
    args: &[String],
    source: &[u8],
    history: &[Record],
    pinned: &ListKey,
    retired: &Path,
    live: Option<Vec<u8>>,
) -> ExitCode {
    let plan = plan_signing(source, history, pinned, retired).unwrap_or_else(|e| die(e));
    let live = classify_live(live.as_deref(), history, pinned, retired).unwrap_or_else(|e| die(e));
    let version = plan.source.version();
    let sha256 = sha256_hex(source);
    let commit = optional(args, "--commit").unwrap_or_else(|| "HEAD".into());
    let previous = plan
        .previous
        .as_ref()
        .map_or("none".to_string(), |(l, by)| {
            format!("{} ({})", l.version(), signed_by(by))
        });
    let mut summary = format!(
        "## Verified-sites list: version {version}\n\n\
         - Source commit: {}\n\
         - Version: {version}; newest record: {previous}; live: {}\n\
         - SHA-256 of the bytes to sign: {}\n  \
           reproduce with {} (macOS: `shasum -a 256`)\n\
         - Decision: {}\n\n",
        code(&commit),
        describe_live(&live),
        code(&sha256),
        code(&format!(
            "git show {commit}:packages/presto/verified-sites.json | sha256sum"
        )),
        if plan.sign {
            "sign this list"
        } else {
            "already signed as the newest record; nothing to sign"
        },
    );
    if live == Live::Absent {
        summary.push_str(if history.is_empty() {
            "> [!NOTE]\n> No live list yet: this is the first.\n\n"
        } else {
            "> [!WARNING]\n> The live list is absent; publishing the next record restores it.\n\n"
        });
    }
    match &plan.previous {
        Some((old, _)) => {
            summary.push_str(&format!("### Changes against record {}\n\n", old.version()));
            summary.push_str(&diff(old, &plan.source).to_markdown());
        }
        None => {
            summary.push_str("### Every entry (first signed list)\n\n");
            for (origin, name) in plan.source.names() {
                summary.push_str(&format!("- {} as {}\n", code(origin), code(name)));
            }
        }
    }
    append(optional(args, "--summary"), &summary);
    append(
        optional(args, "--outputs"),
        &format!("version={version}\nsha256={sha256}\nsign={}\n", plan.sign),
    );
    ExitCode::SUCCESS
}

fn live(args: &[String]) -> ExitCode {
    let history = records(&flag(args, "--history"));
    let pinned = key(args);
    let retired = flag(args, "--retired");
    let document = live_document(args);
    match classify_live(document.as_deref(), &history, &pinned, Path::new(&retired)) {
        Ok(Live::Absent) => println!("state=absent"),
        Ok(Live::Behind {
            version,
            signed_by: by,
        }) => {
            println!(
                "state=behind\nversion={version}\nsigned_by={}",
                signed_by(&by)
            );
        }
        Ok(Live::Current {
            version,
            signed_by: by,
        }) => {
            println!(
                "state=current\nversion={version}\nsigned_by={}",
                signed_by(&by)
            );
        }
        Err(e) => {
            eprintln!("verified-sites: {e}");
            return ExitCode::from(1);
        }
    }
    ExitCode::SUCCESS
}

fn document_cmd(args: &[String]) -> ExitCode {
    let (Some(list), Some(signature)) = (args.get(1), args.get(2)) else {
        die("usage: verified-sites document <list> <signature>".into());
    };
    let bytes = document(&read(list), &read(signature));
    std::io::stdout()
        .write_all(&bytes)
        .unwrap_or_else(|e| die(format!("write stdout: {e}")));
    ExitCode::SUCCESS
}

fn verify(args: &[String]) -> ExitCode {
    let path = flag(args, "--document");
    let pinned = key(args);
    let verified = match verify_document(&read(&path), &pinned) {
        Ok(verified) => verified,
        Err(e) => {
            eprintln!("verified-sites: {path}: {e}");
            return ExitCode::from(1);
        }
    };
    let (version, sha256) = (verified.list.version(), sha256_hex(verified.list.bytes()));
    let expected_sha = optional(args, "--expect-sha256");
    let expected_version = optional(args, "--expect-version");
    if expected_sha.is_some_and(|want| want != sha256) {
        eprintln!("verified-sites: list SHA-256 {sha256} is not the expected one");
        return ExitCode::from(1);
    }
    if expected_version.is_some_and(|want| want != version.to_string()) {
        eprintln!("verified-sites: version {version} is not the expected one");
        return ExitCode::from(1);
    }
    println!(
        "version={version}\nlist_sha256={sha256}\nkey_id={}",
        pinned.key_id_hex()
    );
    ExitCode::SUCCESS
}

fn diff_cmd(args: &[String]) -> ExitCode {
    let (Some(old), Some(new)) = (args.get(1), args.get(2)) else {
        die("usage: verified-sites diff <old list> <new list>".into());
    };
    let parse = |path: &str| {
        SiteList::parse_unsigned(&read(path)).unwrap_or_else(|e| die(format!("{path}: {e}")))
    };
    print!("{}", diff(&parse(old), &parse(new)).to_markdown());
    ExitCode::SUCCESS
}

fn newest(args: &[String]) -> ExitCode {
    let Some(dir) = args.get(1).filter(|a| !a.starts_with("--")) else {
        die("usage: verified-sites newest <history dir> [--pubkey <key.pub>]".into());
    };
    let history = records(dir);
    let Some(record) = history.last() else {
        println!("0");
        return ExitCode::SUCCESS;
    };
    if optional(args, "--pubkey").is_some() {
        // Publishing signs nothing, so the newest record must already be under the pinned key.
        let pinned = key(args);
        let verified = verify_list(&record.list, &record.signature, &pinned);
        if !verified.is_ok_and(|list| list.version() == record.version) {
            eprintln!(
                "verified-sites: record {} is not signed by the pinned key",
                record.version
            );
            return ExitCode::from(1);
        }
    }
    println!("{}", record.version);
    ExitCode::SUCCESS
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("check") => check(&args),
        Some("live") => live(&args),
        Some("document") => document_cmd(&args),
        Some("verify") => verify(&args),
        Some("diff") => diff_cmd(&args),
        Some("newest") => newest(&args),
        _ => {
            eprintln!("usage: verified-sites <check|live|document|verify|diff|newest> [args]");
            ExitCode::from(2)
        }
    }
}

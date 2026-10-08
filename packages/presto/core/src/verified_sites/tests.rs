//! Fixtures come from `scripts/verified-sites-fixtures.ts`, signed with the RFC 8032 test vectors:
//! `test1.pub` is the pinned key, `test2.pub` the wrong (or retired) one.

use std::path::{Path, PathBuf};

use super::history::{classify_live, plan_signing, read_records, Live, Record, SignedBy};
use super::list::SiteList;
use super::report::diff;
use super::verify::{document, judge, verify_document, verify_list, Judgement, ListKey};
use super::{ListError, MAX_VERSION};
use crate::authorization::canonicalize_origin;

fn fixture(name: &str) -> Vec<u8> {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/verified_sites");
    std::fs::read(dir.join(name)).unwrap_or_else(|e| panic!("fixture {name}: {e}"))
}

fn key(name: &str) -> ListKey {
    ListKey::from_document(&String::from_utf8(fixture(name)).unwrap()).unwrap()
}

fn verify_fixture(list: &str, signature: &str) -> Result<SiteList, ListError> {
    verify_list(&fixture(list), &fixture(signature), &key("test1.pub"))
}

fn signed(name: &str) -> Result<SiteList, ListError> {
    verify_fixture(&format!("{name}.json"), &format!("{name}.json.minisig"))
}

#[test]
fn signed_lists_verify_and_parse() {
    let four = signed("list-4").unwrap();
    assert_eq!(four.version(), 4);
    assert_eq!(four.display_name("https://beta.example.com"), Some("Beta"));
    assert_eq!(
        four.display_name("chrome-extension://ABCDEFGHIJKLMNOPABCDEFGHIJKLMNOP"),
        Some("Beta"),
        "lookups canonicalize what the popup passes"
    );
    assert_eq!(signed("list-5").unwrap().version(), 5);
    let six = signed("list-6").unwrap();
    assert_eq!(six.display_name("https://gamma.example.com"), None);
    assert_eq!(signed("list-5-equivocating").unwrap().version(), 5);
}

#[test]
fn each_bad_signature_fails_for_its_own_reason() {
    let cases = [
        (
            "list-5.json",
            "list-5.wrong-key.minisig",
            ListError::KeyMismatch,
        ),
        (
            "list-5.json",
            "list-5.bad-comment.minisig",
            ListError::Signature("unexpected trusted comment"),
        ),
        (
            "list-5.json",
            "list-5.legacy.minisig",
            ListError::Signature("legacy signature (not prehashed)"),
        ),
        (
            "list-5-tampered.json",
            "list-5.json.minisig",
            ListError::SignatureInvalid,
        ),
        (
            "oversized.json",
            "oversized.json.minisig",
            ListError::TooLarge("list"),
        ),
    ];
    for (list, signature, want) in cases {
        assert_eq!(
            verify_fixture(list, signature).unwrap_err(),
            want,
            "{signature}"
        );
    }
}

#[test]
fn validly_signed_lists_that_break_a_rule_are_refused() {
    assert!(
        matches!(signed("list-7-unknown-field"), Err(ListError::Parse(e)) if e.contains("comment"))
    );
    assert!(matches!(signed("not-json"), Err(ListError::Parse(_))));
    for (name, why) in [
        ("list-7-non-canonical", "canonical"),
        ("list-7-http", "neither https"),
        ("list-7-bidi-name", "printable ASCII"),
    ] {
        match signed(name) {
            Err(ListError::Rule(e)) => assert!(e.contains(why), "{name}: {e}"),
            other => panic!("{name}: {other:?}"),
        }
    }
}

#[test]
fn signature_files_have_one_exact_form() {
    let list = fixture("list-5.json");
    let good = String::from_utf8(fixture("list-5.json.minisig")).unwrap();
    let pinned = key("test1.pub");
    assert!(verify_list(&list, good.as_bytes(), &pinned).is_ok());
    let variants = [
        good.replace('\n', "\r\n"),
        good.trim_end().to_string(),
        format!("{good}extra line\n"),
        good.replacen("version 5", "version 6", 1),
    ];
    for variant in variants {
        assert!(
            verify_list(&list, variant.as_bytes(), &pinned).is_err(),
            "{variant:?}"
        );
    }
}

#[test]
fn public_keys_have_one_exact_form() {
    let pinned = key("test1.pub");
    let doc = String::from_utf8(fixture("test1.pub")).unwrap();
    assert!(doc.starts_with(&format!(
        "untrusted comment: presto verified-sites public key {}\n",
        pinned.key_id_hex()
    )));
    assert!(ListKey::from_document(&doc.replace('\n', "\r\n")).is_err());
    assert!(ListKey::from_document(doc.trim_end()).is_err());
    // A key ID that is not derived from the key: swap in test2's key bytes under test1's ID.
    let other = String::from_utf8(fixture("test2.pub")).unwrap();
    let mut raw = base64_decode(doc.lines().nth(1).unwrap());
    raw[10..].copy_from_slice(&base64_decode(other.lines().nth(1).unwrap())[10..]);
    let forged = format!("{}\n{}\n", doc.lines().next().unwrap(), base64_encode(&raw));
    assert_eq!(
        ListKey::from_document(&forged).unwrap_err(),
        ListError::PublicKey("key ID is not derived from the key")
    );
}

fn base64_decode(s: &str) -> Vec<u8> {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD.decode(s).unwrap()
}

fn base64_encode(b: &[u8]) -> String {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD.encode(b)
}

#[test]
fn judge_has_four_outcomes() {
    let four = signed("list-4").unwrap();
    let five = signed("list-5").unwrap();
    let other_five = signed("list-5-equivocating").unwrap();
    assert_eq!(judge(&four, &five), Judgement::Accept);
    assert_eq!(judge(&five, &five.clone()), Judgement::Unchanged);
    assert_eq!(judge(&five, &other_five), Judgement::Equivocation);
    assert_eq!(judge(&five, &four), Judgement::Older);
}

#[test]
fn the_envelope_matches_the_committed_fixture_and_verifies() {
    let envelope = fixture("envelope-4.json");
    assert_eq!(
        document(&fixture("list-4.json"), &fixture("list-4.json.minisig")),
        envelope,
        "Rust and the Bun feed must build the same bytes"
    );
    let verified = verify_document(&envelope, &key("test1.pub")).unwrap();
    assert_eq!(verified.list.version(), 4);
    assert_eq!(verified.signature, fixture("list-4.json.minisig"));
    assert_eq!(
        verify_document(&envelope, &key("test2.pub")).unwrap_err(),
        ListError::KeyMismatch
    );
}

#[test]
fn envelopes_are_capped_strict_and_canonical() {
    let pinned = key("test1.pub");
    let envelope = String::from_utf8(fixture("envelope-4.json")).unwrap();
    let refuse = |doc: &str, want: ListError| {
        assert_eq!(
            verify_document(doc.as_bytes(), &pinned).unwrap_err(),
            want,
            "{doc:.80}"
        );
    };
    refuse(&" ".repeat(96 * 1024 + 1), ListError::TooLarge("document"));
    refuse(
        &envelope.replacen("{", "{ ", 1),
        ListError::Envelope("not in canonical form"),
    );
    refuse(
        &envelope.replacen("\"list\":\"", "\"list\":\"!", 1),
        ListError::Envelope("list is not base64"),
    );
    // Non-zero trailing bits, which standard base64 refuses.
    refuse(
        r#"{"schema":"presto-verified-sites-envelope-v1","list":"QR==","signature":""}"#,
        ListError::Envelope("list is not base64"),
    );
    refuse(
        &envelope.replacen("envelope-v1", "envelope-v2", 1),
        ListError::Envelope("unknown schema"),
    );
    refuse(
        &envelope.replacen("}", ",\"extra\":1}", 1),
        ListError::Envelope("not an envelope"),
    );
    let long_list = format!(
        "{{\"schema\":\"presto-verified-sites-envelope-v1\",\"list\":\"{}\",\"signature\":\"\"}}",
        "A".repeat(87_388)
    );
    refuse(&long_list, ListError::TooLarge("list"));
    let long_sig = format!(
        "{{\"schema\":\"presto-verified-sites-envelope-v1\",\"list\":\"\",\"signature\":\"{}\"}}",
        "A".repeat(1_372)
    );
    refuse(&long_sig, ListError::TooLarge("signature"));
}

#[test]
fn canonicalize_origin_keeps_the_extension_origin_unchanged() {
    let nulo = "chrome-extension://jlmiaokmjoicmclelpiiocdhncddkdmc";
    assert_eq!(canonicalize_origin(nulo).as_deref(), Some(nulo));
}

/// One valid entry; each case below replaces one field and expects acceptance or a refusal.
fn list_with(version: &str, entry: &str, extra: &str) -> Vec<u8> {
    format!(
        r#"{{"$schema":"./verified-sites.schema.json","schemaVersion":1,"version":{version},"entries":[{entry}]{extra}}}"#
    )
    .into_bytes()
}

fn entry(field: &str, value: &str) -> String {
    let mut fields = vec![
        ("origins", r#"["https://a.example.com"]"#.to_string()),
        ("displayName", r#""Alpha""#.to_string()),
        ("description", r#""A site""#.to_string()),
        ("curatedBy", r#""alejoamiras""#.to_string()),
        ("addedAt", r#""2026-05-28""#.to_string()),
    ];
    for (name, v) in &mut fields {
        if *name == field {
            *v = value.to_string();
        }
    }
    let body: Vec<String> = fields
        .into_iter()
        .filter(|(_, v)| !v.is_empty())
        .map(|(k, v)| format!("\"{k}\":{v}"))
        .collect();
    format!("{{{}}}", body.join(","))
}

fn accepts(bytes: &[u8]) -> bool {
    SiteList::parse_unsigned(bytes).is_ok()
}

fn origins(n: usize) -> String {
    let all: Vec<String> = (0..n)
        .map(|i| format!("\"https://s{i}.example.com\""))
        .collect();
    format!("[{}]", all.join(","))
}

fn assert_entry_cases(cases: &[(&str, &str, bool)]) {
    for (field, value, ok) in cases {
        let bytes = list_with("1", &entry(field, value), "");
        assert_eq!(accepts(&bytes), *ok, "{field} = {value}");
    }
}

#[test]
fn each_origin_rule_accepts_and_refuses() {
    let both = r#"["https://a.example.com","chrome-extension://jlmiaokmjoicmclelpiiocdhncddkdmc"]"#;
    let long = format!("[\"https://{}.com\"]", "a".repeat(250));
    assert_entry_cases(&[
        ("origins", both, true),
        ("origins", "[]", false),
        ("origins", &origins(16), true),
        ("origins", &origins(17), false),
        (
            "origins",
            r#"["https://a.example.com","https://a.example.com"]"#,
            false,
        ),
        ("origins", r#"["http://a.example.com"]"#, false),
        ("origins", r#"["wss://a.example.com"]"#, false),
        (
            "origins",
            r#"["moz-extension://0bd1d1c2-3e4f-4a5b-8c6d-7e8f9a0b1c2d"]"#,
            false,
        ),
        ("origins", r#"["https://A.example.com"]"#, false),
        ("origins", r#"["https://a.example.com:443"]"#, false),
        ("origins", r#"["https://a.example.com/"]"#, false),
        ("origins", r#"["https://a.example.com:8443"]"#, true),
        ("origins", r#"["https://xn--nlo-zna.sh"]"#, true),
        ("origins", "[\"https://n\u{fc}lo.sh\"]", false),
        ("origins", r#"["https://a`b.example.com"]"#, false),
        ("origins", &long, false),
    ]);
}

#[test]
fn each_name_and_note_rule_accepts_and_refuses() {
    let name = |n: usize| format!("\"{}\"", "n".repeat(n));
    let note = |n: usize| format!("\"{}\"", "d".repeat(n));
    assert_entry_cases(&[
        ("displayName", r#""""#, false),
        ("displayName", &name(64), true),
        ("displayName", &name(65), false),
        (
            "displayName",
            r#""![Approved](https://example.invalid/a.png)""#,
            true,
        ),
        ("displayName", r#""a <b>""#, false),
        ("displayName", r#""a`b""#, false),
        ("displayName", r#"" Alpha""#, false),
        ("displayName", r#""Alpha ""#, false),
        ("displayName", "\"Caf\u{e9}\"", false),
        ("displayName", r#""Tab\tName""#, false),
        ("description", "", true),
        ("description", "\"Yacana \u{2014} miner\"", true),
        ("description", &note(200), true),
        ("description", &note(201), false),
        ("description", r#""a > b""#, false),
        ("description", "\"bidi \u{202E} here\"", false),
        ("description", "\"zero\u{200B}width\"", false),
        ("description", r#""new\nline""#, false),
        ("curatedBy", r#""a-b-c""#, true),
        ("curatedBy", r#""-ab""#, false),
        ("curatedBy", r#""a--b""#, false),
        ("curatedBy", &format!("\"{}\"", "u".repeat(40)), false),
        ("curatedBy", r#""a_b""#, false),
        ("addedAt", r#""2028-02-29""#, true),
        ("addedAt", r#""2026-02-29""#, false),
        ("addedAt", r#""2026-13-01""#, false),
        ("addedAt", r#""2026-5-28""#, false),
        ("addedAt", r#""yesterday""#, false),
    ]);
}

#[test]
fn each_list_rule_accepts_and_refuses() {
    let one = entry("", "");
    let cases: Vec<(Vec<u8>, bool)> = vec![
        (list_with("1", &one, ""), true),
        (list_with(&MAX_VERSION.to_string(), &one, ""), true),
        (list_with(&(MAX_VERSION + 1).to_string(), &one, ""), false),
        (list_with("0", &one, ""), false),
        (list_with("-1", &one, ""), false),
        (list_with("1.0", &one, ""), false),
        (list_with("\"1\"", &one, ""), false),
        (list_with("1", &one, r#","extra":true"#), false),
        (
            list_with("1", &one.replacen('}', r#","extra":true}"#, 1), ""),
            false,
        ),
        (
            br#"{"schemaVersion":1,"version":1,"entries":[]}"#.to_vec(),
            true,
        ),
        (
            br#"{"$schema":"x.json","schemaVersion":1,"version":1,"entries":[]}"#.to_vec(),
            false,
        ),
        (
            br#"{"schemaVersion":2,"version":1,"entries":[]}"#.to_vec(),
            false,
        ),
        (br#"{"schemaVersion":1,"entries":[]}"#.to_vec(), false),
        (
            br#"{"schemaVersion":1,"version":1,"version":2,"entries":[]}"#.to_vec(),
            false,
        ),
        (
            list_with("1", &format!("{one},{}", one.replace("Alpha", "Other")), ""),
            false,
        ),
        (
            list_with(
                "1",
                &(0..257)
                    .map(|i| entry("origins", &format!("[\"https://s{i}.example.com\"]")))
                    .collect::<Vec<_>>()
                    .join(","),
                "",
            ),
            false,
        ),
        (
            list_with(
                "1",
                &(0..256)
                    .map(|i| entry("origins", &format!("[\"https://s{i}.example.com\"]")))
                    .collect::<Vec<_>>()
                    .join(","),
                "",
            ),
            true,
        ),
    ];
    for (bytes, ok) in cases {
        assert_eq!(
            accepts(&bytes),
            ok,
            "{}",
            String::from_utf8_lossy(&bytes).get(..120).unwrap_or("")
        );
    }
}

#[test]
fn diff_names_added_removed_and_renamed_origins() {
    let four = signed("list-4").unwrap();
    let five = signed("list-5").unwrap();
    let six = signed("list-6").unwrap();
    let up = diff(&four, &five);
    assert_eq!(up.added.len(), 1);
    assert_eq!(up.renamed.len(), 2, "both Beta origins were renamed");
    assert!(up.removed.is_empty());
    let markdown = up.to_markdown();
    assert!(markdown
        .contains("`https://delta.example.com` as `![Approved](https://example.invalid/a.png)`"));
    assert!(markdown.contains("`https://beta.example.com`: `Beta` → `Beta Wallet`"));
    let down = diff(&five, &six);
    assert_eq!(
        down.removed,
        vec![("https://gamma.example.com".to_string(), "Gamma".to_string())]
    );
    assert_eq!(
        diff(&five, &five).to_markdown(),
        "No origin or name changes.\n"
    );
}

// History and the CI decisions, over a temporary repository layout.

struct Repo {
    dir: tempfile::TempDir,
}

impl Repo {
    fn new() -> Self {
        let repo = Self {
            dir: tempfile::tempdir().unwrap(),
        };
        std::fs::create_dir_all(repo.history()).unwrap();
        std::fs::create_dir_all(repo.retired()).unwrap();
        repo
    }
    fn history(&self) -> PathBuf {
        self.dir.path().join("history")
    }
    fn retired(&self) -> PathBuf {
        self.dir.path().join("retired-keys")
    }
    fn record(&self, version: u64, list: &str, signature: &str) {
        std::fs::write(
            self.history().join(format!("{version}.json")),
            fixture(list),
        )
        .unwrap();
        std::fs::write(
            self.history().join(format!("{version}.json.minisig")),
            fixture(signature),
        )
        .unwrap();
    }
    fn retire_test2(&self) {
        let test2 = key("test2.pub");
        std::fs::write(
            self.retired().join(format!("{}.pub", test2.key_id_hex())),
            fixture("test2.pub"),
        )
        .unwrap();
    }
    fn records(&self) -> Vec<Record> {
        read_records(&self.history()).unwrap()
    }
}

#[test]
fn history_file_names_pairs_and_line_endings_are_strict() {
    let repo = Repo::new();
    assert!(read_records(&repo.dir.path().join("absent"))
        .unwrap()
        .is_empty());
    repo.record(4, "list-4.json", "list-4.json.minisig");
    repo.record(5, "list-5.json", "list-5.json.minisig");
    assert_eq!(
        repo.records().iter().map(|r| r.version).collect::<Vec<_>>(),
        [4, 5]
    );
    for stray in ["04.json", "0.json", "a.json", "5.json.sig", "README.md"] {
        let path = repo.history().join(stray);
        std::fs::write(&path, "x").unwrap();
        assert!(read_records(&repo.history()).is_err(), "{stray}");
        std::fs::remove_file(path).unwrap();
    }
    std::fs::remove_file(repo.history().join("5.json.minisig")).unwrap();
    assert!(
        read_records(&repo.history()).is_err(),
        "a list without its signature"
    );
    let crlf = String::from_utf8(fixture("list-5.json.minisig"))
        .unwrap()
        .replace('\n', "\r\n");
    std::fs::write(repo.history().join("5.json.minisig"), crlf).unwrap();
    assert!(read_records(&repo.history())
        .unwrap_err()
        .contains("carriage return"));
}

#[test]
fn signing_plan_follows_the_version_rules() {
    let pinned = key("test1.pub");
    let repo = Repo::new();
    let plan =
        |source: &str| plan_signing(&fixture(source), &repo.records(), &pinned, &repo.retired());

    let first = plan("list-4.json").unwrap();
    assert!(
        first.sign && first.previous.is_none(),
        "empty history signs the first list"
    );

    repo.record(5, "list-5.json", "list-5.json.minisig");
    assert!(
        !plan("list-5.json").unwrap().sign,
        "the newest record's bytes are already signed"
    );
    assert!(plan("list-6.json").unwrap().sign);
    assert!(plan("list-4.json").unwrap_err().contains("must be above"));
    assert!(plan("list-5-equivocating.json")
        .unwrap_err()
        .contains("must be above"));
    let far = String::from_utf8(fixture("list-6.json"))
        .unwrap()
        .replace("\"version\": 6", "\"version\": 106");
    let far_path = repo.dir.path().join("far.json");
    std::fs::write(&far_path, far).unwrap();
    let step = plan_signing(
        &std::fs::read(&far_path).unwrap(),
        &repo.records(),
        &pinned,
        &repo.retired(),
    );
    assert!(step.unwrap_err().contains("more than 100"));
}

#[test]
fn a_record_under_a_retired_key_needs_a_new_version() {
    let pinned = key("test1.pub");
    let repo = Repo::new();
    repo.record(5, "list-5.json", "list-5.wrong-key.minisig");
    let plan =
        |source: &str| plan_signing(&fixture(source), &repo.records(), &pinned, &repo.retired());
    assert!(plan("list-5.json")
        .unwrap_err()
        .contains("neither pinned nor retired"));
    repo.retire_test2();
    assert!(plan("list-5.json").unwrap_err().contains("retired key"));
    let next = plan("list-6.json").unwrap();
    assert!(next.sign);
    assert!(matches!(next.previous, Some((_, SignedBy::Retired(_)))));
}

#[test]
fn live_documents_are_checked_against_their_record() {
    let pinned = key("test1.pub");
    let repo = Repo::new();
    repo.record(4, "list-4.json", "list-4.json.minisig");
    repo.record(5, "list-5.json", "list-5.json.minisig");
    let live = |doc: Option<Vec<u8>>| {
        classify_live(doc.as_deref(), &repo.records(), &pinned, &repo.retired())
    };
    let doc = |name: &str| {
        Some(document(
            &fixture(&format!("{name}.json")),
            &fixture(&format!("{name}.json.minisig")),
        ))
    };

    assert_eq!(live(None).unwrap(), Live::Absent);
    assert_eq!(
        live(doc("list-5")).unwrap(),
        Live::Current {
            version: 5,
            signed_by: SignedBy::Pinned
        }
    );
    assert_eq!(
        live(doc("list-4")).unwrap(),
        Live::Behind {
            version: 4,
            signed_by: SignedBy::Pinned
        }
    );
    assert!(live(doc("list-6"))
        .unwrap_err()
        .contains("ahead of history"));
    assert!(live(doc("list-5-equivocating"))
        .unwrap_err()
        .contains("differs from its record"));
    let wrong_key = document(
        &fixture("list-5.json"),
        &fixture("list-5.wrong-key.minisig"),
    );
    assert!(live(Some(wrong_key.clone()))
        .unwrap_err()
        .contains("neither pinned nor retired"));
    repo.retire_test2();
    assert!(live(Some(wrong_key))
        .unwrap_err()
        .contains("different key than its record"));
    assert!(live(Some(b"{}".to_vec())).is_err());
}

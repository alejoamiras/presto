//! The PR gate for the verified-sites list and its signed history: every rule the signing flow and
//! the app's built-in copy rely on, checked on a `packages/presto` layout. Records are written only
//! by the release bot, so this is what keeps a hand-edited or forged one out of `main`.

use std::path::{Path, PathBuf};

use presto_core::verified_sites::history::{
    plan_signing, read_records, verify_record, MAX_VERSION_STEP,
};
use presto_core::verified_sites::verify::ListKey;

fn read_text(path: &Path) -> Result<String, String> {
    let text =
        std::fs::read_to_string(path).map_err(|e| format!("read {}: {e}", path.display()))?;
    if text.contains('\r') {
        return Err(format!("{} contains a carriage return", path.display()));
    }
    Ok(text)
}

/// Every retired key is `<KEYID>.pub` holding that key, so a record names its key unambiguously.
fn check_retired(dir: &Path) -> Result<(), String> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Ok(());
    };
    for entry in entries {
        let path = entry.map_err(|e| e.to_string())?.path();
        let key = ListKey::from_document(&read_text(&path)?)
            .map_err(|e| format!("{}: {e}", path.display()))?;
        let expected = format!("{}.pub", key.key_id_hex());
        if path.file_name().and_then(|n| n.to_str()) != Some(expected.as_str()) {
            return Err(format!("{} must be named {expected}", path.display()));
        }
    }
    Ok(())
}

/// The list may be signed next (or is the newest record), and every record verifies, carries its
/// own version and is at most [`MAX_VERSION_STEP`] above the one before it (the first, above 0).
fn check(presto: &Path) -> Result<(), String> {
    let dir = presto.join("verified-sites");
    let pinned = ListKey::from_document(&read_text(&dir.join("key.pub"))?)
        .map_err(|e| format!("key.pub: {e}"))?;
    let retired = dir.join("retired-keys");
    check_retired(&retired)?;
    let records = read_records(&dir.join("history"))?;
    let mut previous = 0;
    for record in &records {
        verify_record(record, &pinned, &retired)?;
        if record.version.saturating_sub(previous) > MAX_VERSION_STEP {
            let before = match previous {
                0 => "0".to_string(),
                n => format!("record {n}"),
            };
            return Err(format!(
                "record {} is more than {MAX_VERSION_STEP} above {before}",
                record.version
            ));
        }
        previous = record.version;
    }
    let source = std::fs::read(presto.join("verified-sites.json"))
        .map_err(|e| format!("read verified-sites.json: {e}"))?;
    plan_signing(&source, &records, &pinned, &retired).map(|_| ())
}

/// The 32-byte Ed25519 key inside a minisign public key document.
fn raw_key(document: &str) -> Vec<u8> {
    use base64::Engine as _;
    let line = document.lines().nth(1).unwrap_or_default();
    let blob = base64::engine::general_purpose::STANDARD
        .decode(line)
        .unwrap();
    blob.get(10..).unwrap().to_vec()
}

fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/verified_sites")
}

fn fixture(name: &str) -> Vec<u8> {
    std::fs::read(fixtures().join(name)).unwrap()
}

/// A `packages/presto` layout: `records` maps `history/` file names to fixture files.
struct Tree {
    dir: tempfile::TempDir,
}

impl Tree {
    fn new(source: &str, records: &[(&str, &str)]) -> Self {
        let tree = Self {
            dir: tempfile::tempdir().unwrap(),
        };
        tree.write("verified-sites/key.pub", &fixture("test1.pub"));
        tree.write("verified-sites.json", &fixture(source));
        for (name, from) in records {
            tree.write(&format!("verified-sites/history/{name}"), &fixture(from));
        }
        tree
    }

    fn write(&self, relative: &str, bytes: &[u8]) {
        let path = self.dir.path().join(relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, bytes).unwrap();
    }

    fn check(&self) -> Result<(), String> {
        check(self.dir.path())
    }
}

fn record(version: u64, list: &str) -> [(String, String); 2] {
    [
        (format!("{version}.json"), format!("{list}.json")),
        (
            format!("{version}.json.minisig"),
            format!("{list}.json.minisig"),
        ),
    ]
}

fn tree(source: &str, records: &[(u64, &str)]) -> Tree {
    let files: Vec<(String, String)> = records
        .iter()
        .flat_map(|(version, list)| record(*version, list))
        .collect();
    let refs: Vec<(&str, &str)> = files
        .iter()
        .map(|(a, b)| (a.as_str(), b.as_str()))
        .collect();
    Tree::new(source, &refs)
}

#[test]
fn history_and_source_pass_when_every_rule_holds() {
    tree("list-6.json", &[(4, "list-4"), (5, "list-5")])
        .check()
        .unwrap();
    // The source may equal the newest record: nothing to sign.
    tree("list-5.json", &[(4, "list-4"), (5, "list-5")])
        .check()
        .unwrap();
    // A record exactly 100 above the one before it.
    tree("list-105.json", &[(5, "list-5"), (105, "list-105")])
        .check()
        .unwrap();
    // No history yet: the first list only has to parse.
    tree("list-4.json", &[]).check().unwrap();
}

#[test]
fn each_history_rule_refuses_its_violation() {
    let cases: [(Tree, &str); 8] = [
        (
            tree("list-105.json", &[(4, "list-4"), (105, "list-105")]),
            "more than 100 above record 4",
        ),
        (
            tree("list-6.json", &[(6, "list-5")]),
            "record 6 holds version 5",
        ),
        (
            tree("list-4.json", &[(4, "list-4"), (5, "list-5")]),
            "must be above the newest record",
        ),
        (
            tree("list-105.json", &[(4, "list-4")]),
            "more than 100 above the newest record",
        ),
        (tree("list-105.json", &[]), "more than 100 above 0"),
        (
            tree("list-105.json", &[(105, "list-105")]),
            "record 105 is more than 100 above 0",
        ),
        (
            Tree::new(
                "list-6.json",
                &[
                    ("5.json", "list-5.json"),
                    ("5.json.minisig", "list-5.wrong-key.minisig"),
                ],
            ),
            "neither pinned nor retired",
        ),
        (
            Tree::new("list-6.json", &[("05.json", "list-5.json")]),
            "unexpected file in history: 05.json",
        ),
    ];
    for (tree, why) in cases {
        let error = tree.check().unwrap_err();
        assert!(error.contains(why), "{why:?} not in {error:?}");
    }
}

#[test]
fn carriage_returns_and_misnamed_retired_keys_are_refused() {
    let crlf = |bytes: Vec<u8>| String::from_utf8(bytes).unwrap().replace('\n', "\r\n");
    let record = tree("list-6.json", &[(5, "list-5")]);
    record.write(
        "verified-sites/history/5.json",
        crlf(fixture("list-5.json")).as_bytes(),
    );
    assert!(record.check().unwrap_err().contains("carriage return"));

    let key = tree("list-6.json", &[(5, "list-5")]);
    key.write(
        "verified-sites/key.pub",
        crlf(fixture("test1.pub")).as_bytes(),
    );
    assert!(key.check().unwrap_err().contains("carriage return"));

    // A record under a retired key verifies only through `retired-keys/<its KEYID>.pub`.
    let other = ListKey::from_document(&String::from_utf8(fixture("test2.pub")).unwrap()).unwrap();
    let rotated = Tree::new(
        "list-6.json",
        &[
            ("5.json", "list-5.json"),
            ("5.json.minisig", "list-5.wrong-key.minisig"),
        ],
    );
    rotated.write(
        "verified-sites/retired-keys/0000000000000000.pub",
        &fixture("test2.pub"),
    );
    assert!(rotated.check().unwrap_err().contains("must be named"));
    std::fs::remove_file(
        rotated
            .dir
            .path()
            .join("verified-sites/retired-keys/0000000000000000.pub"),
    )
    .unwrap();
    let name = format!("verified-sites/retired-keys/{}.pub", other.key_id_hex());
    rotated.write(&name, &fixture("test2.pub"));
    rotated.check().unwrap();
}

#[test]
fn the_repository_list_and_history_hold_every_rule() {
    check(&Path::new(env!("CARGO_MANIFEST_DIR")).join("..")).unwrap();
}

#[test]
fn the_pinned_key_is_neither_a_test_vector_nor_the_updater_key() {
    use base64::Engine as _;
    let presto = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    let pinned = raw_key(&read_text(&presto.join("verified-sites/key.pub")).unwrap());
    assert_eq!(pinned.len(), 32);
    for vector in [
        "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
        "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c",
    ] {
        assert_ne!(
            hex::encode(&pinned),
            vector,
            "key.pub is an RFC 8032 test vector"
        );
    }
    let config: serde_json::Value =
        serde_json::from_slice(&std::fs::read(presto.join("src-tauri/tauri.conf.json")).unwrap())
            .unwrap();
    let updater = base64::engine::general_purpose::STANDARD
        .decode(config["plugins"]["updater"]["pubkey"].as_str().unwrap())
        .unwrap();
    let updater = raw_key(std::str::from_utf8(&updater).unwrap());
    assert_eq!(updater.len(), 32);
    assert_ne!(pinned, updater, "key.pub is the updater key");
}

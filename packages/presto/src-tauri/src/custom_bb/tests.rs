#![allow(clippy::unwrap_used, clippy::panic)]

use super::*;
use crate::commands::save_developer_mode;
use crate::config::load_with_cap_from;

const SHA: &str = "9f2c1a7e4b0d83c6e5a1f7d2b9c40e88a3d61f5c07b2e9a4d8c1f36b5e70a29d";

fn version(raw: &str) -> AztecVersion {
    core_bb::check_label(raw).unwrap()
}

fn pin(label: &str) -> CustomBbPin {
    CustomBbPin {
        path: std::env::temp_dir().join("bb"),
        sha256: SHA.to_string(),
        label: version(label),
        pinned_at: 1,
    }
}

fn candidate(tested: bool) -> Candidate {
    Candidate {
        inspection: Inspection {
            path: std::env::temp_dir().join("bb"),
            sha256: SHA.to_string(),
            size: 8,
            warnings: Vec::new(),
        },
        tested,
    }
}

fn request(sha256: &str, label: &str) -> SaveRequest {
    SaveRequest {
        sha256: sha256.to_string(),
        label: label.to_string(),
    }
}

fn no_rehash(_: &CustomBbPin) -> Result<PathBuf, Unavailable> {
    panic!("a refused save must not touch the file")
}

/// T8: each precondition refuses on its own, before any I/O; the fresh rehash comes last.
#[test]
fn a_save_needs_every_precondition_and_rehashes_last() {
    let tested = candidate(true);
    let good = request(SHA, "6.0.0-dev.1");
    let check = |c: Option<&Candidate>, r: &SaveRequest, on: bool, overridden: bool| {
        check_save(c, r, on, overridden, no_rehash, 7)
    };
    let refused = [
        (
            "developer mode off",
            check(Some(&tested), &good, false, false),
        ),
        ("overridden", check(Some(&tested), &good, true, true)),
        ("no candidate", check(None, &good, true, false)),
        (
            "other bytes",
            check(
                Some(&tested),
                &request(&"0".repeat(64), "6.0.0-dev.1"),
                true,
                false,
            ),
        ),
        (
            "not tested",
            check(Some(&candidate(false)), &good, true, false),
        ),
        (
            "build metadata",
            check(Some(&tested), &request(SHA, "6.0.0+local"), true, false),
        ),
        (
            "hyphenated prerelease",
            check(Some(&tested), &request(SHA, "6.0.0-dev-1"), true, false),
        ),
    ];
    for (case, outcome) in refused {
        assert!(outcome.is_err(), "{case}: {outcome:?}");
    }

    for (rehash, case) in [
        (Unavailable::Changed, "changed"),
        (Unavailable::Missing, "missing"),
    ] {
        let outcome = check_save(Some(&tested), &good, true, false, |_| Err(rehash), 7);
        assert!(outcome.is_err(), "{case}");
    }

    let saved = check_save(Some(&tested), &good, true, false, |p| Ok(p.path.clone()), 7).unwrap();
    assert_eq!(
        saved,
        CustomBbPin {
            pinned_at: 7,
            ..pin("6.0.0-dev.1")
        }
    );
}

/// The popup names the label only while the request's first version is the one the custom bb
/// answers now.
#[test]
fn the_popup_label_follows_the_first_version_and_the_effective_pin() {
    let pinned = pin("6.0.0-dev.1");
    let asked = version("6.0.0-dev.1");
    assert_eq!(
        popup_label(Some(&asked), Some(&pinned), false).as_deref(),
        Some("6.0.0-dev.1")
    );
    assert_eq!(
        popup_label(Some(&version("6.0.0-rc.6")), Some(&pinned), false),
        None
    );
    assert_eq!(popup_label(None, Some(&pinned), false), None);
    assert_eq!(
        popup_label(Some(&asked), Some(&pinned), true),
        None,
        "overridden"
    );

    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("config.json");
    let store = ConfigStore::new(load_with_cap_from(&path));
    try_mutate_config_at(&store, Some(&path), |cfg| {
        cfg.set_developer_mode(true);
        cfg.set_custom_bb(Some(pinned.clone()))
            .map_err(|e| e.to_string())
    })
    .unwrap();
    let effective = store.effective_custom_bb();
    assert!(popup_label(Some(&asked), effective.as_ref(), false).is_some());
    try_mutate_config_at(&store, Some(&path), |cfg| {
        cfg.set_custom_bb(None).map_err(|e| e.to_string())
    })
    .unwrap();
    assert_eq!(store.effective_custom_bb(), None, "stopped");

    try_mutate_config_at(&store, Some(&path), |cfg| {
        cfg.set_custom_bb(Some(pinned.clone()))
            .map_err(|e| e.to_string())
    })
    .unwrap();
    save_developer_mode(&store, Some(&path), false).unwrap();
    assert_eq!(store.effective_custom_bb(), None, "developer mode off");
    assert_eq!(
        status(&store, CustomBbActivity::default()).state,
        State::Off
    );
}

/// A pin reaches the config only while the slot still holds its tested candidate: developer mode
/// going off and on, or a new review, between the rehash and the write refuses it. A stop needs
/// nothing. Either write clears the slot.
#[test]
fn a_save_commits_only_the_candidate_still_under_review() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("config.json");
    let store = ConfigStore::new(load_with_cap_from(&path));
    save_developer_mode(&store, Some(&path), true).unwrap();
    let slot: CandidateState = parking_lot::Mutex::new(None);
    let pinned = pin("6.0.0-dev.1");

    *slot.lock() = None;
    assert_eq!(
        commit(&store, Some(&path), &slot, Some(pinned.clone())),
        Err(REVIEW_RESET.to_string()),
        "the slot was cleared"
    );
    *slot.lock() = Some(candidate(false));
    assert_eq!(
        commit(&store, Some(&path), &slot, Some(pinned.clone())),
        Err(REVIEW_RESET.to_string()),
        "a new review replaced it"
    );
    let mut other = candidate(true);
    other.inspection.sha256 = "ab".repeat(32);
    *slot.lock() = Some(other);
    assert_eq!(
        commit(&store, Some(&path), &slot, Some(pinned.clone())),
        Err(REVIEW_RESET.to_string()),
        "another file is under review"
    );
    assert_eq!(store.effective_custom_bb(), None, "nothing was written");

    *slot.lock() = Some(candidate(true));
    commit(&store, Some(&path), &slot, Some(pinned.clone())).unwrap();
    assert_eq!(store.effective_custom_bb(), Some(pinned));
    assert!(slot.lock().is_none(), "the write consumed the candidate");

    *slot.lock() = Some(candidate(false));
    commit(&store, Some(&path), &slot, None).unwrap();
    assert_eq!(store.effective_custom_bb(), None, "stopped");
    assert!(slot.lock().is_none());
}

#[test]
fn the_tray_names_the_label_in_use_and_otherwise_says_why_not() {
    assert_eq!(tray_summary(State::Off, None), TraySummary::default());
    let on = tray_summary(State::InUse, Some("6.0.0-dev.1"));
    assert_eq!(on.line.as_deref(), Some("Custom bb: 6.0.0-dev.1"));
    assert_eq!(on.tooltip_suffix, Some(" · custom bb on"));
    for state in [
        State::Changed,
        State::Missing,
        State::Unsafe,
        State::Overridden,
        State::Revoked,
    ] {
        let off = tray_summary(state, Some("6.0.0-dev.1"));
        assert!(off.line.is_some_and(|l| !l.contains("6.0.0")), "{state:?}");
        assert_eq!(
            off.tooltip_suffix,
            Some(" · custom bb not used"),
            "{state:?}"
        );
    }
}

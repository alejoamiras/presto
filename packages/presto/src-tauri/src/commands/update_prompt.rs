//! The update prompt's answers, kept apart from the command so each outcome is testable with a
//! real slot, gate and schedule file.
#![deny(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::arithmetic_side_effects
)]

use std::sync::Arc;

use presto_core::update_schedule::{InstallClaim, InstallGate, ScheduleStore, Snooze};

use super::pending_update::{
    MatchOutcome, PendingUpdateSlot, PendingVersion, Reprompt, TakeOutcome,
};

/// The prompt's URL for `version`. Keeps the live window's scheme and path, which differ per
/// platform, and rewrites only the query.
pub fn prompt_url(mut url: tauri::Url, current: &str, version: &str) -> tauri::Url {
    url.set_query(Some(&format!(
        "current={}&version={}",
        urlencoding::encode(current),
        urlencoding::encode(version)
    )));
    url
}

/// The version an open prompt is showing.
pub fn prompt_version(url: &tauri::Url) -> Option<String> {
    url.query_pairs()
        .find(|(key, _)| key == "version")
        .map(|(_, value)| value.into_owned())
}

pub(crate) enum LaterOutcome {
    Snoozed(Snooze),
    Reprompt(Reprompt),
    Closed,
}

/// "Later" snoozes the displayed version only when it is the pending one Rust verified. A forged
/// or stale version re-points the prompt and writes nothing. A failed write is logged, and the
/// store's mirror still defers the version for this session. The pending item stays, so an open
/// prompt's "Update Now" still works.
pub(crate) fn handle_later<T: PendingVersion>(
    slot: &PendingUpdateSlot<T>,
    store: &ScheduleStore,
    displayed: &str,
    now: u64,
) -> LaterOutcome {
    match slot.match_displayed(displayed) {
        MatchOutcome::Matches => {
            // The pending version renders canonically, so a match always parses.
            let Ok(version) = semver::Version::parse(displayed) else {
                return LaterOutcome::Closed;
            };
            let snooze = Snooze::starting(version, now);
            if let Err(e) = store.record_snooze(snooze.clone()) {
                tracing::warn!(error = %e, "Could not persist the snooze; it holds for this session");
            }
            LaterOutcome::Snoozed(snooze)
        }
        MatchOutcome::Reprompt(cap) => LaterOutcome::Reprompt(cap),
        MatchOutcome::Empty => LaterOutcome::Closed,
    }
}

pub(crate) enum UpdateNowOutcome<T> {
    Busy,
    Install(InstallClaim, T),
    Reprompt(Reprompt),
    Empty,
}

/// Claims before taking, so a busy gate leaves the pending item in place. On a mismatch or an
/// empty slot the claim is dropped here, before the caller does any window work.
pub(crate) fn handle_update_now<T: PendingVersion>(
    gate: &Arc<InstallGate>,
    slot: &PendingUpdateSlot<T>,
    displayed: &str,
) -> UpdateNowOutcome<T> {
    let Some(claim) = gate.try_claim() else {
        return UpdateNowOutcome::Busy;
    };
    match slot.take_or_reprompt(displayed) {
        TakeOutcome::Took(item) => UpdateNowOutcome::Install(claim, item),
        TakeOutcome::Reprompt(cap) => UpdateNowOutcome::Reprompt(cap),
        TakeOutcome::Empty => UpdateNowOutcome::Empty,
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic)]
mod tests {
    use super::*;
    use presto_core::update_schedule::{self, CheckReason};

    use crate::updater::{decide, mode_and_reply, CheckMode, Decision, OutcomeKind};

    const NOW: u64 = 1_900_000_000;

    struct Dummy(&'static str);
    impl PendingVersion for Dummy {
        fn version_string(&self) -> String {
            self.0.to_string()
        }
    }

    fn slot_with(version: &'static str) -> PendingUpdateSlot<Dummy> {
        let slot = PendingUpdateSlot::default();
        slot.set(Dummy(version));
        slot
    }

    fn store_in(dir: &tempfile::TempDir) -> ScheduleStore {
        ScheduleStore::new(Some(dir.path().join("update-schedule.json")), "1.1.4")
    }

    fn v(s: &str) -> semver::Version {
        semver::Version::parse(s).unwrap()
    }

    #[test]
    fn h1_later_on_the_pending_version_snoozes_it_and_keeps_it_pending() {
        let dir = tempfile::tempdir().unwrap();
        let (slot, store) = (slot_with("1.2.0"), store_in(&dir));
        match handle_later(&slot, &store, "1.2.0", NOW) {
            LaterOutcome::Snoozed(s) => assert_eq!(s, Snooze::starting(v("1.2.0"), NOW)),
            _ => panic!("the pending version must snooze"),
        }
        let persisted = ScheduleStore::new(Some(dir.path().join("update-schedule.json")), "x");
        assert!(persisted.is_snoozed(&v("1.2.0"), NOW + 60));
        assert!(matches!(
            slot.take_or_reprompt("1.2.0"),
            TakeOutcome::Took(_)
        ));
    }

    /// Only the version Rust verified and the prompt shows can be snoozed.
    #[test]
    fn h2_later_on_another_version_reprompts_and_writes_nothing() {
        for displayed in ["9.9.9", "1.1.0", "1.2.0+build", "1.2.0-rc.1"] {
            let dir = tempfile::tempdir().unwrap();
            let (slot, store) = (slot_with("1.2.0"), store_in(&dir));
            match handle_later(&slot, &store, displayed, NOW) {
                LaterOutcome::Reprompt(cap) => assert_eq!(cap.version(), "1.2.0"),
                _ => panic!("{displayed} must re-point the prompt"),
            }
            assert!(
                !dir.path().join("update-schedule.json").exists(),
                "{displayed}"
            );
            assert!(!store.is_snoozed(&v("1.2.0"), NOW + 60), "{displayed}");
        }
    }

    #[test]
    fn h3_later_with_nothing_pending_closes() {
        let dir = tempfile::tempdir().unwrap();
        let slot = PendingUpdateSlot::<Dummy>::default();
        assert!(matches!(
            handle_later(&slot, &store_in(&dir), "1.2.0", NOW),
            LaterOutcome::Closed
        ));
        assert!(!dir.path().join("update-schedule.json").exists());
    }

    /// The parent of the schedule path is a regular file, so the write fails.
    #[test]
    fn h4_later_with_a_failing_write_still_defers_for_the_session() {
        let dir = tempfile::tempdir().unwrap();
        let blocker = dir.path().join("not-a-dir");
        std::fs::write(&blocker, b"").unwrap();
        let store = ScheduleStore::new(Some(blocker.join("update-schedule.json")), "1.1.4");
        let slot = slot_with("1.2.0");
        assert!(matches!(
            handle_later(&slot, &store, "1.2.0", NOW),
            LaterOutcome::Snoozed(_)
        ));
        assert!(store.is_snoozed(&v("1.2.0"), NOW + 60));
    }

    /// The snooze survives a restart, covers that version only, and the launch check honours it.
    #[test]
    fn h5_a_restart_keeps_the_snooze_for_that_version_only() {
        let dir = tempfile::tempdir().unwrap();
        let slot = slot_with("1.2.0");
        assert!(matches!(
            handle_later(&slot, &store_in(&dir), "1.2.0", NOW),
            LaterOutcome::Snoozed(_)
        ));
        let restarted = store_in(&dir);
        let (launch, _) = mode_and_reply::<()>(CheckReason::Launch);
        let later = NOW + update_schedule::CHECK_INTERVAL_SECS;
        for (version, want) in [
            ("1.2.0", Decision::SetOnly),
            ("1.3.0", Decision::SetAndPresent { focus: false }),
        ] {
            let snoozed = restarted.is_snoozed(&v(version), later);
            assert_eq!(
                decide(OutcomeKind::Available, None, launch, snoozed, false),
                want,
                "{version}"
            );
        }
        assert_eq!(launch, CheckMode::Launch);
    }

    #[test]
    fn f3_update_now_while_installing_leaves_the_pending_item() {
        let gate = Arc::new(InstallGate::default());
        let _running = gate.try_claim().unwrap();
        let slot = slot_with("1.2.0");
        assert!(matches!(
            handle_update_now(&gate, &slot, "1.2.0"),
            UpdateNowOutcome::Busy
        ));
        assert!(matches!(
            slot.take_or_reprompt("1.2.0"),
            TakeOutcome::Took(_)
        ));
    }

    #[test]
    fn f4_update_now_claims_only_when_it_installs() {
        let gate = Arc::new(InstallGate::default());
        let slot = slot_with("1.2.0");

        match handle_update_now(&gate, &slot, "1.1.0") {
            UpdateNowOutcome::Reprompt(cap) => assert_eq!(cap.version(), "1.2.0"),
            _ => panic!("a mismatch must re-point"),
        }
        assert!(!gate.is_busy(), "mismatch: the claim is released");

        match handle_update_now(&gate, &slot, "1.2.0") {
            UpdateNowOutcome::Install(claim, item) => {
                assert_eq!(item.0, "1.2.0");
                assert!(gate.is_busy(), "install: the gate stays claimed");
                drop(claim);
            }
            _ => panic!("a match must install"),
        }
        assert!(!gate.is_busy());

        assert!(matches!(
            handle_update_now(&gate, &slot, "1.2.0"),
            UpdateNowOutcome::Empty
        ));
        assert!(!gate.is_busy(), "empty: the claim is released");
    }

    /// One URL rewrite for re-pointing, on both platforms' asset origins.
    #[test]
    fn g5_repointing_keeps_the_origin_and_path_and_encodes_the_query() {
        for base in [
            "tauri://localhost/update-prompt.html?current=1.1.3&version=1.2.0",
            "http://tauri.localhost/update-prompt.html?current=1.1.3&version=1.2.0&x=1",
        ] {
            let live = tauri::Url::parse(base).unwrap();
            let url = prompt_url(live.clone(), "1.1.4", "2.0.0-rc.1+b&x=y");
            assert_eq!(
                (url.scheme(), url.host_str(), url.path()),
                (live.scheme(), live.host_str(), live.path())
            );
            assert_eq!(
                url.query(),
                Some("current=1.1.4&version=2.0.0-rc.1%2Bb%26x%3Dy")
            );
            assert_eq!(prompt_version(&url).as_deref(), Some("2.0.0-rc.1+b&x=y"));
        }
        let bare = tauri::Url::parse("tauri://localhost/update-prompt.html").unwrap();
        assert_eq!(prompt_version(&bare), None);
    }
}

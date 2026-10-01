//! What to do with a check's result. Pure, so every branch is reachable from `cargo test` without a
//! window or a feed.
#![deny(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::arithmetic_side_effects
)]

use std::thread::ThreadId;

use presto_core::update_schedule::CheckReason;

/// A check's result without its payload.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OutcomeKind {
    UpToDate,
    Available,
    Rejected,
    Failed,
    InstallInProgress,
}

impl OutcomeKind {
    /// Whether the feed answered. "Nothing new" and a refused candidate both count, so a replayed,
    /// validly signed but stale manifest buys at most one check interval of silence.
    pub fn reached_feed(self) -> bool {
        matches!(self, Self::UpToDate | Self::Available | Self::Rejected)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CheckMode {
    Launch,
    Scheduled,
    /// `live` while the tray still waits for the answer.
    Manual {
        live: bool,
    },
}

/// Splits a request into its mode and, for a tray request still waiting, its reply channel.
pub fn mode_and_reply<R>(reason: CheckReason<R>) -> (CheckMode, Option<R>) {
    match reason {
        CheckReason::Launch => (CheckMode::Launch, None),
        CheckReason::Scheduled => (CheckMode::Scheduled, None),
        CheckReason::Manual(Some(reply)) => (CheckMode::Manual { live: true }, Some(reply)),
        CheckReason::Manual(None) => (CheckMode::Manual { live: false }, None),
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Decision {
    /// Empty the pending slot: after a rollback, a withdrawn release can no longer be installed
    /// from a prompt left open.
    Clear,
    Unchanged,
    InProgress,
    /// Hold the update for an open prompt's "Update Now", but show nothing (snoozed).
    SetOnly,
    SetAndPresent {
        focus: bool,
    },
    ClearAndInstall,
}

/// Launch behaves exactly like Scheduled, so restarting never re-prompts a snoozed version. A
/// manual check always presents and never installs: the user asked to see the update, and a
/// request the tray gave up on keeps that provenance. A snooze also defers the automatic install.
pub fn decide(
    kind: OutcomeKind,
    pref: Option<bool>,
    mode: CheckMode,
    snoozed: bool,
    busy: bool,
) -> Decision {
    match kind {
        OutcomeKind::UpToDate | OutcomeKind::Rejected => Decision::Clear,
        OutcomeKind::Failed => Decision::Unchanged,
        OutcomeKind::InstallInProgress => Decision::InProgress,
        OutcomeKind::Available if busy => Decision::InProgress,
        OutcomeKind::Available => match mode {
            CheckMode::Manual { live } => Decision::SetAndPresent { focus: live },
            CheckMode::Launch | CheckMode::Scheduled if snoozed => Decision::SetOnly,
            CheckMode::Launch | CheckMode::Scheduled if pref == Some(true) => {
                Decision::ClearAndInstall
            }
            CheckMode::Launch | CheckMode::Scheduled => Decision::SetAndPresent { focus: false },
        },
    }
}

/// Re-checked just before the window call, because "Update Now" or "Later" may have landed since
/// [`decide`]. A manual check ignores the snooze, as in [`decide`].
pub fn should_present(mode: CheckMode, snoozed_now: bool, busy: bool) -> bool {
    !busy && (matches!(mode, CheckMode::Manual { .. }) || !snoozed_now)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PromptAction {
    Open,
    FocusOnly,
    Repoint,
    Nothing,
}

/// What to do with the prompt window. The version already on screen is never re-navigated: a
/// reload resets the prompt's click-steal guard.
pub fn prompt_action(open_version: Option<&str>, target: &str, focus: bool) -> PromptAction {
    match open_version {
        None => PromptAction::Open,
        Some(open) if open == target && focus => PromptAction::FocusOnly,
        Some(open) if open == target => PromptAction::Nothing,
        Some(_) => PromptAction::Repoint,
    }
}

/// Creating a window on the main thread deadlocks on Windows, so the presenter refuses to run
/// there. An unrecorded main thread cannot be compared, so it does not block.
pub fn presenter_allowed(current: ThreadId, main: Option<ThreadId>) -> bool {
    main != Some(current)
}

/// The update task's answer to a tray request.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ManualCheckResult {
    UpToDate,
    Presented,
    Failed,
    Installing,
}

/// How presenting a found update went.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Presentation {
    Shown,
    /// "Update Now" started an install meanwhile.
    SkippedBusy,
    /// "Later" snoozed the version meanwhile (never for a manual check).
    SkippedSnoozed,
    Failed,
}

impl Presentation {
    pub fn manual_result(self) -> ManualCheckResult {
        match self {
            Self::Shown | Self::SkippedSnoozed => ManualCheckResult::Presented,
            Self::SkippedBusy => ManualCheckResult::Installing,
            Self::Failed => ManualCheckResult::Failed,
        }
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic, clippy::indexing_slicing)]
mod tests {
    use super::*;

    const KINDS: [OutcomeKind; 5] = [
        OutcomeKind::UpToDate,
        OutcomeKind::Available,
        OutcomeKind::Rejected,
        OutcomeKind::Failed,
        OutcomeKind::InstallInProgress,
    ];
    const PREFS: [Option<bool>; 3] = [None, Some(false), Some(true)];
    const MODES: [CheckMode; 4] = [
        CheckMode::Launch,
        CheckMode::Scheduled,
        CheckMode::Manual { live: true },
        CheckMode::Manual { live: false },
    ];

    fn every_input() -> impl Iterator<Item = (OutcomeKind, Option<bool>, CheckMode, bool, bool)> {
        KINDS.into_iter().flat_map(|k| {
            PREFS.into_iter().flat_map(move |p| {
                MODES.into_iter().flat_map(move |m| {
                    [false, true]
                        .into_iter()
                        .flat_map(move |s| [false, true].into_iter().map(move |b| (k, p, m, s, b)))
                })
            })
        })
    }

    /// D3, D4: "nothing new" and a refused candidate count as a check; a failure does not.
    #[test]
    fn d3_d4_only_an_answer_from_the_feed_counts_as_a_check() {
        let reached: Vec<_> = KINDS.into_iter().filter(|k| k.reached_feed()).collect();
        assert_eq!(
            reached,
            [
                OutcomeKind::UpToDate,
                OutcomeKind::Available,
                OutcomeKind::Rejected
            ]
        );
    }

    /// E1–E10: the rows that matter.
    #[test]
    fn e_decide_rows() {
        use CheckMode::{Launch, Manual, Scheduled};
        use Decision::*;
        use OutcomeKind::*;
        #[rustfmt::skip]
        let rows = [
            // E1
            (UpToDate, Some(true), Scheduled, false, false, Clear),
            (Rejected, None, Manual { live: true }, false, false, Clear),
            // E2
            (Failed, Some(true), Launch, false, false, Unchanged),
            // E3: live manual, any pref, snoozed or not
            (Available, Some(true), Manual { live: true }, true, false, SetAndPresent { focus: true }),
            (Available, None, Manual { live: true }, false, false, SetAndPresent { focus: true }),
            // E4: expired manual never installs
            (Available, Some(true), Manual { live: false }, false, false, SetAndPresent { focus: false }),
            // E5
            (Available, Some(true), Scheduled, false, false, ClearAndInstall),
            (Available, Some(true), Launch, false, false, ClearAndInstall),
            // E6: the snooze also defers the automatic install
            (Available, Some(true), Scheduled, true, false, SetOnly),
            // E7
            (Available, None, Scheduled, false, false, SetAndPresent { focus: false }),
            (Available, Some(false), Launch, false, false, SetAndPresent { focus: false }),
            // E8
            (Available, Some(false), Scheduled, true, false, SetOnly),
            // E9: a restart does not re-prompt a snoozed version
            (Available, None, Launch, true, false, SetOnly),
            // E10
            (Available, Some(true), Scheduled, false, true, InProgress),
            (Available, None, Manual { live: true }, false, true, InProgress),
            (InstallInProgress, None, Manual { live: true }, false, false, InProgress),
        ];
        for (kind, pref, mode, snoozed, busy, want) in rows {
            assert_eq!(
                decide(kind, pref, mode, snoozed, busy),
                want,
                "{kind:?} {pref:?} {mode:?} snoozed={snoozed} busy={busy}"
            );
        }
    }

    /// E: invariants over all 240 inputs.
    #[test]
    fn e_decide_invariants() {
        use CheckMode::{Launch, Manual, Scheduled};
        use Decision::{ClearAndInstall, InProgress, SetOnly};
        use OutcomeKind::Available;
        for (kind, pref, mode, snoozed, busy) in every_input() {
            let got = decide(kind, pref, mode, snoozed, busy);
            let ctx = format!("{kind:?} {pref:?} {mode:?} snoozed={snoozed} busy={busy}");
            if matches!(mode, Manual { .. }) {
                assert_ne!(got, ClearAndInstall, "manual never installs: {ctx}");
                assert_ne!(got, SetOnly, "manual ignores the snooze: {ctx}");
            }
            if mode == Launch {
                assert_eq!(got, decide(kind, pref, Scheduled, snoozed, busy), "{ctx}");
            }
            if kind == Available && busy {
                assert_eq!(got, InProgress, "{ctx}");
            }
            if got == ClearAndInstall {
                assert_eq!(pref, Some(true), "{ctx}");
                assert!(!snoozed && !busy, "{ctx}");
            }
        }
    }

    /// G1–G3.
    #[test]
    fn g1_g3_presenting_rechecks_the_gate_and_the_snooze() {
        let manual = CheckMode::Manual { live: true };
        assert!(!should_present(manual, false, true), "G1");
        assert!(!should_present(CheckMode::Scheduled, false, true), "G1");
        assert!(!should_present(CheckMode::Scheduled, true, false), "G2");
        assert!(!should_present(CheckMode::Launch, true, false), "G2");
        assert!(should_present(manual, true, false), "G3");
        assert!(
            should_present(CheckMode::Manual { live: false }, true, false),
            "G3"
        );
        assert!(should_present(CheckMode::Scheduled, false, false));
    }

    /// G4.
    #[test]
    fn g4_the_version_on_screen_is_never_reloaded() {
        assert_eq!(prompt_action(None, "1.2.0", false), PromptAction::Open);
        assert_eq!(prompt_action(None, "1.2.0", true), PromptAction::Open);
        assert_eq!(
            prompt_action(Some("1.2.0"), "1.2.0", true),
            PromptAction::FocusOnly
        );
        assert_eq!(
            prompt_action(Some("1.2.0"), "1.2.0", false),
            PromptAction::Nothing
        );
        assert_eq!(
            prompt_action(Some("1.1.9"), "1.2.0", false),
            PromptAction::Repoint
        );
        assert_eq!(
            prompt_action(Some("1.2.0-rc.1"), "1.2.0", true),
            PromptAction::Repoint
        );
    }

    /// G6: a failed window call answers "Couldn't check", never "presented".
    #[test]
    fn g6_the_tray_hears_how_presenting_went() {
        assert_eq!(
            Presentation::Shown.manual_result(),
            ManualCheckResult::Presented
        );
        assert_eq!(
            Presentation::Failed.manual_result(),
            ManualCheckResult::Failed
        );
        assert_eq!(
            Presentation::SkippedBusy.manual_result(),
            ManualCheckResult::Installing
        );
    }

    /// G7.
    #[test]
    fn g7_the_presenter_refuses_the_main_thread() {
        let main = std::thread::current().id();
        let worker = std::thread::spawn(|| std::thread::current().id())
            .join()
            .unwrap();
        assert!(!presenter_allowed(main, Some(main)));
        assert!(presenter_allowed(worker, Some(main)));
        assert!(presenter_allowed(worker, None));
    }

    #[test]
    fn a_request_keeps_its_provenance_and_reply() {
        assert_eq!(
            mode_and_reply::<u8>(CheckReason::Launch),
            (CheckMode::Launch, None)
        );
        assert_eq!(
            mode_and_reply::<u8>(CheckReason::Scheduled),
            (CheckMode::Scheduled, None)
        );
        assert_eq!(
            mode_and_reply(CheckReason::Manual(Some(7u8))),
            (CheckMode::Manual { live: true }, Some(7))
        );
        assert_eq!(
            mode_and_reply::<u8>(CheckReason::Manual(None)),
            (CheckMode::Manual { live: false }, None)
        );
    }
}

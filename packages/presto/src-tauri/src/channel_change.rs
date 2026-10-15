//! What changing the update channel does beyond the save.
#![deny(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::arithmetic_side_effects
)]

use presto_core::config::{ChannelTransition, UpdateChannel};

use crate::update_menu::REPLY_TIMEOUT;
use crate::updater::{ManualCheckResult, ManualCheckSender};

pub trait ChannelEffects {
    /// The pending update and its prompt belong to the old channel.
    fn clear_pending(&self);
    fn close_prompt(&self);
    /// The update task's request queue.
    fn manual_checks(&self) -> Option<ManualCheckSender>;
}

/// Applies a saved change of the channel in effect. A failed save changes nothing else, and a save
/// that leaves the channel where it was does nothing more. Joining the candidate channel checks
/// once and returns that check's result; every other change returns `None`.
pub async fn apply(
    saved: Result<ChannelTransition, String>,
    effects: &impl ChannelEffects,
) -> Result<Option<ManualCheckResult>, String> {
    let transition = saved?;
    if !transition.changed() {
        return Ok(None);
    }
    effects.clear_pending();
    effects.close_prompt();
    tracing::info!(from = %transition.before, to = %transition.after, "Update channel changed");
    if transition.after != UpdateChannel::Rc {
        return Ok(None);
    }
    Ok(Some(join_check(effects.manual_checks()).await))
}

/// One manual request, like the tray's, except that a full queue waits instead of failing. The
/// tray's bound covers the enqueue and the reply. Holding the reply receiver keeps the request live,
/// and a live manual check presents what it finds and never installs it.
pub async fn join_check(checks: Option<ManualCheckSender>) -> ManualCheckResult {
    let Some(checks) = checks else {
        return ManualCheckResult::Failed;
    };
    let (reply, answer) = tokio::sync::oneshot::channel();
    let asked = async {
        checks.send(reply).await.ok()?;
        answer.await.ok()
    };
    tokio::time::timeout(REPLY_TIMEOUT, asked)
        .await
        .ok()
        .flatten()
        .unwrap_or(ManualCheckResult::Failed)
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic, clippy::indexing_slicing)]
mod tests {
    use super::*;
    use crate::commands::try_mutate_config_at;
    use crate::config::{load_with_cap_from, ConfigStore};
    use crate::updater::{mode_and_reply, CheckMode, ManualReply, MANUAL_QUEUE};
    use presto_core::update_schedule::CheckReason;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tokio::sync::{mpsc, oneshot};
    use UpdateChannel::{Rc, Stable};

    struct Recorded {
        cleared: AtomicUsize,
        closed: AtomicUsize,
        checks: ManualCheckSender,
    }

    impl Recorded {
        fn new() -> (Self, mpsc::Receiver<ManualReply>) {
            let (checks, requests) = mpsc::channel(MANUAL_QUEUE);
            let effects = Self {
                cleared: AtomicUsize::new(0),
                closed: AtomicUsize::new(0),
                checks,
            };
            (effects, requests)
        }

        fn counts(&self) -> (usize, usize) {
            (
                self.cleared.load(Ordering::SeqCst),
                self.closed.load(Ordering::SeqCst),
            )
        }
    }

    impl ChannelEffects for Recorded {
        fn clear_pending(&self) {
            self.cleared.fetch_add(1, Ordering::SeqCst);
        }

        fn close_prompt(&self) {
            self.closed.fetch_add(1, Ordering::SeqCst);
        }

        fn manual_checks(&self) -> Option<ManualCheckSender> {
            Some(self.checks.clone())
        }
    }

    fn moved(before: UpdateChannel, after: UpdateChannel) -> Result<ChannelTransition, String> {
        Ok(ChannelTransition { before, after })
    }

    /// Answers the first live request the way the update task does, skipping expired ones. Bounded,
    /// because the test holds a sender: a join that never enqueues would otherwise hang it.
    async fn answer_one(requests: &mut mpsc::Receiver<ManualReply>) -> CheckMode {
        loop {
            let reply = tokio::time::timeout(std::time::Duration::from_secs(5), requests.recv())
                .await
                .unwrap_or_else(|_| panic!("no live request within 5 s"))
                .unwrap();
            if reply.is_closed() {
                continue;
            }
            let (mode, reply) = mode_and_reply(CheckReason::Manual(Some(reply)));
            reply.unwrap().send(ManualCheckResult::Presented).unwrap();
            return mode;
        }
    }

    #[tokio::test]
    async fn join_sends_one_live_manual_check_and_returns_its_result() {
        let (effects, mut requests) = Recorded::new();
        for _ in 0..MANUAL_QUEUE {
            let (expired, _) = oneshot::channel();
            effects.checks.try_send(expired).unwrap();
        }
        let (joined, mode) = tokio::join!(apply(moved(Stable, Rc), &effects), async {
            let mode = answer_one(&mut requests).await;
            (mode, requests.try_recv().is_err())
        });
        assert_eq!(joined, Ok(Some(ManualCheckResult::Presented)));
        assert_eq!(
            mode,
            (CheckMode::Manual { live: true }, true),
            "one live request"
        );
        assert_eq!(effects.counts(), (1, 1));
    }

    /// The tray's bound covers a queue that never drains as well as a reply that never comes.
    #[tokio::test(start_paused = true)]
    async fn a_join_nobody_answers_fails_at_the_tray_bound() {
        let (effects, _requests) = Recorded::new();
        for _ in 0..MANUAL_QUEUE {
            let (expired, _) = oneshot::channel();
            effects.checks.try_send(expired).unwrap();
        }
        let start = tokio::time::Instant::now();
        assert_eq!(
            join_check(effects.manual_checks()).await,
            ManualCheckResult::Failed
        );
        assert_eq!(start.elapsed(), REPLY_TIMEOUT);

        let (closed, requests) = Recorded::new();
        drop(requests);
        assert_eq!(
            join_check(closed.manual_checks()).await,
            ManualCheckResult::Failed
        );
        assert_eq!(join_check(None).await, ManualCheckResult::Failed);
    }

    #[tokio::test]
    async fn channel_change_clears_pending_and_closes_prompt() {
        let (effects, mut requests) = Recorded::new();
        assert_eq!(apply(moved(Rc, Stable), &effects).await, Ok(None));
        assert_eq!(effects.counts(), (1, 1));
        assert!(requests.try_recv().is_err(), "leaving checks nothing");
    }

    #[tokio::test]
    async fn unchanged_channel_sends_no_check() {
        for channel in [Stable, Rc] {
            let (effects, mut requests) = Recorded::new();
            assert_eq!(apply(moved(channel, channel), &effects).await, Ok(None));
            assert_eq!(effects.counts(), (0, 0), "{channel}");
            assert!(requests.try_recv().is_err(), "{channel}");
        }
    }

    #[tokio::test]
    async fn failed_save_has_no_side_effects() {
        let dir = tempfile::tempdir().unwrap();
        let blocker = dir.path().join("file");
        std::fs::write(&blocker, "").unwrap();
        let path = blocker.join("config.json");
        let store = ConfigStore::new(load_with_cap_from(&path));
        let saved =
            try_mutate_config_at(&store, Some(&path), |cfg| Ok(cfg.set_developer_mode(true)));
        assert!(saved.is_err());
        assert!(!store.read().developer.enabled, "memory follows the disk");

        let (effects, mut requests) = Recorded::new();
        assert!(apply(saved, &effects).await.is_err());
        assert_eq!(effects.counts(), (0, 0));
        assert!(requests.try_recv().is_err());
    }

    #[tokio::test]
    async fn set_update_channel_refused_while_developer_off() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        let store = ConfigStore::new(load_with_cap_from(&path));
        let saved = try_mutate_config_at(&store, Some(&path), |cfg| {
            cfg.set_update_channel(Rc).map_err(|e| e.to_string())
        });
        assert_eq!(saved, Err("developer mode is off".to_string()));
        assert!(!path.exists(), "nothing saved");
        assert_eq!(store.effective_channel(), Stable);

        let (effects, mut requests) = Recorded::new();
        assert!(apply(saved, &effects).await.is_err());
        assert_eq!(effects.counts(), (0, 0));
        assert!(requests.try_recv().is_err());
    }
}

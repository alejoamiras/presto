//! The verified-sites registry behind the authorization popup's badge: the newest signed record when
//! this binary was built, replaced whole by any newer list signed under the pinned key, which the app
//! fetches on the update check's cadence. Replacing, never merging, is what lets a signed removal
//! take a badge away from a built-in entry.
//!
//! NOT a security boundary: authorization never reads it. A listed origin means the maintainers
//! recognize that origin string, not that the site is trustworthy now (a hijacked domain or
//! extension keeps its badge). See `packages/presto/VERIFIED_SITES.md` for the curation policy.

use std::convert::Infallible;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use parking_lot::RwLock;
use presto_core::update_schedule::{
    run_updates, CheckReason, Observation, ScheduleStore, LAUNCH_DELAY, WAKE_TICK,
};
use presto_core::verified_sites::fetch::{fetch_document, Feed};
use presto_core::verified_sites::list::SiteList;
use presto_core::verified_sites::store::{ListStore, SaveOutcome};
use presto_core::verified_sites::verify::{
    judge, verify_document, Judgement, ListKey, VerifiedDocument,
};
use tauri::{AppHandle, Manager as _};
use tokio::sync::{mpsc, oneshot};

/// The newest history record when this binary was built, chosen by `build.rs`. Trusted as compiled:
/// the PR gate verified its signature, and verifying it here would break every build at a rotation.
pub const BUILT_IN: &[u8] = include_bytes!(env!("PRESTO_VERIFIED_SITES_RECORD"));
/// The one key a fetched or cached list must be signed with.
pub const PUBLIC_KEY: &str = include_str!("../../verified-sites/key.pub");

/// What one list check did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refresh {
    /// No 200 within the size cap; the next wake-up retries.
    Unreachable,
    /// The answer failed its signature, envelope or list rules.
    Refused,
    /// Verified, but no newer than the list in use.
    Kept,
    /// Two different lists signed for one version. Nothing changes.
    Equivocation,
    /// Now in use. `persisted: false` means only memory holds it: the cache write failed.
    Swapped { persisted: bool },
}

impl Observation for Refresh {
    /// Any 200 within the cap counts, valid or not, as the updater counts a refused candidate.
    fn reached_feed(&self) -> bool {
        *self != Self::Unreachable
    }

    /// Never asked for: the list check is never busy.
    fn in_progress() -> Self {
        Self::Unreachable
    }
}

/// A request for an immediate check, answered with what it did.
pub type RefreshRequest = oneshot::Sender<Refresh>;

pub struct VerifiedSites {
    /// `None` only when the built-in record does not parse and no signed list has arrived.
    current: RwLock<Option<Arc<SiteList>>>,
    /// `None` only when the pinned key does not parse, which leaves the built-in for good.
    store: Option<ListStore>,
}

impl VerifiedSites {
    /// The built-in record and `~/.presto`'s cache.
    pub fn production() -> Self {
        Self::load(
            BUILT_IN,
            pinned_key().map(|key| ListStore::new(cache_path(), key)),
        )
    }

    /// The newer of `built_in` and the verified cache. No network and no lock, so it can run before
    /// the state is managed, and a removal holds from the first popup after a restart.
    pub fn load(built_in: &[u8], store: Option<ListStore>) -> Self {
        let built_in = SiteList::parse_unsigned(built_in)
            .inspect_err(|e| {
                tracing::error!(error = %e, "The built-in verified-sites list does not parse; no badges until a signed list arrives");
            })
            .ok();
        let cached = store.as_ref().and_then(|store| {
            store
                .load()
                .inspect_err(
                    |e| tracing::warn!(error = %e, "Ignoring the cached verified-sites list"),
                )
                .ok()
                .flatten()
        });
        let current = match (built_in, cached) {
            (Some(built_in), Some(cached)) => Some(newer(built_in, cached)),
            (built_in, cached) => built_in.or(cached),
        };
        Self {
            current: RwLock::new(current.map(Arc::new)),
            store,
        }
    }

    pub fn display_name(&self, origin: &str) -> Option<String> {
        let current = self.current.read();
        current.as_ref()?.display_name(origin).map(str::to_owned)
    }

    pub fn version(&self) -> Option<u64> {
        self.current.read().as_ref().map(|list| list.version())
    }

    fn judge(&self, candidate: &SiteList) -> Judgement {
        match self.current.read().as_deref() {
            Some(current) => judge(current, candidate),
            None => Judgement::Accept,
        }
    }

    /// Swaps in `winner` if it is still newer than the list in use, judged under the write lock.
    fn adopt(&self, winner: SiteList) -> bool {
        let mut current = self.current.write();
        let newer = current
            .as_deref()
            .is_none_or(|current| judge(current, &winner) == Judgement::Accept);
        if newer {
            *current = Some(Arc::new(winner));
        }
        newer
    }
}

/// Built-in against cache at load: the higher version, or the built-in on a tie.
fn newer(built_in: SiteList, cached: SiteList) -> SiteList {
    match judge(&built_in, &cached) {
        Judgement::Accept => cached,
        Judgement::Equivocation => {
            tracing::error!(
                version = built_in.version(),
                "SECURITY: the cached verified-sites list differs from the built-in one at the same version; using the built-in"
            );
            built_in
        }
        Judgement::Unchanged | Judgement::Older => built_in,
    }
}

/// One list check. No lock is held across the fetch, and the list is persisted before it is used, so
/// memory never runs ahead of a cache it could have written.
pub async fn refresh(sites: &Arc<VerifiedSites>, feed: &Feed) -> Refresh {
    let candidate = match fetch_verified(feed).await {
        Ok(candidate) => candidate,
        Err(outcome) => return outcome,
    };
    if let Some(outcome) = screen(sites, &candidate.list) {
        return outcome;
    }
    let (winner, persisted) = match persist(sites, candidate).await {
        Ok(saved) => saved,
        Err(outcome) => return outcome,
    };
    let version = winner.version();
    if sites.adopt(winner) {
        tracing::info!(version, persisted, "Verified-sites list updated");
        Refresh::Swapped { persisted }
    } else {
        Refresh::Kept
    }
}

async fn fetch_verified(feed: &Feed) -> Result<VerifiedDocument, Refresh> {
    let bytes = fetch_document(feed).await.map_err(|e| {
        tracing::info!(error = %e, "Verified-sites list unreachable; retrying later");
        Refresh::Unreachable
    })?;
    verify_document(&bytes, &feed.key).map_err(|e| {
        tracing::warn!(error = %e, "Refusing the fetched verified-sites list");
        Refresh::Refused
    })
}

/// `None` when `candidate` is newer than the list in use.
fn screen(sites: &VerifiedSites, candidate: &SiteList) -> Option<Refresh> {
    let version = candidate.version();
    match sites.judge(candidate) {
        Judgement::Accept => None,
        Judgement::Unchanged => Some(Refresh::Kept),
        Judgement::Older => {
            tracing::debug!(
                version,
                "The served verified-sites list is older than the one in use"
            );
            Some(Refresh::Kept)
        }
        Judgement::Equivocation => {
            tracing::error!(version, "SECURITY: the served verified-sites list differs from the one in use at the same version; keeping the one in use");
            Some(Refresh::Equivocation)
        }
    }
}

/// Saves `candidate` unless the cache already holds a list at least as new, and returns the list to
/// use with whether the cache holds it. Only a failed write lets the candidate win in memory alone.
async fn persist(
    sites: &Arc<VerifiedSites>,
    candidate: VerifiedDocument,
) -> Result<(SiteList, bool), Refresh> {
    let version = candidate.list.version();
    let saving = Arc::clone(sites);
    let saved = tokio::task::spawn_blocking(move || {
        let outcome = match &saving.store {
            Some(store) => store.save_if_newer(&candidate),
            None => SaveOutcome::Saved,
        };
        (candidate.list, outcome)
    })
    .await;
    match saved {
        Ok((list, SaveOutcome::Saved)) => Ok((list, true)),
        Ok((_, SaveOutcome::DiskNewer(disk))) => Ok((disk, true)),
        Ok((_, SaveOutcome::Equivocation)) => {
            tracing::error!(version, "SECURITY: the cached verified-sites list differs from the served one at the same version; keeping the one in use");
            Err(Refresh::Equivocation)
        }
        Ok((list, SaveOutcome::WriteFailed(e))) => {
            tracing::error!(error = %e, version, "Could not cache the verified-sites list; it holds for this session");
            Ok((list, false))
        }
        Err(e) => {
            tracing::error!(error = %e, "The verified-sites cache write did not finish");
            Err(Refresh::Kept)
        }
    }
}

/// The list's own check loop, beside and independent of the update task: a launch check after
/// `launch_delay`, then one whenever 6 h of wall-clock time have passed (sampled every `tick`), plus
/// requests. Its schedule lives in memory: the launch check runs on every start anyway.
pub async fn run_refresh(
    sites: Arc<VerifiedSites>,
    feed: Feed,
    requests: mpsc::Receiver<RefreshRequest>,
    launch_delay: Duration,
    tick: Duration,
) -> Infallible {
    let schedule = ScheduleStore::new(None, env!("CARGO_PKG_VERSION"));
    run_updates(
        &schedule,
        presto_core::updater_state::now_unix,
        launch_delay,
        tick,
        requests,
        || false,
        |_| {
            let (sites, feed) = (Arc::clone(&sites), feed.clone());
            async move { refresh(&sites, &feed).await }
        },
        |reason, outcome| {
            if let CheckReason::Manual(Some(reply)) = reason {
                let _ = reply.send(outcome);
            }
            std::future::ready(())
        },
    )
    .await
}

/// Runs [`run_refresh`] on the managed registry at the update check's cadence.
pub fn spawn_refresh(app: &AppHandle, feed: Feed, requests: mpsc::Receiver<RefreshRequest>) {
    let Some(sites) = app
        .try_state::<crate::commands::VerifiedSitesState>()
        .map(|sites| Arc::clone(&sites))
    else {
        tracing::error!("The verified-sites registry is not managed; list checks are disabled");
        return;
    };
    tauri::async_runtime::spawn(async move {
        match run_refresh(sites, feed, requests, LAUNCH_DELAY, WAKE_TICK).await {}
    });
}

/// The production list check against presto.build. Nothing sends requests, so the channel is
/// closed from the start.
pub fn spawn_production_refresh(app: &AppHandle) {
    if let Some(key) = pinned_key() {
        spawn_refresh(app, Feed::production(key), mpsc::channel(1).1);
    }
}

/// `None` only if the compiled-in key is malformed, which `the_pinned_key_parses` rules out.
pub fn pinned_key() -> Option<ListKey> {
    ListKey::from_document(PUBLIC_KEY)
        .inspect_err(|e| {
            tracing::error!(error = %e, "The pinned verified-sites key does not parse; keeping the built-in list");
        })
        .ok()
}

/// Beside the update schedule. WebDriver builds keep the list in memory, so a test run never writes
/// the user's `~/.presto`.
fn cache_path() -> Option<PathBuf> {
    if cfg!(feature = "webdriver") {
        return None;
    }
    dirs::home_dir().map(|home| home.join(".presto").join("verified-sites-accepted.json"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_built_in_is_the_newest_record_byte_for_byte() {
        let history =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../verified-sites/history");
        let records = presto_core::verified_sites::history::read_records(&history).unwrap();
        let newest = records.last().expect("at least one record");
        assert_eq!(BUILT_IN, newest.list.as_slice());
        let built_in = SiteList::parse_unsigned(BUILT_IN).unwrap();
        assert_eq!(built_in.version(), newest.version);
        assert_eq!(
            VerifiedSites::load(BUILT_IN, None).version(),
            Some(newest.version)
        );
    }

    #[test]
    fn the_pinned_key_parses() {
        let key = pinned_key().expect("key.pub parses");
        assert!(PUBLIC_KEY.contains(&key.key_id_hex()));
    }

    #[test]
    fn a_built_in_that_does_not_parse_leaves_an_empty_registry() {
        let sites = VerifiedSites::load(b"not json", None);
        assert_eq!(sites.version(), None);
        assert_eq!(sites.display_name("https://nulo.sh"), None);
    }
}

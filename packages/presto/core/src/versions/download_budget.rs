//! Bounds how often uncached bb versions are downloaded. The version header is honoured before a
//! request proves it is a real job, so without a budget one approved origin can make the app fetch
//! and discard a 64 MiB tarball per request, indefinitely.

use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Download attempts one origin may start per window; origin-less callers share one bucket.
pub const PER_ORIGIN_DOWNLOADS: usize = 3;
/// Download attempts the whole app may start per window, whatever the origins.
pub(crate) const GLOBAL_DOWNLOADS: usize = 6;
pub(crate) const DOWNLOAD_WINDOW: Duration = Duration::from_secs(10 * 60);

/// Sliding-window attempt counters plus the lock that serializes downloads. A request that needs a
/// version takes `serial` first and re-checks the cache under it, so concurrent requests for one new
/// version cost one download; a request that then downloads spends a token whether or not the
/// download succeeds.
#[derive(Default)]
pub struct DownloadBudget {
    pub(crate) serial: tokio::sync::Mutex<()>,
    /// `None` is the global bucket; `Some(origin)` a per-origin one (`""` for origin-less callers).
    attempts: Mutex<HashMap<Option<String>, VecDeque<Instant>>>,
}

#[derive(Debug)]
pub struct BudgetExhausted;

impl DownloadBudget {
    /// Record a download attempt for `origin` now, or refuse it when either bucket is full.
    pub(crate) fn take(&self, origin: Option<&str>) -> Result<(), BudgetExhausted> {
        self.take_at(origin, Instant::now())
    }

    fn take_at(&self, origin: Option<&str>, now: Instant) -> Result<(), BudgetExhausted> {
        let keys = [None, Some(origin.unwrap_or("").to_string())];
        let mut attempts = self.attempts.lock().unwrap_or_else(|e| e.into_inner());
        for key in &keys {
            let bucket = attempts.entry(key.clone()).or_default();
            while bucket
                .front()
                .is_some_and(|t| now.duration_since(*t) >= DOWNLOAD_WINDOW)
            {
                bucket.pop_front();
            }
            let cap = if key.is_none() {
                GLOBAL_DOWNLOADS
            } else {
                PER_ORIGIN_DOWNLOADS
            };
            if bucket.len() >= cap {
                return Err(BudgetExhausted);
            }
        }
        for key in keys {
            attempts.entry(key).or_default().push_back(now);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_origin_gets_its_share_then_waits_out_the_window() {
        let budget = DownloadBudget::default();
        let t0 = Instant::now();
        for _ in 0..PER_ORIGIN_DOWNLOADS {
            budget
                .take_at(Some("https://a.example"), t0)
                .expect("within budget");
        }
        assert!(budget.take_at(Some("https://a.example"), t0).is_err());
        // A refused attempt spends nothing: another origin still has the global room it expects.
        budget
            .take_at(Some("https://b.example"), t0)
            .expect("other origin");
        budget
            .take_at(Some("https://a.example"), t0 + DOWNLOAD_WINDOW)
            .expect("window elapsed");
    }

    #[test]
    fn the_global_bucket_caps_every_origin_together() {
        let budget = DownloadBudget::default();
        let t0 = Instant::now();
        for i in 0..GLOBAL_DOWNLOADS {
            let origin = format!("https://o{i}.example");
            budget
                .take_at(Some(&origin), t0)
                .expect("within global budget");
        }
        assert!(budget.take_at(Some("https://fresh.example"), t0).is_err());
        assert!(budget.take_at(None, t0).is_err());
    }

    #[test]
    fn origin_less_callers_share_one_bucket() {
        let budget = DownloadBudget::default();
        let t0 = Instant::now();
        for _ in 0..PER_ORIGIN_DOWNLOADS {
            budget.take_at(None, t0).expect("within budget");
        }
        assert!(budget.take_at(None, t0).is_err());
    }
}

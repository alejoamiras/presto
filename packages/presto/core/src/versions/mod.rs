//! Aztec bb version management: validation/policy, cache layout, release metadata, and the
//! download/install pipeline.
//!
//! q7e3-F-07: previously a single ~1000-LOC module; now focused submodules. This root re-exports the
//! public surface unchanged, so `versions::X` paths outside the module are untouched (the F-12
//! lesson: same module-tree position, zero external churn).

mod cache_layout;
mod download_budget;
mod downloader;
mod leases;
mod release_metadata;
mod version_policy;

pub use cache_layout::{
    bb_binary_name, list_cached_versions, mark_cached_bb_active, verify_cached_bb, version_bb_path,
    versions_base_dir,
};
#[cfg(test)]
pub(crate) use cache_layout::{sha256_file, write_bb_marker};
pub use download_budget::{BudgetExhausted, DownloadBudget, PER_ORIGIN_DOWNLOADS};
pub use downloader::download_bb;
pub use leases::{acquire as acquire_lease, Contended, Lease};
pub use release_metadata::{current_platform, download_url};
pub use version_policy::{
    check_version_selectable, cleanup_old_versions, is_valid_version, sweep_cache_on_start,
    versions_to_evict, versions_to_evict_for_size, AztecVersion, NetworkTier, VersionRejection,
    CACHE_MAX_TOTAL_BYTES,
};

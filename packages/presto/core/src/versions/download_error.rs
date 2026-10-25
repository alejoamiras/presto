//! Why a bb download failed: a coarse cause a site may be told, plus the full error for the log.

use std::error::Error;
use std::fmt;

/// The step at which a download failed. A variant carries no error text, so it can never name a
/// local path; the server renders a site's message from this alone.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DownloadFailure {
    /// The release, or its asset for this platform, does not exist.
    ReleaseNotFound,
    /// The metadata or tarball request did not complete.
    RequestFailed,
    /// The release publishes no usable digest, or the tarball does not match it.
    IntegrityCheckFailed,
    /// The verified tarball could not be extracted and installed into the cache.
    UnpackFailed,
}

impl DownloadFailure {
    pub(crate) fn for_status(status: reqwest::StatusCode) -> Self {
        if status == reqwest::StatusCode::NOT_FOUND {
            Self::ReleaseNotFound
        } else {
            Self::RequestFailed
        }
    }
}

/// A failed [`super::download_bb`]. Transparent over the error it wraps, so a log of it prints
/// each cause in the chain once; the inner text may name local paths and stays off the wire.
#[derive(Debug)]
pub struct DownloadError {
    failure: DownloadFailure,
    error: Box<dyn Error + Send + Sync>,
}

impl DownloadError {
    pub(crate) fn new(
        failure: DownloadFailure,
        error: impl Into<Box<dyn Error + Send + Sync>>,
    ) -> Self {
        Self {
            failure,
            error: error.into(),
        }
    }

    pub fn failure(&self) -> DownloadFailure {
        self.failure
    }
}

impl fmt::Display for DownloadError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.error.fmt(f)
    }
}

impl Error for DownloadError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        self.error.source()
    }
}

impl From<reqwest::Error> for DownloadError {
    fn from(error: reqwest::Error) -> Self {
        Self::new(DownloadFailure::RequestFailed, error)
    }
}

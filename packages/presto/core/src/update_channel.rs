//! Which verified manifests a client may act on, given its update channel.
//!
//! Layer A proves a manifest is production-signed; this decides whether this client wanted it. A
//! channel client refuses every stable-schema prerelease, so the only prereleases it installs are
//! candidate manifests, and only while it is on the candidate channel.

use crate::config::UpdateChannel;
use crate::update_manifest::ManifestKind;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refusal {
    /// A stable-schema manifest for a prerelease: a feed signed before the channel existed, or a
    /// release smoke's feed for older clients. Refused on both channels.
    PrereleaseNotCandidate,
    /// A candidate manifest while this client follows the stable channel.
    CandidateOffChannel,
}

impl std::fmt::Display for Refusal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{self:?}")
    }
}

/// `Ok` when a client on `channel` may act on a verified manifest of `kind` for `version`.
pub fn admits(
    channel: UpdateChannel,
    kind: ManifestKind,
    version: &semver::Version,
) -> Result<(), Refusal> {
    match (kind, channel) {
        (ManifestKind::Stable, _) if version.pre.is_empty() => Ok(()),
        (ManifestKind::Stable, _) => Err(Refusal::PrereleaseNotCandidate),
        (ManifestKind::Candidate, UpdateChannel::Rc) => Ok(()),
        (ManifestKind::Candidate, UpdateChannel::Stable) => Err(Refusal::CandidateOffChannel),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn admission_table() {
        let stable = semver::Version::parse("1.3.0").unwrap();
        let candidate = semver::Version::parse("1.3.0-rc.2").unwrap();
        let cases = [
            (UpdateChannel::Stable, ManifestKind::Stable, &stable, Ok(())),
            (
                UpdateChannel::Stable,
                ManifestKind::Stable,
                &candidate,
                Err(Refusal::PrereleaseNotCandidate),
            ),
            (
                UpdateChannel::Stable,
                ManifestKind::Candidate,
                &candidate,
                Err(Refusal::CandidateOffChannel),
            ),
            (UpdateChannel::Rc, ManifestKind::Stable, &stable, Ok(())),
            (
                UpdateChannel::Rc,
                ManifestKind::Stable,
                &candidate,
                Err(Refusal::PrereleaseNotCandidate),
            ),
            (
                UpdateChannel::Rc,
                ManifestKind::Candidate,
                &candidate,
                Ok(()),
            ),
        ];
        for (channel, kind, version, expected) in cases {
            assert_eq!(
                admits(channel, kind, version),
                expected,
                "{channel:?} {kind:?} {version}"
            );
        }
    }
}

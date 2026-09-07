# Phase 1 — first-release exception

## Baseline

- Focused resolver/release-contract suite: 29 passed.
- `bun run lint:actions`: passed.
- The only implementation branch was the exact `1.0.0-rc.1` empty-release escape returning
  `bootstrap: true`; four updater jobs and the release aggregate consumed that output.

## Implementation

- Removed the escape result and workflow output.
- Made all four positive/tampered updater jobs unconditional on a successful resolved baseline.
- Replaced current first-release recovery instructions with a historical note while retaining dated
  launch evidence elsewhere.
- Added explicit contracts that the former RC1 case fails and no bootstrap wiring remains.

## Validation

- Focused resolver/release contracts: 29 passed.
- Full `bun run test`: passed (189 SDK, 72 playground with one live-node skip, 100 desktop
  scripts/UI, 4 release-feed, and 115 root-script tests in the reported run).
- `bun run lint:actions`: passed.
- Machine note: Cargo exists under `~/.cargo/bin` but that directory was absent from the session
  `PATH`; the successful full gate used an explicit tool-path prefix without changing repository
  configuration.

## Claude review

Round 1 conditionally approved. The useful finding was a missing discriminator: the tests selected
the greatest same-key release only when it was also the greatest eligible release. Added the case
where a newer wrong-key release must be skipped. Exact error assertions and small comment/runbook
cleanups were also accepted; no release design or scope changes were needed.

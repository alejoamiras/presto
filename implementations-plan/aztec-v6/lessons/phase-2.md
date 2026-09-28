# Phase 2: prerelease versioning and the promotion guard

## Changes

- `scripts/npm-packages.ts`:
  - `VERSION_PATTERNS["aztec-derived"]` accepts `X.Y.Z-(rc.N|nightly.YYYYMMDD|aztecnr-rc.N)[.M]` next to
    `X.Y.Z[-revision.N]`. A revision on a prerelease (`6.0.0-rc.1-revision.1`) and a `.N` on a
    revision stay invalid.
  - New `isPrerelease(version)`: any suffix except `-revision.N`.
- `scripts/get-sdk-publish-version.ts`: `aztecDerivedOrder` replaces `revisionOrder`. It sorts on
  `(major, minor, patch, stage, revision)` with stage −1 / 0 / 1, and two prereleases of one base fall
  back to `Bun.semver.order`, which compares numeric identifiers numerically: `rc.1.10` < `rc.2` <
  `rc.10`, all in the table.
- `scripts/playground-pin.ts`: `raisePin` uses `aztecDerivedOrder`.
- `scripts/promote-sdk-latest.ts`: `parsePromotionOptions` refuses a prerelease before any network
  call, so the refusal holds for `--rollback` too, which skips the `testnet` check.
- `scripts/release-plan.ts`: unchanged. `decide()` already delegates to `resolvePublishVersion` +
  `isValidVersion`, so the widened pattern is all it needed. The table test proves presto
  `6.0.0-rc.1`, a repeat `6.0.0-rc.1.1`, noir `2.0.0-rc.1` and core `1.2.1`.

## Gate

- `bun run test` exit 0: scripts went from 228 to 232 pass.
- `bun run lint` exit 0 after a Biome reformat of the new plan test.
- `bun run lint:actions` exit 0.
- Mutation: disabling the guard fails "a prerelease never reaches latest" (5 pass, 1 fail). Restored,
  it passes (6 pass).

## Noted, not changed

- **Rollback ordering.** `verifyPromotionCandidate` orders a rollback target with `Bun.semver.order`.
  For `aztec-derived` that refuses rolling back from `X.Y.Z-revision.N` to its own base `X.Y.Z`, which
  semver sorts higher. This predates the plan and is outside it; it is a candidate for
  `follow-ups.md` at close-out.

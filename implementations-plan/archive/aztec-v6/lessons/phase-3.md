# Phase 3: one scope-agnostic Aztec manifest reader

## The reader

`scripts/aztec-manifest.ts` is dependency-free, so a release job needs only a bare Bun.

- `findAztecDependency` matches `@aztec/`, `@aztec-labs/` or `@aztec-foundation/` + the bare name.
  - One name listed in several sections at one version counts as one match. The Noir adapter lists
    bb.js as both a dev and a peer dependency.
  - Two names, or one name at two versions, throw.
- `requireAztecDependency` also throws when none matches. `aztecVersionOf` is the required `stdlib`
  in `dependencies`.
- `listAztecDependencies` and `isAztecPackage` exist for the lockstep set: `@aztec/*`, `@aztec-labs/*`,
  and exact `@aztec-foundation/{bb.js,noir-acvm_js,noir-noirc_abi}`. They are the plan's managed set,
  shared by `update-aztec-version.ts` and `check-aztec-update.ts`.
- CLI: `<package.json> [bare=stdlib] [--name]`, searching all three sections.

## Reads routed

| Site | Now |
|---|---|
| `get-sdk-publish-version.ts` `baseVersionFor` | `aztecVersionOf` |
| `_publish-npm.yml` release notes | CLI (the publish job already has Bun) |
| `release-presto.yml` release notes | CLI; the job gained a pinned `setup-bun` step (same SHA the workflow uses elsewhere) |
| `setup-aztec/action.yml`, `_aztec-update.yml` | CLI `aztec.js` |
| `check-aztec-update.ts` | the aztec.js name and the package list come from the SDK manifest (the same 11 names as the old hardcoded list) |
| `tarball-consumer/exact-pin.ts` | prints `<name> <version>`; find for `manifest` packages, require for `aztec-derived` |
| `tarball-consumer/host-manifest.ts` | takes `<stdlib-name>@<version>` (`parseAztecPin` splits at the last `@`) |
| `sdk-tarball-consumer.sh` | `count_stdlib`, `npm ls` and both hosts use the name from the tarball |
| `install-legacy-sdk.ts` | `aztecVersionOf` on both sides |
| `published-playground.ts` | the bb.js name from the installed adapter's peer |
| `packaged-e2e-swap-sdk.sh` | the bb-prover and bb.js names from the packed manifests |
| `copy-bb.ts` `resolveAztecBb` | bb-prover from the SDK manifest, bb.js from bb-prover's manifest; it now also returns `entry` |
| `noir-fixture.ts` `loadBbJs` | reuses `resolveAztecBb().entry` |
| `update-aztec-version.ts` | the managed set is `isAztecPackage`, plus `LOCKSTEP_PACKAGES` (aztec-standards, until arc 3 drops it) |

## Filters

- `copy-bb.ts` now imports the reader, so `scripts/aztec-manifest.ts` joins every presto filter group
  that lists `copy-bb*.ts`: `desktop_runtime`, `windows_packaging`, `headless_server`,
  `sdk_integration` and `windows_bb`. `ci-filter-contract.test.ts` pins that routing.
- It also joins `app.yml`'s `published` filter, as the plan requires.

## Gate

- `bun run test` exit 0 (scripts 241, presto 106); `bun run lint` exit 0, including shellcheck;
  `bun run lint:actions` exit 0.
- `aztec-manifest.test.ts` passes (6 tests):
  - v5 and v6 SDK manifests;
  - the adapter's peer under both scopes;
  - both scopes, or two versions, is ambiguous for find and require;
  - none present: find returns `undefined` and require throws;
  - the lockstep list;
  - the CLI.
- `exact-pin.test.ts` covers:
  - a `manifest` package with no stdlib returns `undefined`;
  - an `aztec-derived` one throws;
  - a dual-scope manifest throws for both.
- `update-aztec-version.test.ts` covers a `@aztec-labs/` pin, exact foundation names in dependencies
  and peers, and `@aztec-foundation/x` left untouched.
- `bun scripts/aztec-manifest.ts packages/sdk/package.json` prints `5.2.0`.
- `sdk-tarball-consumer.sh`, run against tarballs packed by `pack-candidate.ts` exactly as
  `_ts-package-ci.yml` packs them:
  - every key exits 0: presto-core, presto-noir, presto, presto-banners;
  - presto's exact host has one `@aztec/stdlib` install location; the conflict host reports 10,
    informational only.
- Both shell scripts pass shellcheck 0.11 and the CI version, 0.9 (`koalaman/shellcheck:v0.9.0`).
  - 0.9 flagged SC2015 on `( cd … && npm ls "$STDLIB_NAME" || true )`, which 0.11 passes; this is
    the lesson already in `lessons.md`.
  - The fix groups the fallback, `{ npm ls … || true; }`. A failing `cd` now fails the script
    instead of being swallowed.
- The `rg` check: the remaining non-comment hits are the Noir consumer profile's
  `import type … from "@aztec/bb.js"` and its `host-dependencies.json`. Neither is a manifest read:
  they are v5 content that arc 3's scope rename moves. Three pin-message strings in `copy-bb.ts` and
  `check-windows-bb-pin.ts` now say `bb.js`.
- The Published Playground Build runs on the arc 2 PR, since `app.yml` and the filter-listed scripts
  changed.

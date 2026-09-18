# Phase 8 — publish scripts parameterised by package

Date: 2026-09-08. Branch `presto-noir/npm-tooling` (arc 2), stacked on `worktree-presto-noir`.

## What landed

- `scripts/npm-packages.ts`: the closed descriptor (`presto` only until its siblings land with their
  packages), `versionMode` (`aztec-derived` | `manifest`), `consumerProfile`, `--package` parsing,
  version patterns (the `-revision.N` suffix is exclusive to `aztec-derived`), provenance subject and
  release tag derivation, manifest reading. Test validates every entry against the workspace.
- `get-sdk-publish-version.ts`: `resolvePackageVersion` — `manifest` versions publish verbatim and
  fail hard when already on npm; `baseVersionFor` reads the manifest version or the `@aztec/stdlib`
  pin so the CLI needs no argument.
- `sdk-release-verification.ts`, `verify-sdk-package-signatures.ts`, `promote-sdk-latest.ts`: the
  package is a parameter (default `presto`); the provenance subject, install name, dist-tag reads,
  git tag, and registry read-back all derive from it. A statement for a sibling package is rejected.
  The legacy `SDK_*` constants remain as derived exports for `published-playground.ts`.
- `prepare-sdk-publish.ts`: `preparePublishManifest(pkg, version, workspaceVersions)` pins every
  `workspace:` range (any modifier) in `dependencies` / `peerDependencies` / `optionalDependencies`
  to the supplied exact version and fails closed when one is missing; CLI `--dep name=version`.
- `sdk-tarball-consumer.sh <tarball> [package-key]`: the host files come from
  `scripts/tarball-consumer/<profile>/` (`index.ts`, `runtime-check.mjs`, `tsconfig.json`, optional
  `host-dependencies.json`); the exact `@aztec/stdlib` pin comes from
  `scripts/tarball-consumer/exact-pin.ts` (unit-tested: exact pins pass, ranges and malformed specs
  fail, a missing dependency fails for `aztec-derived` packages and is simply absent for `manifest`
  packages, which then get a plain host and no singleton gate).

## Decisions

- The consumer script's second argument is the package **key**, not a profile directory as the plan
  sketched: the descriptor already maps key → profile, and a second spelling of that mapping in a
  shell argument would be a place for the two to drift.
- `tsconfig.scripts.json` excludes `scripts/tarball-consumer/*/**`: those sources are typechecked
  inside the consumer host against the packed dist, which is the point of them.

## Gate

`bun run test:scripts` (138) ✓ · `bun run typecheck:scripts` ✓ · `bun run lint` (biome, sort-package-json,
shellcheck, rustfmt) ✓ · local `scripts/sdk-tarball-consumer.sh` against a freshly packed SDK: exact
host typechecks and loads, `@aztec/stdlib` singleton (1 location), conflict host recorded (10) ✓.

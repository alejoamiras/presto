# Phase 2: tooling for split release numbers

## Change

- `update-aztec-version.ts`:
  - `AztecTargets { labs, foundation }` and `targetFor`;
  - `resolveTargets(labs, sdk, registry)` reads the direct dependencies of every labs package the
    SDK manifest names, at the labs version;
  - `foundationVersionOf` aggregates every `@aztec-foundation/*` pin, managed or not. No pin, two
    versions or a range throws, naming each source;
  - `missingPackages` checks each name at its own target;
  - `CRS_CACHE_VERSION` takes the foundation version, since it tracks bb.js.
- `AztecRegistry` (`distTags`, `dependencies`) is the one place that runs `npm view`. The old
  per-script `npm view … version` existence checks are folded into it: a missing version exits 1
  (checked: `npm view @aztec-labs/stdlib@9.9.9` → E404, exit 1).
- `check-aztec-update.ts`: `checkAztecUpdate(sdk, distTag, registry)` behind an `import.meta.main`
  guard. Its output gains `foundation`; `_aztec-update.yml` reads only `needsUpdate`, `latest`,
  `current`.
- `aztec-installer-graph.ts`: `compareGraph(graph, listed, { labs, foundation })`; the CLI takes a
  fourth argument. The script keeps its own one-line scope rule instead of importing the updater,
  so `ci-filter-contract.test.ts`'s routing for it stays exact.
- `setup-aztec`: the detect step also outputs `foundation` from the SDK's bb.js pin; the graph step
  passes it.

## Gate

- `bun run lint:actions` exit 0. `bun run test` exit 0 (scripts suite: 43 files, including the new
  `check-aztec-update.test.ts`).
- First full run failed typecheck on `noUncheckedIndexedAccess` (`PACKAGE_JSON_FILES[0]`) and on
  untyped `Map` literals in the test; fixed. Biome's 80-line describe cap moved the split-release
  case into its own `describe`.
- `bun run aztec:check prerelease` →
  `{"current":"6.0.0-rc.1","latest":"6.0.0-rc.3","needsUpdate":true,"foundation":"6.0.0-rc.6"}`,
  no `missing`.
- Graph CLI against the phase-0 host scratch install of 6.0.0-rc.3 (62 names): with
  `6.0.0-rc.3 6.0.0-rc.6` it matches; with `6.0.0-rc.3 6.0.0-rc.3` every `@aztec-foundation/*` name
  fails as off-release, the failure the old single-version check produced.

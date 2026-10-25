# deps-1 phase 2: audit npm's bundleDependencies (#167)

- Biome's `noExcessiveLinesPerFunction` (80) counts a `describe` callback, so the test fixture moved
  to module scope and the tests split into two `describe` blocks.
- Mutation checks: disabling each guard fails exactly one test. The guards are the severity check,
  the symlink refusal, the empty-bundle refusal, the semver check and the name check. Dropping
  `bunfig.toml` from the workflow paths fails `ci-filter-contract.test.ts`.
- The live test (`PRESTO_LIVE_AUDIT=1`) took 247 ms against the real endpoint.
- Gate, 2026-10-25: `bun test` (plain 7 pass + 1 skip, live 8 pass), lint, `bun run test` and
  `lint:actions` all exited 0. The audit printed `npm 11.21.1 bundle: 141 packages, 143 versions
  sent, 3 advisories`, with bundled `ip-address` GHSA-rxp7-6hxx-x8q5 (REPORT) and bundled `undici`
  GHSA-xjj6-f33q-929c (BLOCKED). The `BLOCKED` keys equal phase 1's.

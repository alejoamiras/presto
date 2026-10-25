# Phase 1: bounded registry calls (#132)

- The leaf `scripts/npm-command.ts` holds `NPM_TIMEOUT_MS`, `spawnBounded` and `run`.
  `npmViewJson` keeps its E404 classification on stderr through `spawnBounded`.
- Guard proof: the three new refusal cases each give `[]` from the old `codeViolations`, extracted
  from `HEAD` into scratch and run directly. That is, the old guard let an imported
  `run(["bunx", …])`, a `run as execute` alias and an imported `spawnBounded` through. The new
  guard refuses all three.
- Contract proof: at `HEAD`, `release-plan.ts`, `get-sdk-publish-version.ts` and
  `sdk-release-verification.ts` each matched the direct-npm-spawn pattern. `published-playground.ts`
  lacked the leaf import.
- Biome caps cognitive complexity at 15. With the import check added, `codeViolations` scored 17,
  so the check moved to `leafImportViolations`.
- `published-playground.ts`: the shared `run` returns untrimmed stdout. Both callers `JSON.parse` it,
  so no `.trim()` is needed. This is a small deviation from the plan's `.trim()` wording, with no
  behaviour change.
- The `verify` job's `PACKAGE_NAME` env became unused once the duplicate step went, so it was
  removed. `needs: [pack, publish]` stays, because a contract test pins it.
- Gate: focused tests 83 pass, `bun run lint:actions` exit 0, `bun run test` exit 0.

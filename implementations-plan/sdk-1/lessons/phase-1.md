# Phase 1 (a1): `download-failed` in core

## Red before green (2026-10-25)

- The expectations changed first: core row `500 download_failed` → `download-failed`, a new core
  row `429 download_budget_exhausted` → `transient`, and a new noir row `failed bb download (500)`.
- Against the unchanged classifier:
  - sdk-core: 195 pass, 1 fail, `degrades: 500 download_failed` (Expected `"download-failed"`,
    Received `"transient"`). The new 429 row passed, as a control should.
  - sdk-noir: 39 pass, 1 fail, `failed bb download (500)` (same Expected and Received, from
    `PrestoUnavailableError.reason` under `fallback: "none"`).

## Gate (2026-10-25)

- After the classifier change: sdk-core 196 pass, sdk-noir 40 pass.
- `bun run lint` exit 0. Its 5 warnings are all in files this arc does not touch
  (`docs-examples.test.ts`, `sdk-release-contract.test.ts`).
- `bun run test` exit 0. Every suite reported 0 fail.
- The tree is clean, and `origin/main...HEAD` lists no `package.json` and no `bun.lock`.
- lint-staged's biome pass changed nothing in the staged TS files.

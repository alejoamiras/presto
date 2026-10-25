# Phase 1 (a1): `download-failed` in core

## Red before green (2026-10-25)

- The expectations changed first: core row `500 download_failed` → `download-failed`, a new core
  row `429 download_budget_exhausted` → `transient`, and a new noir row `failed bb download (500)`.
- Against the unchanged classifier:
  - sdk-core: 195 pass, 1 fail, `degrades: 500 download_failed` (Expected `"download-failed"`,
    Received `"transient"`). The new 429 row passed, as a control should.
  - sdk-noir: 39 pass, 1 fail, `failed bb download (500)` (same Expected and Received, from
    `PrestoUnavailableError.reason` under `fallback: "none"`).

# Phase 7 — app docs

Date: 2026-09-08.

## What landed

- `packages/presto/README.md`: "Proving any Noir circuit (`POST /prove/ultra-honk`)" under How It
  Works — request fields, response shape, determinism (`*-no-zk` only; starknet refused by bb 5.2.0),
  error names and status codes, and the trust-boundary paragraph (same guards as `/prove`, inputs as
  files, closed target enum, decoded caps, wrong key spoils only the caller's proof). Port section and
  headless configuration gain `PRESTO_HOME` / `--port`; both `/health` examples show `schemes` and
  `versions`; Testing lists the three crates, the real-bb suite, the UltraHonk WebDriver coverage,
  and the `DISPLAY` requirement on Linux.
- `CLAUDE.md` Current State: the route, `PRESTO_HOME`/`--port`, health fields, per-origin cap, and
  refreshed test counts (WebDriver 25, Rust ~445/434, TS ~390 with presto scripts 105 and root
  scripts 125; the previous 17 / 53 / 64 were already stale before this arc).
- `docs/RELEASE_RUNBOOK.md`: the route ships in Presto 1.1.0 (A-03), never as a 1.0.x patch.

## Notes

- Doc-pinning tests that could have bitten: `ci-filter-contract.test.ts` (filters ↔ workflow) and
  `release-contract.test.ts`; both green, nothing in them pins README prose.

## Gate

`bun run test` ✓ (lint + typecheck + unit: SDK 189, playground 72, presto scripts 105, release-feed 4,
root scripts 125) · `bun run lint` ✓ (inside `test`).

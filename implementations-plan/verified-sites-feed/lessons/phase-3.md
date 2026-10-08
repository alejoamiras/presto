# Phase 3: list content, pins and documentation

## Shipped (before O2)

- `verified-sites.json` at `version: 1`: "Nulo" with `https://nulo.sh` and the Chrome extension
  origin; the faucet and the workers.dev alias are gone. The old and new lists both pass the strict
  parser; `verified-sites diff` reports one added origin, two removed and one rename.
- Pins: the src-tauri registry test names every remaining origin and pins the count at four (so it
  never names a removed origin), the authorize spec's mock says "Nulo", the domain test expects one
  playground origin.
- `verified-sites.schema.json` mirrors the parser's rules (editor hints only); `VERIFIED_SITES.md`
  has the new format, field table, versions, the signing flow and the Firefox reason (UUIDs differ
  per browser profile). It says the app still reads its compiled-in copy, which stays true until the
  client change.
- `.gitattributes`: `-text` for the list and `verified-sites/**`.
- `core/tests/verified_sites_repo.rs`: `check()` over a `packages/presto` layout (records verify and
  carry their version, consecutive records at most 100 apart, retired keys named by their key ID, no
  `\r`, the source signable or equal to the newest record), exercised on synthetic trees built from
  the fixtures. New fixture `list-105` (100 above list-5, 101 above list-4) gives the gap rule both
  edges. The test over the repository itself and the `key.pub` checks (not a test vector, not the
  updater key) wait for `key.pub`.

## Gate (2026-10-08)

- `cargo test verified_sites` in src-tauri (after `frontend:build` and `prebuild`): 7 pass. Core:
  375 + 3 pass, clippy `--all-targets -D warnings` clean.
- `bun test scripts/presto-domain.test.ts`; `test:e2e:ui`: 84 pass (`test-results` removed).
- The grep for the old names over `packages/presto` and `scripts` finds only `core/src/config.rs`;
  `git check-attr text` reports `unset` for the list.
- Mutations: a gap of 101 allowed (`MAX_VERSION_STEP + 1`) and the `\r` check disabled in
  `read_records` each fail a repo test. Reverted.

## Bitten

- src-tauri's tests need the bb sidecar in `binaries/` (`bun run --cwd packages/presto prebuild`)
  as well as `frontend:build`; tauri-build fails on the missing resource otherwise.

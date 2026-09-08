# Phase 15 — Byte identity and live e2e

Date: 2026-09-08. Branch `presto-noir/sdk-noir` (arc 4).

## What landed

- `packages/sdk-noir/e2e/e2e-setup.ts` (preload: LogTape config + the fixture loader, reusable for
  any directory with the fixture layout), `tsconfig.e2e.json` (typechecked by `test:lint`).
- `e2e/wasm-identity.test.ts` (`test:identity`): bb.js `WasmWorker` reproduces every committed
  fixture's key, proof, and public inputs byte for byte; the adapter's forced-local path yields the
  same proof and `verifyProof` accepts it.
- `e2e/native.test.ts` (`test:e2e`): against a live presto, `fallback: "none"` — the health
  advertises `ultra_honk`; each fixture's native proof equals the reference and verifies in WASM,
  a tampered proof does not (bb.js answers `false` or throws "Deserialized point is not on the
  curve" — both count); the route returns the reference key only when none was supplied. An unset
  `PRESTO_URL` throws at load unless `PRESTO_NOIR_SKIP_LIVE=1`; a yacana W directory
  (`PRESTO_NOIR_W_FIXTURE_DIR`) is an optional extra cross-check.
- `_ts-package-ci.yml` gains `identity` (bun + CRS cache) and `live` (setup-presto headless + bb
  sidecar, CRS cache, `cargo build` of `presto-server`, `start-headless-presto` on :59910 with a
  private home, the suite, kill in `if: always()`, server log on failure) behind boolean inputs;
  `sdk-noir.yml` passes both, its filter includes the headless crates and the two actions; `sdk.yml`
  enables them for `package=presto-noir`. Contract test extended.

## Notes

- A byte flip in a proof makes bb.js's verifier THROW rather than return `false` (curve-point
  deserialisation); the tamper assertion accepts either.
- The e2e tsconfig must include only `e2e/`: including `src/` pulls the unit tests in, whose
  `mock(...) as typeof fetch` casts are not meant to typecheck.
- Local reproduction: the P5-built `presto-server` with the bb sidecar, `--port 59921 --allow-all`,
  a scratchpad `PRESTO_HOME`, `AZTEC_BB_VERSION=5.2.0`: identity 3/3, live 4/4 (+1 skipped
  W cross-check) in ~3 s each with a warm CRS.

## Gate

`bun run --cwd packages/sdk-noir test:identity` 3 ✓ (local) · live suite 4 ✓ against a local
headless presto · `bun run test` exit 0 · `bun run lint:actions` ✓ · `sdk.yml package=presto-noir`
with the identity and live jobs: run id below once dispatched.

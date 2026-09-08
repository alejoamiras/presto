# Phase 18 — Mocked and smoke e2e

Date: 2026-09-08. Branch `presto-noir/playground-docs` (arc 5).

## What landed

- `e2e/noir.mocked.spec.ts` (mocked project, network-free): (1) Presto mode — `/health` (with
  `schemes`) and `/prove/ultra-honk` mocked on both loopback origins; asserts the wire job
  (bytecode verbatim, witness base64, `verifier_target`, the seeded `vk`) and the rendered result
  (time, "identical to fixture", filled column, log line, no fallback line); (2) an offline Presto
  with `?noirStub=true` — the fallback log line and the in-browser column; (3) in-browser mode never
  touches Presto. Every test blocks AND records what only real WASM proving would fetch (CRS
  points, bb.js workers, `.wasm`) and asserts none was requested, so a silent WASM run fails.
- `?noirStub=true` (a URL param like `?httpsOnly=true`): the page's WASM source becomes
  `stubBarretenberg(fixture)` through a dynamic import, so the stub stays out of the main bundle.
- `e2e/noir.smoke.spec.ts` (smoke project): one real bb.js WASM proof in Chromium (workers + CRS
  from the network), byte-identical to the fixture; a second leg proves natively when `PRESTO_URL`
  names a presto and asserts no fallback. Needs no Aztec node or wallet.
- The fixture now reaches the page through `virtual:noir-fixture` (a 40-line Vite plugin embedding
  the six files as base64; `decodeNoirFixture` is the pure counterpart the unit test covers against
  the files on disk).

## Notes

- Serving the fixture files by URL does not survive the dev server: extension-less bb outputs
  (`vk`, `proof`, `public_inputs`) are treated as JavaScript (`isJSRequest` is true for a path
  without an extension — the fetch returned `export default "/@fs/..."`), `assetsInclude` does not
  change that for `/@fs/` requests, and `witness.gz` is inflated by content negotiation ("incorrect
  header check" from pako). Embedding the bytes at build time removes every path semantic.
- Playwright's `route()` on `/prove/**` records requests even when the SDK's transport aborts:
  a clean way to prove "never talked to Presto".

## Gate

`bun run --cwd packages/playground test:e2e` 16/16 (13 existing + 3 Noir) ·
`bunx playwright test --project=smoke e2e/noir.smoke.spec.ts`: the WASM leg green in 8.5 s locally
(the Presto leg skipped without `PRESTO_URL`) · `bun run --cwd packages/playground build` ✓ ·
`bun run test` exit 0 · `bun run lint:actions` ✓.

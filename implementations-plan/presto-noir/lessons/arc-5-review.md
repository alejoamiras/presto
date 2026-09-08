# Arc 5 — codex fix loop

Codex session `01a07fbf-fa56-7260-b6ef-33e663b231a2` (GPT-6 Astra, `high`, read-only), over
`git diff 586048c..17d0afc` with the arc map, the adversarial ask, and the two standing rules.

CI on the arc head 17d0afc: `app.yml` dispatch 34195704373 green (Lint, Unit Tests, Mocked E2E
with the three Noir tests, Production Build Smoke, Local Network E2E, Chromium LNA E2E).

## Round 1 — 2026-09-08

Verdict: no blocker/high; four mediums, three lows, nits. All verified against the code; all
accepted except the two noted below.

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | Medium | `?noirStub=true` had no build-mode guard: a production playground link could fabricate the in-browser benchmark with the committed bytes | `import.meta.env.DEV &&` guards the hook, so the stub import is dead code in the bundle (`dist/assets` contains no `stubBarretenberg`); the new production-smoke test loads `?noirStub=true` and requires real WASM traffic |
| 2 | Medium | The Noir handler snapshotted wallet readiness at click; a wallet that became ready during the proof was re-disabled by the `finally` (Deploy stuck off) | Readiness derived at finish (`state.wallet === null`); `initWallet` leaves the buttons to a proof in flight. No delayed-init e2e: the mocked project cannot bring the wallet to "ready" (every RPC but the health probe 500s), and with the snapshot gone there is no ordering left to race |
| 3 | Medium | The "release guarantee" smoke ran against the dev server and no CI lane runs the `smoke` project; the production worker/fixture packaging was unproven | `e2e/noir.production-smoke.spec.ts` in the `production-smoke` project (the `app.yml` gate): built bundle via `vite preview`, `crossOriginIsolated` asserted, real bb.js WASM proof byte-identical to the fixture (7.0 s locally); `preview.headers` now carries the same COOP/COEP as the deployed `_headers`; the dev-server smoke's comment corrected |
| 4 | Medium | `PRESTO_URL` in the smoke spec only gates skipping; the page keeps its default endpoints | Kept as a presence flag — that is the existing `demo.smoke.spec.ts` convention and `_e2e-app.yml` sets the same variable; the header now says so and names the HTTPS-listener requirement. A page-level URL override would be exactly the production knob the transport policy forbids |
| 5 | Low | In-browser test left `/health` un-mocked; the offline test did not record proof attempts; the native mock accepted HTTP and HTTPS alike | Every case mocks `/health`; the offline case records `/prove/**` attempts (asserted empty); the native case asserts the single job arrived at `https://127.0.0.1:59834/prove/ultra-honk` |
| 6 | Low | A mismatching native proof still got a success log and accent styling | The `noir proof:` log level and the tag colour follow `identical` (`text-brand-danger` for "differs from fixture"); two new mocked cases: a tampered proof, and an unrecognised `500` (error logged, results hidden, button and progress restored) |
| 7 | Low | Docs said an older app answers `404` / `route-missing`; the client refuses before posting (`scheme-unsupported`) since an app without `schemes` is chonk-only. Playground README did not delimit HTTP consent to the Aztec actions | Root, sdk-noir, and sdk-core READMEs corrected (`route-missing` = advertised scheme, missing route); playground README sentence added |
| 8 | Nit | Narrating comment on `proveNoirFixture`; backend comment missed the real invariant | Removed / replaced with the independent-client invariant |

Gates after the fixes: playground typecheck (src, tests, e2e, scripts) ✓, unit 75 ✓, mocked
project 18/18 ✓ (13 existing + 5 Noir), production smoke 3/3 ✓ (Noir WASM proof in the built
bundle 7.0 s), `bun run test` exit 0.

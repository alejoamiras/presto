# Arc 4 — codex fix loop

Codex session `01a07f96-2788-74f0-99ca-f768f389dc27` (GPT-6 Astra, `high`, read-only), over
`git diff 8dc7ac0..112e093` with the arc map, the adversarial ask, and the two standing rules.

CI on the arc's phase heads (`sdk.yml package=presto-noir`): 34191753272 (P14), 34192102345 (P15,
first run of the WASM Identity + Live Presto jobs), 34192458021 (P16) — all green.

## Round 1 — 2026-09-08

Verdict "request changes": one high, three mediums, two lows, comment nits, one moderate-confidence
suspect. All verified (codex reproduced #2, #4, and #5) and all accepted.

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | High | `publish-presto` accepted a *skipped* `publish-noir`; with `packages=all` a failed `noir-gates` skips noir's publication and presto would still publish | The skip is acceptable only when noir was not selected (`publish_presto_noir != 'true'`); contract test pins the exact condition |
| 2 | Medium | `decodeUltraHonkResponse` accepted an empty or one-byte proof and a key of any size; a 65,568-byte key was cached and sent back, which the route refuses with `400` — one malicious answer outlived its request | Structural validation: proof non-empty and 32-byte aligned, key 1..64 KiB (the route's own cap); the "empty proof accepted" test became four rejection rows |
| 3 | Medium | The live supplied-key test parsed JSON without checking the status, so a `400`/`500` object satisfied "no `vk`"; no adapter instance ever proved twice, so the cached-key request path was never exercised live | Status 200 and reference proof/public-input bytes asserted for both posts; each fixture now proves twice through one instance and the second result must equal the first |
| 4 | Medium (dormant) | `published-playground.ts` compared `dependencies` only; a published adapter's `@aztec/bb.js` peer pin was never compared with the bb.js the playground graph links in | `assertPeerPin` against the bb.js resolved from the swapped adapter directory (+ the adapter's core pin); test |
| 5 | Low | "compile-checked drop-in" overstated: bb.js's class has private fields, so `const b: UltraHonkBackend = adapter` fails TS2739 | Doc + README say public-method compatibility and show `Pick<UltraHonkBackend, …>` for consumers typed to the class |
| 6 | Low | The caller's factory ran before the guarded peer import, so a factory that itself imports a missing bb.js pre-empted the actionable error | bb.js is loaded before the factory; the peer test asserts the factory is never called when the peer is missing |
| 7 | Nit | Target-resolution comment too long and "ZK variants keep ZK" misleading with a mixed non-ZK flag; singleton preamble too long | One-sentence doc stating the upstream function and the precedence rule; preamble trimmed |
| 8 | Suspect (moderate) | Only `noir-recursive-no-zk` had cross-backend evidence; the default ZK target no consumer has to name was never proven native → WASM-verified | Live test: default options prove natively (`transmit`, no `fallback`) and verify in WASM; no byte comparison (ZK proofs are randomised) |

Gates after the fixes: adapter unit 37 ✓, root scripts 178 ✓, live suite 5/5 against the local
headless presto (+1 skipped W cross-check), typecheck ✓, actionlint ✓.

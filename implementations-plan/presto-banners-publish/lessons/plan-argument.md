# Plan argument — codex (GPT-6 Astra, `high`), 2026-09-09

Session `01a08675-9b7e-7be0-9418-2362ee780566`. Verdict: **conditional approve**, phase structure kept.

| # | Sev | Claim | Triage | Outcome |
|---|---|---|---|---|
| 1 | P1 | Phase 3 text assigned the full `status` to the ribbon yet said "visible ⇔ offline"; warn states render a fix-it strip whose Retry would do nothing; five mocked assertions plus `lna.real.spec.ts:121`; both `app.yml` filters. | Real inconsistency in the plan. Codex proposed wiring the full status and Retry; the playground already owns richer recovery panels (permission help, secure-connection help with retry + HTTP consent), so a second fix-it strip would duplicate them. | **D-8 adopted**: the ribbon is the install pitch only, driven by the view model (`offline` when `showInstall`, `available` when connected, otherwise unset). No Retry wiring. Both filters updated; `lna.real.spec.ts` assertion kept valid. |
| 2 | P1 | The trusted-publisher step omitted the allowed action; staged-only trust cannot `npm publish`. | Correct; the runbook table already says "Direct `npm publish` enabled". Codex's `--allow-publish` CLI flag is unverified — the step is phrased per the runbook. | Owner step amended. |
| 3 | P2 | Phase 1's gate (`test:scripts`) cannot pass before Phase 2 adds the workflow choices; Phase 3 gate command was not a shell command. | Correct (observed: two contract tests red between the phases). | Phase 1 gate = focused packaging tests + local consumer; full `test:scripts` in Phase 2. Phase 3 gate rewritten. |
| 4 | P3 | D-2 promised byte-identical manifests while dropping `devDependencies` from core/noir/presto too. | Correct wording bug. | D-2 reworded; the test pins `exports` and the dev drop separately. |
| 5 | P3 | Fonts: the playground already links the same faces; use `fonts="none"`; no CSP/COEP change warranted. | Agreed. | `fonts="none"` in the markup and fixture. |

Fine per codex: D-2 structural rewrite (`{types, default}` with `types` first serves NodeNext and bundler
resolution; no CJS conditions needed), D-3 (the swap script leaves the banners symlink alone;
`assertPublishedManifest` checks the published package's dependencies, not the playground's), D-5
(banners clause inside the `playground-only ||` bypass, so a playground-only deploy gains no blocker),
D-6 (no unguarded DOM access at import), D-7 (bootstrap still needed; `0.0.0-bootstrap.0` is a valid
manifest version that cannot collide with `1.0.0`), D-1/D-4.

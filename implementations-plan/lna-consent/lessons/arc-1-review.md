# Arc 1 review (Codex, GPT-6 Astra, `high`)

Session `01a0d947-9793-7490-a815-89932ae86829`. Brief: arc diff from `8edbbca`, plan.md, the ledger,
the arc map, an adversarial ask and the two verbatim rules.

## Round 1 — "Changes required", 7 findings, all verified against the code

| # | Sev | Finding | Verdict |
|---|---|---|---|
| 1 | High | `consent.ts`: without change events, a grant made at the prompt during `connect()` was never recorded, so a later reset did not force local and a proof re-prompted | accepted |
| 2 | High | `consent.ts`: auto-connect re-read the permission inside `connect()` and accepted `prompt`, so a reset between reads sent requests with no click | accepted: no automatic path re-reads; it connects only on the `granted` it was given |
| 3 | Med | `consent.ts`: a silent re-grant never cleared force-local; a stale grant flag forced local again right after an explicit reconnect | accepted: force-local recomputed per proof; an explicit connect clears grant history |
| 4 | Med | `consent.ts`: a revocation during a check still published `available: true`; a denial never reported `"blocked"` | accepted: epoch discards stale checks; the callback now reports `"ask"`, `"blocked"` or a status |
| 5 | Med | `sdk-core/README.md`: the `PrestoClient` example probes and proves with no gate, and the docs lint skipped that README and core's method names | accepted: marker comments; the lint covers the core README, `checkStatus(` and `.prove(` (mutation-checked: removing the marker fails the lint) |
| 6 | Low | `docs-examples.test.ts`: `.catch(() => undefined)` let a broken local path pass the no-request assertions | accepted: each proof must end in the WASM stub's rejection, with the WASM spy called once more |
| 7 | Low | comments: `render.ts` `sheetCtaLabel` doc, `presto-transport.ts` denied-check doc, `element.ts` Sheet comment, consent's "no prompt is possible" | accepted except `element.ts`, kept as one line that states the invariant `links[0]` relies on ("A Sheet has exactly one install link") |

The rewritten consent module: consent is a click or a reported `granted`; `denied`, or `prompt` after
a grant, revokes it (epoch bump). One `apply(state)` sets force-local and the view; `check()` records
the answer given at the prompt and publishes only if no revocation happened meanwhile. The new
tests fail against the round-0 module (reset, block-during-check and view tests) and pass against
the new one.

Gates after the fixes: `bun run test` exit 0 (SDK 28), `bun run lint` exit 0.

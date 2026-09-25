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

## Round 2 — "Changes required", 3 findings, all verified

| # | Sev | Finding | Verdict |
|---|---|---|---|
| 1 | High | the rewrite dropped the synchronous `setForceLocal(true)`, so a proof started while the module awaited its first read went native | accepted: restored before the first await |
| 2 | High | a slow permission read that resolved after a newer decision was still applied (post-check read re-enabling native under a shown "ask"; `beforeProving()` starting a check after a reset) | accepted: `read()` drops results older than the last decision taken; `connect()` reads directly, since the click is itself the newest decision and a stale read there only reaches the browser's own gate |
| 3 | Low | the persistent-`prompt` reconnect case was not exercised (the grant hook was still armed, and no pre-proof read) | accepted |

Codex agreed to keep the `element.ts` invariant comment. The permission stub can now hold reads
(each keeps the decision it saw); both race tests fail against the round-1 module and pass now.
`bun run test` exit 0 (SDK 30), `bun run lint` exit 0.

## Round 3 — "Changes required", 3 findings, verified by walking each sequence; loop cap reached

| # | Sev | Finding | Status |
|---|---|---|---|
| 1 | High | `connect()`'s direct read is not the newest decision: a watcher decision landing during it is overridden (captured `denied` then a watcher grant → ends "blocked" and local while granted; captured `granted` then a reset → a new `/health` after revocation) | open |
| 2 | High | the decision counter orders reads by completion, not by observation: read A (`granted`) completing after read B (`prompt`) started discards B, so a reset seen by B is lost and the proof goes native | open |
| 3 | Med | a check revoked while in flight still runs its post-check read, which can re-enable native proving while the view stays "blocked" | open |

Diagnosis: each round found a new interleaving of permission reads, watcher events and clicks,
because the module lets them race and then patches orderings one at a time. Stopped at the
3-round cap and surfaced to the owner (plan, Post-implementation step 3).

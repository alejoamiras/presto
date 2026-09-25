# Arc 2 review (Codex, GPT-6 Astra, `high`)

Session `01a0d99d-e28b-77f3-89ca-636cd60fb14c`. Brief: arc diff from `e772d86`, plan.md, the ledger,
the arc map, an adversarial ask and the two verbatim rules.

## Round 1 — "Changes requested", 5 findings, all verified against the code

| # | Sev | Finding | Verdict |
|---|---|---|---|
| 1 | High | `refresh()` checked only cached authorization, so after a grant and a reset nobody reported, the fallback refresh, Retry secure connection, the HTTP confirmation and the queued post-grant refresh still sent a check (breaks the plan's "re-read before every consented operation", L30) | accepted: `refresh()` re-reads and applies the decision before claiming display and checking; a fresh `granted` there only marks the grant as seen, since that check is the probe the grant needs |
| 2 | High | `connect()` ignored a revocation that landed during its own read (grant then reset reported meanwhile) and re-authorized | accepted: a `#revocations` counter; a click whose read raced a revocation returns |
| 3 | Med | a revocation driven by a `permission-blocked` result neither recorded the state nor invalidated reads in flight, so a pre-run read taken earlier re-authorized and let the run go native | accepted: `#revoke` records its state and bumps `#decisions`, so a read in flight yields to it |
| 4 | Med | a Noir run clicked while startup still awaited the Aztec node made a no-op decision; `start()` then yielded and the Services row never rendered | accepted: `start()` yields only if something already authorized or rendered |
| 5 | Low | `aztec.ts` state comment said `deploying` prevents concurrent mutation, false now that a permission change switches `uiMode` mid-run; plus two narrating comments in `main.ts` init | accepted for `aztec.ts`; the two `main.ts` comments predate this arc and sit outside its diff, left alone |

One test per finding; each fails against the round-0 controller and passes against the fix. One
existing test reported a `granted` event while its stubbed query still read `prompt`; the re-reading
refresh now treats that as a reset, so the stub reads `granted` after the event, as a browser does.

Also in this round (parallel work, not a finding): the landing's `.hidden` rule is restored for
PR #54's `#download-alt` link (see `phase-6.md`).

Gates after the fixes: controller tests 33 pass; `test:e2e` 22 passed; `test:e2e:lna` 8 passed;
`bun run lint` exit 0.

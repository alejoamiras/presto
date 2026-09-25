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

## Round 2 — "Changes requested", 2 findings, both verified

| # | Sev | Finding | Verdict |
|---|---|---|---|
| 1 | High | a late `start()` read recorded a block or reset and then yielded (the row was already owned by an early Connect) without applying it, so an overlapping pre-run read came back not fresh, skipped the re-check and went native | accepted, fixed at the root (below) |
| 2 | High | an inconclusive settlement whose display was taken by a newer refresh between that refresh's read and its epoch claim (one microtask hop) recorded a block and returned on the stale epoch, with the same consequence | accepted, same fix |

Root cause: a fresh read is recorded before its caller acts, and two callers could drop it. `#read()`
now revokes on a block, or on a reset after a grant, while authorized, whoever reads it; `#settle`'s
own revocation branches became unreachable and are gone. The startup regression runs for `denied` and
`prompt`. The settlement one drives reads and checks by hand to hit the one-hop window; a first
version built on the shared harness passed against the old controller too (the older check resolved
after the newer refresh had claimed the row, so it never settled) and was replaced. All three fail
against bd6e4fa and pass now.

Gates after the fixes: controller tests 36 pass (playground unit 106); `test:e2e` 22 passed;
`test:e2e:lna` 8 passed.

## Round 3 — "Changes requested", 2 findings, both verified (loop cap reached)

| # | Sev | Finding | Verdict |
|---|---|---|---|
| 1 | High | with no change events, a startup read of `granted` that yielded to an earlier Connect was recorded but never marked as a seen grant, so a later silent reset to "ask" was not treated as one and a proof went native | accepted: a yielding `start()` and a stale settlement now apply their fresh read with `#apply` (which keeps the first-grant probe) |
| 2 | Med | Retry from the blocked panel, after the site setting moved from blocked to "ask", revoked its own new authorization on the refresh's re-read (the stale `blocked` phase counted as a reason to revoke) | accepted: that condition applies only while unauthorized |

Regression tests reproduce both against ddd7b20 and pass now (controller tests 38). Round 3 is the
plan's cap, so the loop stops here and the state is surfaced to the owner.

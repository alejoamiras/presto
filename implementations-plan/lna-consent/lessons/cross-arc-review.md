# Cross-arc review (Codex, GPT-6 Astra, `high`)

Fresh session `01a0d9c3-c87a-7940-9501-b26dd4db2228`. Brief: the whole stack diff from `main`,
plan.md, both arc review logs, A5 as an accepted residual, an adversarial ask and the two verbatim
rules.

## Round 1 — "Changes requested", 2 findings, both verified

| # | Sev | Finding | Verdict |
|---|---|---|---|
| 1 | Med | the consent example's grant-triggered check joined the SDK's single-flight probe still in flight from the click, so both got the answer from before the grant; the grant was already recorded, so nothing probed again (reproduced by Codex with the real `PrestoClient`; distinct from A5, since nothing is read out of order) | accepted: `sync()` waits out the running check before its one forced check, re-checking consent after the wait; the playground already did this in `refreshAfterPermissionChange()` |
| 2 | Low | `startRun`'s doc comment (playground) and the expanded `PrimaryKind` comment (banners) restate the code below them | accepted, both deleted |

The regression test first fired the grant synchronously inside the stubbed `fetch()`, before
`check()` had assigned its promise, and failed against the fix. Browsers dispatch permission
`change` events as tasks, never inside `fetch()`, so the stub now fires the grant from a timer
while the probe retries. The test fails against the previous example (`stuck`) and passes against
the fix; the README and the skill copies were re-synced from the example.

Gates after the fixes: `bun run test` exit 0 on arc 1; playground unit tests 109 pass on arc 2.

## Round 2 — "Changes requested", 1 finding, verified

| # | Sev | Finding | Verdict |
|---|---|---|---|
| 1 | Med | a check's own read after a failed probe could be the first to see a grant: `apply()` recorded it and its "new grant" answer was dropped, so the change event or `beforeProving()` that followed found the grant already seen and never probed (reproduced by Codex with the real `PrestoClient`; outside A5, since every read is in order) | accepted: a check that reads a new grant after a failed probe probes once more (the second read sees the grant as seen, so it cannot repeat) |

The first draft of the regression test built the prover before replacing `fetch`, so the prover
kept the passing stub and the test passed against the old example as well. Stubbing `fetch` first
fixed that: the test now fails against round 1's example ("stuck") and passes against the fix.
Gates: docs suite 10 pass; `bun run test` exit 0 on arc 1.

## Round 3 — converged

"No new material findings." (resumed session, `response-2.md`).

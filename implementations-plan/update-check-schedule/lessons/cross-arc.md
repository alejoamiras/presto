# Cross-arc review (codex high, GPT-6 Astra)

A fresh session, `01a0f47d-3c4a-7533-bbe6-a81f4756a83c`, over the net diff `77b5f50..fa21630`. The
prompt covered the seams neither arc's review could see: manual versus scheduled checks, persisted
state across versions, WebDriver isolation after arc 2 widened what compiles, the smokes as oracles,
and main-thread and lock discipline.

## Round 1 — "one concrete cross-arc label race"

What Codex checked and found sound:
- Sequential checks and oneshot ownership rule out duplicate replies, and a tray request can neither
  take an install claim nor bypass consent.
- Detached installs hold the gate through the download and the idle wait.
- There is no main-thread wait on the update task or on a lock.
- Against the real `presto-v1.1.3` tag, the config and security-state formats are unchanged. The
  schedule file survives a downgrade untouched, though 1.1.3 cannot honour its snooze. The launch
  check stays unconditional.
- The WebDriver build's reachable check cannot construct `Available`.
- K5 fails closed for the shipped layouts, and arc 2 weakens no smoke assertion.

| # | Finding | Verified | Disposition |
|---|---|---|---|
| 1 | **Low.** "Up to date" can show during an install. A prompt stays open with a verified update and a manual check starts. Before it answers, the user clicks "Update Now", which claims the gate. The feed then answers `UpToDate` (after a rollback), `Rejected` or `Failed`, and `decide` returns `Clear` or `Unchanged` without looking at `busy`, so the tray reads "Up to date" or "Couldn't check" for five minutes while installing. | Yes: `act` sent `act_on`'s result as-is; only `Available` consulted the gate. | **Fixed.** `updater::manual_reply(result, busy)`: a gate that is busy when the reply is sent answers `Installing`. `act` reads `is_busy()` after `act_on`, and only for a tray request. The slot cleanup is unchanged. Tests: `a_busy_gate_outranks_the_manual_result` (every result, busy and idle) and a wiring guard in `update-wiring.test.ts` (the gate is read after `act_on`, and the reply is `manual_reply(result, busy)`). 🧬 `manual_reply` ignoring `busy` → the unit test is red. 🧬 `act` sending the raw result → the wiring test is red. |
| 2 | **Comments.** `should_poll_for_updates`'s doc said the update task cannot exist in WebDriver builds, but arc 2 starts it with a stub. `e2e_tray::click`'s doc narrated. Test docs carried plan-matrix IDs (`H1`, `E1–E10`, …). | Yes. | **Fixed.** The doc now says the real feed check is excluded. The click doc states only the main-thread constraint. Every ID-only doc and `ID:` prefix this stack added is removed or rewritten, as are the ID-only assertion messages (`"A1"`, `"G1"` …). Two things are unchanged: test names, which the lessons' mutation evidence cites, and IDs that predate the stack in `updater.rs`, `main.rs` and `updater_state.rs`, which are out of scope. |

Why a unit test plus a source guard, not an end-to-end race: the race needs a real verified
`Available` in the slot, which only a signed feed produces, and the WebDriver stub deliberately
cannot construct one. The pure rule and its single call site are what can break, and each has a
test that fails against its mutant.

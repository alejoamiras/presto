---
plan: tests-1
tier: light
status: completed 2026-10-25 (PR #176)
base: 80b562e
driver: claude-code
claude_model: opus
codex_model: sol
code_review: off
explainer: off
eli5_mode: skipped (orchestrator-owned)
harden: not scheduled
delivery: one PR (arc a1)
---

## Outcome

- **2026-10-25: completed**, one PR, #176, closing #141, #136 and #98.
- **Shipped**:
  - `run_alone()` in core, which takes the test's name from libtest's thread. The four store lock
    probes, the config lock probe and the TMPDIR test run through it. 40 of 40 full core runs were
    clean, where 7 of 40 failed before.
  - case_24 on one thread, with a count floor and a window bound in place of the 250 ms gap. It
    now fails two blocking mutants the old test passed.
  - auth-flow's `afterEach` closes the popup before awaiting, and the Deny test has its own origin.
    A failure after the popup opens stays one failure, proven by local WebDriver runs (a), (b),
    (d) and (e).
- **Changed in review**: the case_24 window bound (Codex round 1). `run_alone` takes no name,
  after the Opus review found a call site could name another test.
- **Rejected**: the issue's bounded wait for #141 (it passes a delayed release); a raised bound, a
  median or a paused clock for #136; `AbortController` or a detached promise for #98.
- **Known limits:** #177 (case_24's wall-clock window), #179 (a popup that opens after the hook's
  snapshot).
- **Open items:** none. `lessons.md` is at ~8.7 KiB, over its 8 KiB budget. It was already over
  (8.6 KiB) before this promotion, which merged into existing lines; the next promotion prunes.
- **Seeds retired**: the `/goal` and `/loop` lines below are not instructions.

# tests-1: three deterministic tests

Make `store.rs`'s lock-release checks (#141), feed case_24 (#136) and the auth-flow hooks (#98)
deterministic without weakening what they prove. Test-only. Evidence: `recon.md`, `lessons/phase-0.md`.
Size: ~180 lines against 150, because the repo has no post-implementation standard to cite, so
those steps and the two verbatim review rules stay inline.

## Outcome & Quality Bar

For a maintainer whose PR waits on the presto gates, or who reads a WebDriver failure.
**Excellent**: (1) a test fails only when its property breaks: 40 clean full-suite runs where 7 of
40 failed, and each mutant that breaks a property fails it every run; (2) a broken step after the
auth popup opens is one failed test, not a hook timeout and skipped tests. **Good enough**: no
new e2e scenario, no production or CI change.

## Issues, asks, UI impact

| Item | Arc | Claim check |
|---|---|---|
| #141 | a1 phase 1 | holds; the class is `store.rs:342`, :358, :372, :385, :398 and `config.rs:1076` |
| #136 | a1 phase 2 | line holds; the bound cannot see a blocking list check on this runtime |
| #98 | a1 phase 3 | holds, but the 60 s deadline is the active popup's; the request backstop is 660 s |
| Asks | none | the lane brief names none |

**UI impact**: none. The lane brief records one owner decision: "none: nothing a person sees
changes". No phase touches a surface a person sees.

## Assumptions

**Facts** (file:line and runs in `recon.md`): (F1) #141 is the fork-to-exec descriptor copy,
demonstrated (7/40 full runs, 0/40 serial, the holder check, the standalone reproducer). (F2) The
six sites above share the drop-then-probe shape. (F3) Case_24 on `multi_thread` passes a list
check that blocks its thread 2 s after the request; on the default current-thread runtime that
mutant fails the count 3/3; healthy gives ~95 checks. (F4) Closing a popup is a Deny; a Deny cools
the origin down 30 s; a popup that fails to build is a Deny at once (`windows.rs:300-307`).
(F5) `server/tests.rs:2107-2133` re-runs one test alone in a child process, inline, under
`#[cfg(unix)]`. (F6) `bun run test` runs no cargo test; CI runs `cargo test --locked` per crate,
`bun run lint:clippy`, and core's tests on Windows.

**Inferences**: (I1) the helper works on Windows; the Windows core lane is its first run. (I2)
the flake is Linux-only (user-space fork, then exec); unproven for macOS and Windows. (I3) WebDriver
runs locally on this host by the archived method.

**Asks** (unattended; assumption in force): (K1) `config.rs:1076` joins phase 1, since the helper
adds spawns to the parent test process and raises that check's exposure.

## Architecture & Implementation

**Phase 1 (#141).** Cause: a `flock` belongs to the open file description; another test's spawn
forks, and until its exec the child holds a copy of every descriptor, so a dropped lock reads as
held for ~20 µs. Fix the cause: probe in a process with no concurrent spawner.
- `core/src/lib.rs`: `#[cfg(test)] pub(crate) fn run_alone() -> bool` beside `ScopedPrestoHome`,
  lifted from `server/tests.rs:2109-2133`: the parent re-runs `current_exe() --exact <test>
  --test-threads=1` with a marker variable, asserts success and `1 passed`, and returns `true`;
  the child returns `false` and runs the body. *Review round 1:* `<test>` is the calling thread's
  name, which libtest sets to the test's path, so no call site can name another test.
- The four probing tests in `store.rs` and `config.rs:1063` open with `if crate::run_alone()
  { return; }`; their assertions stay exact. `server/tests.rs` calls the helper (one mechanism).
- **Not taken**: (B) the issue's `lock_exclusive_within` probe, a retry that passes a delayed
  release; `/proc/self/fd` (Linux-only); `#[serial]` on every spawner (each future one must know).

**Phase 2 (#136).** The invariant is **independent progress**: the update task keeps checking
while a list check is pending. Sub-second latency has no consequence (wake tick 15 min, interval
6 h); a stall for the fetch's whole timeout (30 s in production) does. Other workers of a
multi-thread runtime hide a blocked one, so the 250 ms bound saw only OS jitter.
- case_24 (`src-tauri/tests/verified_sites_feed.rs`): `#[tokio::test]` (current-thread, one
  comment line on why: any blocking in the pending check stops the update task outright); delete
  the worst-gap assertion; keep `checks.len() >= 20`, one request, list 4. *Review round 1:* the
  1 s sleep must also end before `FEED_TIMEOUT`, since a block that starts after 20 checks holds
  it up too.
- **Not taken**: a raised bound or a median (blind to blocking too); a paused clock (blocking
  freezes virtual time); a loop to 20 checks (passes once a partial block ends, as this does).
- **Residual (KL1)**: a healthy run fails only if starved ≥ ~800 ms of the 1 s window or 1 s past
  it (the old bound: 240 ms); a block that ends before 2 s and leaves 20 checks passes.

**Phase 3 (#98).** Two causes: `afterEach` awaits a request that only a decision ends, and one
shared origin lets test 1's cleanup Deny cool down test 2.
- `e2e-webdriver/auth-flow.spec.ts`: `afterEach` calls `closeExtraWindows(settingsHandle)`, then
  awaits `pendingProve` (the `verified-sites.spec.ts:146-152` order and comment); the Deny test
  gets its own `DENY_ORIGIN` (`ultra-honk.spec.ts:26-27`); `before` and `after` remove both.
- **Covers** a failure once `waitForNewWindow` has a handle. **Residual (KL2)**: a popup that
  appears after the hook's window snapshot leaves the request on that popup's 60 s timer.
- **Not taken**: `AbortController` or a detached promise end the client's wait, not the request.

## Security & Adversarial Considerations

Test-only: no trust boundary, credential, dependency, workflow or crate change; the `run_alone`
marker only picks which body runs in the test binary; every deny and cooldown assertion stays.

## Phases

### Phase 1: lock-release checks (#141) [✓]
Make the phase 1 changes above. Mutants, each reverted: leak a `try_clone()` of the lock file
(`std::mem::forget`) in `save_if_newer`, then in `acquire_config_write_lock`.
**Gate**: from `packages/presto/core`, `cargo test --locked` 40 times with 0 failures, and each
mutant fails its tests; from the root, `bun run lint:clippy`, `bun run lint`, `bun run test` exit 0.

### Phase 2: case_24 (#136) [✓]
Change case_24. Mutant, reverted: in `refresh`, send the request, then block the thread 2 s.
Restore `src-tauri/gen/schemas/` after each build.
**Gate**: from `packages/presto/src-tauri`, `cargo test --locked --test verified_sites_feed` exits
0, case_24 alone (`--exact`) is green 20 of 20, and the mutant fails 3 of 3; from the root,
`bun run lint:clippy` and `bun run lint` exit 0.

### Phase 3: auth-flow hooks (#98) [✓]
Change the spec. Run each case at retry 0 in a fresh app session (no carried cooldown), from
`packages/presto`: `bun run test:e2e:webdriver --spec ./e2e-webdriver/auth-flow.spec.ts` against a
`--features webdriver` app (the archived runner, `recon.md`). Runs: (a) old hooks + a `throw` after
`waitForActivePopup` in test 1; (b) new hooks + that mutant; (c) new hooks + a `throw` right after
`fireProveRequest` (KL2 evidence); (d) new hooks clean; (e) new hooks + a `throw` after
`waitForActivePopup` in the Deny test. Record the spec's wall-clock in (d) and on main.
**Gate**: from the root, `bun run lint` and `bun run test` exit 0; (a) shows the hook timeout and
test 2 skipped; (b) one failure, no hook timeout, test 2 green; (e) one failure, no hook failure;
(d) all green; (c) is recorded.
The gate is required: a host that cannot run it stops the arc, and no PR claims #98.

Each phase logs attempts in `lessons/phase-N.md` and its gate in `STATUS.md`.

## Delivery

One arc, one PR: a1 = phases 1–3 on `worktree-tests-1` against `main`, `code_review: off`, the
close-out as its final commits. No lanes: three small phases, one author.

## Post-implementation

1. **Codex fix loop** on the net diff from `80b562e`. Write the prompt to a new file from
   `mktemp`, run `~/.claude/skills/codex/scripts/run-codex.sh <prompt-file> <worktree> high read-only
   gpt-6.1-sol`, keep the `CODEX_DIR=` and `SESSION_ID=` lines it prints, and read `RESPONSE_FILE`.
   The prompt carries the diff, this plan, the adversarial ask, and verbatim: *"Report bugs and small, targeted improvements only. Do not propose speculative
   abstractions, extra configuration surface, new layers, or rewrites — the smallest change that
   fixes each real problem. If code works and is clear, leave it alone."* and *"Audit the comments
   for value per character. Flag any comment that narrates what the code visibly does, restates its
   line, references implementation plans / phases / reviews, or spends a paragraph where a sentence
   works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't
   have. Comments are permanent context every future reader, human or LLM, pays to re-read: they
   must be few, dense, and exact."* Verify each claim, fix, commit, log in `lessons/review.md`,
   then resume with a new follow-up file: `~/.claude/skills/codex/scripts/resume-codex.sh
   <session-id> <followup-file> <codex-dir> high`. Repeat until a round has nothing material;
   surface after 3 rounds. A fix adding state, a lifecycle, a protocol, a recovery policy or a
   contract is a plan change: stop for approval.
2. **Delivery**: push the branch, then `gh pr create` against `main`; body: what and why, gate
   results, the auth-flow wall-clock before and after, `Closes #141`, `Closes #136`, `Closes #98`,
   and last the line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
3. **Close-out** (final commits): merge `origin/main`, read what changed in `lessons.md` and
   `archive/index.md`; write `## Outcome` after the front matter (date, status, shipped with PR,
   `Known limits:`, `Open items:`, seeds retired); file KL1 and KL2 as `known-limit` issues closed
   as not planned (hypothesis, consequence, missing prerequisite, disposition, reopening
   condition); promote at most two lessons (flock + fork; multi-thread hides a blocked task),
   deduped and pruned to the 8 KiB budget; file any other open item as an issue, a weakness as a
   private draft advisory; delete `STATUS.md`; `git mv` the folder to `implementations-plan/archive/
   tests-1` in its own commit; one line in `archive/index.md`; no `index.md` row. If the merge
   brought source changes in a touched file, rerun that phase's gate. Push, then poll `gh pr checks`
   in bounded loops until the final head is green (the Windows core lane included, I1).
4. **Teardown**: once `git fetch -q origin main && git cat-file -e
   FETCH_HEAD:implementations-plan/archive/tests-1/plan.md` succeeds, `agent-worktree done tests-1
   --merged`; report its output; never force past a refusal.

## Audit

| Round | Verdict | Adopted | Rejected |
|---|---|---|---|
| Review 2: Codex, resumed | **clean** | both round 1 fixes and the thread-name helper verified (libtest 1.98 names test threads in serial runs too); converged in 2 rounds | none |
| Review 1: Opus (general-purpose) | findings: 1 | a call site naming a different existing test passed without its own body (latent, traced); its fix (match `test <name> ... ok`) reads the same wrong name, so the helper takes the name from the test's thread instead; all six sites proven by mutants, 40/40 runs | the case_24 rename nit: the name states the invariant the plan defines |
| Review 1: Codex (sol, high) | findings: 2 | case_24 passed a 2 s block that starts after 20 checks (demonstrated, 3/3): the 1 s sleep must end before `FEED_TIMEOUT` (both mutants then fail 3/3, healthy 20/20); the `fireProveRequest` comment named 60 s the server timeout (now the popup's deadline, 660 s queued) | none |
| Codex final, resumed | **approve** | the three conditions verified resolved; no new finding | none |
| Codex final (fresh, sol, high) | conditional approve | executable post-implementation (script paths, prompt files, trailer, footer, push and check the final head); run (e) for the Deny test; backstop 660 s | none |
| Codex 1 (sol, high) | conditional approve | case_24's invariant stated, KL1; #98 limited to failures after the popup opens, run (c), KL2; config's own mutant; WebDriver gate required, fresh app per run; I1/I2 stay inferences, the Windows lane gates delivery; size cut. Codex chose A (B passes a delayed release), current-thread (other cases keep multi-thread), close-then-await + origins | none |

## Seeds (draft; not run in this program)

- `/goal All phases of implementations-plan/tests-1/plan.md marked ✓, each backed by its gate in the transcript; the Codex loop converged (resumed pass with no new material finding quoted); PR against main open after the loop with the close-out commits; bun run test and bun run lint exit 0.`
- `/loop 15m Drive implementations-plan/tests-1 forward per plan.md: next unchecked phase, its gate, then Post-implementation; never merge.`

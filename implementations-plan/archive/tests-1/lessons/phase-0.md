# Phase 0: planning log

## Reproductions (2026-10-25, this host: Linux, 188 cores)

- **#141, full suite**: `cargo test --locked` in `packages/presto/core`, 40 runs: 7 failures, all at a
  lock-is-free check right after a save (`store.rs:342` ×3, `:372` ×3, `:385` ×1).
- **#141, serial control**: the store tests alone with `--test-threads=1`, 40 runs: 0 failures.
- **#141, instrumented**: a temporary diagnostic (reverted, never committed) at each failing check read
  `/proc/self/fd` and the children listed in `/proc/self/task/*/children`. Five failures in 17 runs:
  each time this process held no descriptor for the lock, one child existed, and the lock was free
  19–36 µs later. The child had exec'd before the scan, consistent with a copy held from fork to exec.
- **#141, standalone**: a scratch program (not committed) did 20,000 open-lock-drop-`try_lock`
  cycles. Alone: 0 held. Beside one thread spawning `/bin/true`: 30 and 42 held.
- **#136, mutants**: temporary edits, reverted. Healthy: multi-thread 99 checks, worst 11 ms;
  current-thread ~95 checks, worst 12 ms. Mutant A (block 2 s before the request): multi-thread
  keeps 99 checks and 11 ms, failing only at the request count; current-thread 1 check. Mutant B
  (send the request, then block 2 s): multi-thread **passes** (99 checks, worst 13 ms, 1 request);
  current-thread fails at the count, 6–7 checks, 3/3.
- Gotcha: a plain `cargo test` build of src-tauri rewrote `gen/schemas/linux-schema.json`; restored.

## Consults

(appended per round)
- **Codex round 1** (gpt-6.1-sol, high, session `01a170e7`): conditional approve. Conditions, all
  adopted: case_24's invariant stated as independent progress with its starvation residual (KL1);
  #98's guarantee limited to failures after the popup opens, with a run for a failure before it
  (KL2); a separate leak mutant for `config.rs`; the WebDriver gate is required, each run in a fresh
  app session; I1/I2 kept as inferences, the Windows core lane gates delivery; plan cut toward 150
  lines. Verified before adopting: `AUTH_QUEUE_BACKSTOP` is 660 s (`core/src/server.rs:71-76`; 60 s × (10 + 1); round 1 said 600, the final pass corrected it), a
  popup that fails to build resolves Deny (`src-tauri/src/windows.rs:300-307`). Codex chose A over
  the issue's bounded wait for #141 (it accepts a delayed release the exact check rejects).
- **Codex final pass** (fresh session `01a170ee`, sol, high): conditional approve. Adopted: the
  post-implementation steps now name the full script paths, prompt files and trailer lines, spell
  out the PR footer, and push and check the final head after the close-out (rerunning a touched
  phase's gate if the `origin/main` merge changed its files); run (e) injects the failure in the Deny
  test; the backstop is 660 s. Verified: `MAX_PENDING_ORIGINS` = 10 (`core/src/authorization.rs:223`);
  the comment at `src-tauri/src/windows.rs:302` still says 600 s (stale, out of scope).
- **Codex final, resumed**: approve; no remaining finding.

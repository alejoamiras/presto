# Arc 1 review loop (codex high, GPT-6 Astra)

Session `01a0f439-575c-7d60-b888-683d3a933e29`, over `77b5f50..HEAD` with `plan.md`, `recon.md` and
the phase lessons.

## Round 1 — "request changes"

| # | Finding | Verified | Disposition |
|---|---|---|---|
| 1 | **Major.** The schedule's file lock blocks without bound. A stopped holder (a suspended second instance) keeps it, so `record_checked` never returns and the launch result never reaches `act`; "Later" freezes the UI, since `respond_update_prompt` is a sync command on the main thread. | Yes: `lock_exclusive` is a blocking `flock` / `LockFileEx`, and the command is a plain `fn`. | **Fixed.** `file_lock::lock_exclusive_within` (non-blocking tries for up to `LOCK_WAIT` = 1 s, then `TimedOut`); the store's writes use it and fall back to the mirror as before. The config lock is unchanged. Tests `b14b` (both writes return `TimedOut` inside 10 s and the mirrors hold) and `c1b` (a held lock still lets the launch result reach `act`). 🧬 the unbounded lock → `b14b` red. B14 still serialises two writers (a 300 ms hold is inside the wait). |
| 2 | **Minor.** A negative smoke passes on any failure after the download *request*, a transport error included. | Yes: the oracle was the feed's request line plus a live N-1. | **Fixed** in all three scripts: N-1 must also log `signature verification failed` (minisign-verify 0.2.5, inside the plugin) or `does not match the signed size` (our check behind it). The published 1.1.3 N-1 logs the same text through the same `Update download failed: {e}` line and pins the same minisign-verify, so the release lanes keep working. |
| 3 | **Minor.** Health probes have no timeout, so a listener that accepts and never answers stalls every bounded loop. | Yes. | **Fixed:** `--max-time 5` on `health_version` and the dumps, `--max-time 3` in `stop_app`. |
| 4 | **Minor.** D1 tests `with_feed_timeout`, not that the plugin's fetch is what it wraps. | Yes. | **Fixed:** `update-wiring.test.ts` pins one `.check()` in `updater.rs`, inside `with_feed_timeout(updater.check()).await` in `fetch_feed`. 🧬 awaiting the fetch before wrapping it → red. |
| 5 | **Minor.** B15's "older snooze" fixture (`NOW − 2 h`) is expired at the evaluation time, so the active-but-shorter disk snooze is never exercised. | Yes. | **Fixed:** the fixture is `NOW + 2 h` (live, shorter than the session snooze). 🧬 taking the first live snooze instead of the latest-ending one → `b15` red. |
| 6 | **Comments.** A plan reference in `act`'s doc; "panic-free by lint" overstated (tokio's interval panics on a zero period); `InstallCaller::Auto`'s "must not kill a proof" contradicts the 30 min cap; a narrating comment in `write_private_atomic`. | Yes, all four. | **Fixed:** reference removed; the module doc says which panic the lints cannot see and `run_updates` documents the nonzero `tick`; `Auto` states the bounded wait; the narration is gone. |

🧬 R1-1, R1-4 and R1-5 each red, then green. Local gate after the fixes: core and src-tauri tests,
clippy (both feature sets), the Windows `cargo check`, the UI e2e, `bun run lint` and `bun run test`
exit 0 (a first run failed only on rustfmt's layout of `b14b`'s asserts). The Rust and script
changes mean the Phase 5 dispatches re-run on the fixed head.

## Round 2 — no blocker or major finding

| # | Finding | Verified | Disposition |
|---|---|---|---|
| 1 | **Minor.** The Windows negative oracle searched every file in the log directory, so an earlier run's refusal could vouch for a later transport failure. | Yes: `Select-String` over `$LogDir\*.log`. A fresh CI runner has no earlier logs, but a reused machine would. | **Fixed:** the mark is taken before N-1 launches, and only that launch's lines are searched (`Get-LaunchLog`, which fails on a rotation). |
| 2 | **Minor.** `try_lock_exclusive` on Windows read every `LockFileEx` failure as contention, so a real locking error became a 1 s retry and a misleading "another process holds the lock". | Yes. The function was test-only before round 1 made it production code. | **Fixed:** only `ERROR_LOCK_VIOLATION` is contention; any other error is returned. Checked with the Windows `cargo check`; the lock tests run on the Windows CI lane. |
| 3 | **Comment.** `LOCK_WAIT`'s "held for microseconds, so only a stopped holder reaches it" ignores the fsyncs inside the critical section. | Yes. | **Fixed:** the comment now states the purpose (bound how long "Later" can wait) without the timing claim. |

Also noted, no change: a failed snooze write is not re-flushed by a later successful write, so
another instance or a restart can prompt inside that snooze. That is the accepted session-only
fallback; the "until the next successful write" overstatement was in the review prompt, not in the code.

## Round 3 — converged

Verdict, verbatim: "No new material findings in the three fixes (high confidence)." It confirmed
`ERROR_LOCK_VIOLATION` as the only contention result under `LOCKFILE_FAIL_IMMEDIATELY` on a
synchronous handle, and that the log mark excludes earlier runs' refusals (an instance appending
after the mark would need a shared runner, which neither workflow uses).

The round-2 fixes change Windows-only code (the lock's error path, the `.ps1` negative oracle) and a
comment, so the three Windows smokes re-ran on `ea493f5`; the unix smokes from `a791d5c` stand,
since nothing they build or run changed.

## After delivery: B14 flaked on Windows (2026-10-01)

Re-run at arc 1's head `888cf99`, the unix smokes passed: positive 36853586007 (attempt 2, after a
DNS failure on the macOS runner), negative 36853589769, prompt 36853593040 and stall 36853596035.

Presto run 36854631149's Cert Trust (windows) job then failed `b14_the_file_lock_serialises_instances`.
The snoozer got `TimedOut: "another process holds the lock"`. Round 1's "a 300 ms hold is inside the
wait" left the writer only about 700 ms of the 1 s `LOCK_WAIT` for its resumed
`write_private_atomic` (private DACL, then rename), and a loaded runner exceeded that.
- Production behaviour is the designed one: a "Later" that times out holds for the session. The test
  was wrong to rely on the write's speed.
- **Fixed** with a test-only `lock_wait` on the store; B14's snoozer gets 30 s. `b14b` still pins the
  production 1 s bound.
- 🧬 With a 900 ms sleep in the writer's resumed hook, B14 without the override fails with CI's exact
  `TimedOut`, and passes with it. Dropping the file lock still turns B14 red.

Resumed review of `e815046`, verbatim: "No new material findings (high confidence); the override
separates serialization correctness from production's responsiveness policy."
- It confirmed that only the duration differs between test and production.
- B14 still proves serialization.
- Strictly, `b14b` proves a bounded failure (a 10 s deadline), not exactly 1 s.
- It advised against raising the production 1 s wait: a longer wait trades a rare session-only
  "Later" for longer freezes on the main thread.
- B14 passed on Windows at `6d6fa40` (presto.yml 36857595463).

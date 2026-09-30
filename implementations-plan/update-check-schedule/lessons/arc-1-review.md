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

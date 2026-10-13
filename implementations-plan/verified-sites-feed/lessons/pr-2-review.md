# PR 2: Codex fix loop

Scope: `git diff origin/main...HEAD` after PR 1 merged (`34784d2`), so PR 2 alone. The prompt carried
the plan, the decision ledger, the PR map, an adversarial ask (rollback and bricking, cache
poisoning, TOCTOU, network and schedule abuse, WebDriver hook leakage, the display boundary), the
seam with PR 1, duplication, drift, and the two rules verbatim. `history/1` was not yet on `main`;
the review was told so.

## Round 1 (2026-10-13, `gpt-6.1-sol`, high, fresh session)

Verdict: not ready, 1 material finding. Each claim was checked against the code before acting.

| # | Finding | Severity | Disposition |
|---|---|---|---|
| 1 | `save_if_newer` returned `WriteFailed` on a lock timeout (or a lock-file or directory error) before reading the disk, and `refresh` then swaps memory anyway (D18). Instance B holds the lock over a newer list 6 (which drops Gamma); A, at 4, fetches a replayed list 5 and adopts it, so Gamma's badge comes back although list 6 is on disk. This contradicts `WriteFailed`'s documented guarantee | important | **Accepted.** The lock result is built first, the disk is judged either way (under the lock when taken), and only then does a lock error become `WriteFailed`. New test `a_save_that_cannot_lock_still_defers_to_the_disk` (list 6 on disk gives `DiskNewer(6)`, a different list 5 gives `Equivocation`). Mutation: returning before the judgement fails it. |
| 2 | The E2E `tampered` document was signed over the `without` list, whose comment line names version 9 000 000 002, so the comment check alone would refuse it and the case did not isolate the signature | minor | **Accepted.** It is signed for its own version over its bytes minus the final newline; the served comment now names 9000000003. |
| 3 | The FIFO cases would hang, not fail, if `O_NONBLOCK` were dropped: cache reads run before any outer timeout | minor | **Accepted in part.** The core FIFO test runs on a thread with a 10 s deadline; dropping `O_NONBLOCK` now fails it in 10 s ("opening the FIFO blocked"). Not changed: src-tauri case 19, which would hang only until the job's `timeout-minutes` (30); a subprocess harness is more than the risk warrants. |
| 4 | Comments narrating their code: the directory-creation comment in `save_if_newer`, the spec's numbered steps | nit | **Partly accepted.** The first went with the restructure. The step comments stay: each states an expectation the assertions do not spell out, and the plan's mutation list cites the steps by number. |

Areas Codex reported as holding: the signature, version and bricking boundary (a wrong-key list at
2^53 − 1 fails verification; the floor comes only from signed bytes); selection and concurrency
under the lock and `adopt`'s re-judge; cache-file poisoning (forged, corrupt, oversized, FIFO,
non-regular, and a symlinked file is replaced rather than followed); network bounds and cadence
(HTTPS only, no redirects, 200 only, counted bytes, separate task from the updater, 15-minute retry
then 6 h); WebDriver leakage (feature-gated module, release scan before upload and outside signing,
fail-closed extraction, the teeth step); the display boundary (no new IPC or ACL, `textContent`);
reuse of PR 1's parser, verifier, scheduler and atomic writer.

Recorded limit, not a finding: replacing `~/.presto` with a directory symlink redirects the lock,
temp and cache files. That is the plan's accepted same-user directory-control threat.

## Round 2 (resumed session)

`VERDICT: ready` (high confidence), no new material finding. Codex confirmed:

- the lock guard still covers the re-read and the write when it is taken;
- the lock-free read on failure sees a complete old or new file, and it can only leave this
  instance behind the disk, never write without the lock or lower its version;
- case 1 is unchanged, since its 500 ms hold is inside the 1 s wait;
- the tampered document now keeps its version and comment, so the refusal comes from the
  signature.

It accepted leaving case 19 as it is and withdrew the step-comment nit. It raised one new nit, which
is fixed: the integration test's header claimed an outer deadline over every case, but cache loads
fall outside it. The loop converged in two rounds.

After the fixes, run with the local `history/1` stand-in:

- `cargo test --test verified_sites_feed`: 9 passed, case 25 ignored.
- The src-tauri suites all pass, and clippy is clean with and without `webdriver`.
- The full WebDriver suite passes 9 of 9 specs, 27 tests.
- The tampered mutant (signing the served bytes validly) still fails at step 3, with one failure
  and no "after all" timeout.

## Rounds 3 and 4 (resumed session, verification only)

- **Round 3, after `history/1` merged.** Codex confirmed that the only non-docs change since round 2
  was the header fix plus the two record files, and that record selection, `BUILT_IN` and the
  byte-for-byte test now select and embed record 1 as designed. `VERDICT: ready`.
- **Round 4, after the Windows CI fix (`2e79326`).** Codex confirmed:
  - only Windows' refused-connect case gets `0..4 s`;
  - the drip and hang cases keep `2..4 s`;
  - removing the request timeout still fails through the outer 10 s deadline.

  `VERDICT: ready`.

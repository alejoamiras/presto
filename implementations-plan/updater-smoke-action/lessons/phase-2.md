# Phase 2 — Runtime proof by dispatch, and the Codex fix loop

## Dispatch

Pushed `42b3638` (no PR). Dispatched unix `positive` (run 37022318517) and Windows `barrier`
(run 37022322243), both at `42b3638`.

## Codex fix loop (GPT-6 Astra, `high`, session `01a0fd16-03c0-7e41-aee3-ec98131ea755`)

### Round 1 — "No new material findings", three Lows, all accepted

1. K5 no longer proved both roles are scanned: the old test counted scans per build step, the new one
   per OS branch, so a scan wrapped in `if [ "$role" = n ]` passed. Codex proposed running the
   collection under command stubs; the smaller fix requires each branch's one scan at the branch body's
   top level. Codex's mutant now fails K5.
2. The stamp comment claimed MSYS converts arguments but not environment values. Wrong: MSYS2 converts
   environment values too (`MSYS2_ENV_CONV_EXCL` exists to exclude them). Reworded to the true reason:
   a relative path does not rely on MSYS conversion at all. The code was already right.
3. Narrating comments removed: the two workflows' "the key, builds and feed come from…" preambles, the
   duplicate "N carries the sentinel" line (the injection step already explains it), and the test
   helper's doc comment.

Comment- and test-only, so no re-dispatch.

### Round 2 — one Low, accepted

The indentation guard was not enough: an early `return 0` in one role's branch skips a top-level scan
and still passes. K5 now runs `build`'s collection block for every OS × role inside a function, with
stubs for `cp`, `n1_dmg` and a scanner that prints `scanned` and fails with 23; each run must print it
and exit 23. Mutants verified: the early return (Linux N-1) and a swallowed scan (`|| true`, Windows)
both fail it. Test-only, so no re-dispatch. Lesson: a text-shape assertion over shell code proves
layout, not execution; when the property is "this runs on every path", run the block.

### Round 3 — converged

Resumed on `849a74e` (harness soundness plus the net diff `87a4c8c..849a74e`). Verbatim reply:
"No new material findings".

## Pre-PR: CI's shellcheck

The repo lesson held again: local shellcheck 0.11 passed `ephemeral-updater.sh`, the
`koalaman/shellcheck:v0.9.0` image CI matches failed it on SC2015 (`[ a ] && [ b ] || usage`, correct
here because `usage` exits). Split into two `|| usage` guards; same behavior, so no re-dispatch.

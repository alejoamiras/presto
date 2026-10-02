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

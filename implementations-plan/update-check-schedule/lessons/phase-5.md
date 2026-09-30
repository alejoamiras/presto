# Phase 5 — Updater smokes

## What shipped

- `scripts/assert-update-schedule.ts` (+ tests): passes iff `update-schedule.json` is at most 4 KiB of
  UTF-8 JSON with `schema == 1`, `last_checked_by == --by` and an integer `last_checked_at` in
  `[--since − 5, now + 120]`; polls up to `--wait` seconds; exit 2 on bad arguments.
- `scripts/updater-feed-server.ts`: the handler is exported (`feedHandler`) so it can be tested over
  plain HTTP; `--stall-after <bytes>` sends a genuine prefix, logs `last_chunk_at=<unix>`, lifts Bun's
  idle timeout for that response, and never closes the body.
- `scripts/updater-smoke-modes.sh` (new, sourced by both unix scripts): `launch_app` (own process
  group, `NO_COLOR=1`), `stop_app`, `wait_for_line`, `wait_for_n1`, `write_snooze`,
  `assert_schedule_written_by_n`, `run_prompt_mode`, `run_stall_mode`.
- `updater-smoke.sh`, `updater-smoke-linux.sh`: allowlist `positive|negative|prompt|stall`; positive
  asserts N's own check; negative requires the N-1 first seen on `/health` to still answer at the end.
- `updater-smoke-windows.ps1`: an explicit case-sensitive allowlist (`positive`, `negative`,
  `barrier`, `copy-initiator`, `prompt`); negative requires `-N1Version`; `prompt` mode reads each
  launch's lines from the daily log at an offset recorded before the launch and fails on rotation;
  positive asserts N's own check.
- Workflows: `prompt` and `stall` in `smoke-updater-unix.yml` (plus `lsof` on Linux), `prompt` in
  `smoke-updater-windows.yml`. `release-contract.test.ts` pins each workflow's list and, new, each
  script's own list to it.

## Deviations from the plan's sketch

- **macOS reads per-launch stdout too**, not `log_dir()`: `updater-smoke.sh` launches the binary
  directly with its stdout redirected, exactly like Linux, so only Windows needs the offset read.
- **The snooze for "a lower version" is `0.0.0`**: the scripts do not receive N-1's version, and any
  version other than N proves the point (the snooze matches by equality).
- **Negative on macOS/Linux compares against the first version `/health` reported**, since those
  scripts are not given N-1's version; Windows already had `-N1Version` from both callers and now
  requires it in negative mode.
- **The stall prefix is 64 KiB** (`STALL_AFTER_BYTES`), well below any payload.
- **`stall` checks "same process" with `lsof` on the `/health` port**, so the Linux leg installs
  `lsof` explicitly.

## 🧬 Mutations

Local (bun rows fail their named test; harness rows make a scenario that must be refused pass):

| Row | Mutation | Evidence |
|---|---|---|
| L8 | accept a check written by any version | `written by N-1` fails |
| L8 | accept a check from before N answered | `stale` fails |
| L8 | accept any future timestamp | `future` fails |
| L8 | accept schema 2 | `schema 2 or none` fails |
| L8 | an off-by-one size cap | `oversized` fails |
| L8 | accept a fractional time | `garbage` fails |
| L8 | one read, no polling | CLI `waits for the app's write` fails |
| F10b (unit) | leave Bun's idle timeout on the stalled response | `keeps the connection open` fails (at ~4 s) |
| F10b (unit) | send more than the stall prefix | same test fails |
| L1 | the Windows workflow drops `prompt` / the unix one drops `stall` | the validator tests fail |
| L1 | the `.ps1` refuses `prompt`; the Linux script refuses `stall`; the macOS script refuses `prompt` | `its scripts accept exactly the modes it lets through` fails |
| L9 | `prompt` skips the 30 s no-re-prompt window | stub harness `prompt-bad` passes |
| F10b | `stall` drops the 60 s lower bound | stub harness `stall-early` passes |
| F10b | `stall` ignores a recorded `pending` | stub harness `stall-pending` passes |

17/17 red, then green. The stub harness (a Bun stand-in for the app answering `/health` and printing
the lines each mode waits for) lived in the session scratchpad; it is not committed.

CI: F10b's production-wiring mutant (`perform_update` downloads without `download_guarded`), on the
throwaway branch `update-check-schedule-mutant-f10b` (deleted afterwards): `smoke-updater-unix.yml
mode=stall` run 36779426165 → **red on both legs for the right reason**: the feed logged
`stalled … after 65536 bytes`, and the app never logged `Update download stalled; aborting` within
150 s (Linux and macOS).

## Gotchas

- **Bun checks idle sockets on a 4 s tick.** `idleTimeout: 1` closes a silent streamed body at about
  4 s, and the default 10 s at about 12 s. A test window shorter than the tick proves nothing: the
  first version (2.5 s) survived the mutation that removed `server.timeout(req, 0)`.
- **…and Bun's default per-test timeout is 5 s.** Widening the window to 8 s made the mutant red, but
  the green run was never repeated, so `23f3d54` shipped a test that times out on correct code. The
  arc review's gate caught it; the test now carries a 15 s timeout, and the mutant still fails on
  its assertion (`errored` at about 4 s), not on the timeout. Re-run green after every widening.
- **Bun drops a manual `content-length` on a `ReadableStream` body** and sends it chunked. The stall
  is the same for the client either way.
- **A process group does not exist until the child's `setpgrp` runs.** Checking `kill -0 -$pid`
  right after `&` reads "exited"; `launch_app` waits for the group before returning. The stub harness
  caught this on its first run.
- **macOS runs these scripts with bash 3.2**: `${arr[@]+"${arr[@]}"}` for a possibly empty array under
  `set -u`; checked with `bash -n` and a construct probe in the `bash:3.2` image.
- **PowerShell's `-notcontains` is case-insensitive**; the allowlist uses `-cnotcontains`.
- **`tracing-subscriber` 0.3.23 honours `NO_COLOR`**, so the per-launch stdout lines match plain
  patterns such as `Update prompt presented version=9\.9\.9$`.
- The `.ps1` was parse-checked and its log-offset functions exercised (12 cases, including rotation
  and a writer holding the file open) in the `mcr.microsoft.com/powershell` image; this host has no
  pwsh.

## Validation

- `bun run test`: exit 0 on the fixed head (it was not at `23f3d54`; see the timeout gotcha).
  `bun run lint:actions`: exit 0. Shellcheck 0.9.0 over `packages/presto/scripts/*.sh`: exit 0.
- CI, first pass on `23f3d54` (before the arc review's fixes), which proved the mechanics:
  - `smoke-updater-windows.yml`: positive 36779281703 ✓, negative 36779285628 ✓, prompt
    36779289465 ✓
  - `smoke-updater-unix.yml`: positive 36779293362 ✓, negative 36779297104 ✓, prompt 36779300676 ✓,
    stall 36779303917 ✓
- CI, gating pass on FIXED_HEAD (the review's fixes touch the Rust store and all three scripts):
  - `smoke-updater-windows.yml`: positive RUN_WP, negative RUN_WN, prompt RUN_WPR
  - `smoke-updater-unix.yml`: positive RUN_UP, negative RUN_UN, prompt RUN_UPR, stall RUN_US

# Pre-PR gates

## PR 1 (2026-10-13)

1. Tree clean; `origin/main` is still `3ebb19b`, the branch's base, so nothing to rebase.
2. Updater byte-identity: `git diff --exit-code origin/main...HEAD` over every untouched updater
   file in the change map (and `main.rs`, which PR 1 does not touch) is empty; in `presto.yml` the
   only changed line outside the new job is the status job's `results` list gaining
   `verified-sites-feed`.
3. No local path in the diff, no plan, phase or review reference in added comments, and the
   private-RPC grep is empty.
4. Locally, after each Codex round: `bun run lint`, `bun run test`, `bun run lint:actions`,
   `bun run lint:clippy`, `cargo test` for core, server and src-tauri (562 pass, 11 ignored), the
   Windows cross-check, shellcheck v0.9.0 and the round trip against the real `key.pub` (also once
   on an empty list): all green.
5. CI on the pushed branch (dispatch):
   - `e3627ad` (before the Codex fixes): Presto `38436665310` failed only in Cert Trust (windows),
     on Chocolatey's `504 Gateway Timeout` while installing NSIS; Verified Sites Feed and every
     other lane passed. Lint: Infra & Workflows `38436668649` passed.
   - `28b5d6f` (after the Codex fixes): Presto `38439479421` passed, every lane green; Lint: Infra
     & Workflows `38439483947` passed. Later commits touch only `implementations-plan/`.

## PR 2 (2026-10-13)

1. Tree clean. PR 1 landed as a squash, so `origin/main` was merged rather than rebased onto: at
   `34784d2`, then at `14c4085` (`history/1`). See `phase-10.md`.
2. Updater byte-identity against `origin/main`: the untouched updater files are identical. In
   `main.rs` the five functions differ by the one `verified_sites::spawn_production_refresh(app);`
   line. `git diff -U0` of `release-presto.yml` removes no line and adds one hunk, D22's step.
3. No local path in the diff, no plan, phase or review reference in added comments, and the
   private-RPC grep is empty.
4. Locally, on the real record:
   - `bun run test` (lint, typecheck, every unit suite), `bun run lint:actions` and
     `bun run lint:clippy`;
   - `cargo test`: core 394 + 5 (4 ignored); src-tauri lib 151, bin 12, `verified_sites_feed` 9
     plus case 25 live; server 13;
   - the Windows cross-check, and shellcheck v0.9.0 on the touched scripts;
   - the full WebDriver suite (9 specs, 27 tests) and `test:e2e:ui` (84);
   - `autostart-test.sh`, and the release and WebDriver build pair.

   The round trip runs in CI's Verified Sites Feed job.
5. CI on the pushed branch (dispatch):
   - `7a8dde1`, the first commit on the real record:
     - Presto `38480721422` failed only in Cert Trust (windows): the refused-connect timing bound,
       fixed in `2e79326` (`phase-10.md`). Every other lane passed, including Verified Sites Feed,
       Clippy, Rust Tests, Desktop UI Tests, all four WebDriver legs, Cert Trust (linux, macos)
       and Release Smoke.
     - Lint: Infra & Workflows `38480724284` passed.
     - Smoke Updater Unix (`positive`) `38480726761` passed.
     - Smoke Updater Windows (`positive`) `38480732482` passed.
   - `bd755ae`, after the timing fix: Presto `38482487240` failed in two jobs (`phase-10.md`):
     - Cert Trust (windows), the first run to reach presto-core's tests on Windows:
       `an_unwritable_directory_fails_the_save` expected an error where Windows reports no cache.
       The test was corrected in `34c65ff`; product code is unchanged.
     - Lint: `assert-no-test-hooks.test.ts` hit Bun's 5 s timeout once with `ar` still running.
       It took 690 ms in the run before, 699 ms in the run after, and passed 40 local runs.
   - `34c65ff`: Presto `38484443943` passed, all 22 jobs green, including Cert Trust (windows)
     (presto-core 377 passed, `verified_sites_feed` 9 passed), Verified Sites Feed and the four
     WebDriver legs.
   - Since `7a8dde1`, only test files and docs changed and no workflow file did, so the Lint: Infra
     & Workflows and both updater smoke results above still describe the app as it ships.

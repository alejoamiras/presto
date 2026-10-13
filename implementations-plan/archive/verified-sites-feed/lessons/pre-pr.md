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

# Phase 1 — Shared script, rewired workflows, tests

## Result

✓ 2026-10-02. `ephemeral-updater.sh` (keygen / stamp / build / feed) replaces the duplicated key,
build and feed steps in `smoke-updater-unix.yml` and `smoke-updater-windows.yml`; the Windows barrier
injection stays a workflow step between the two builds.

Gate: the three touched test files 40/40; `bun run lint` exit 0 (two pre-existing warnings, both outside
this change); `bun run test` exit 0 (presto scripts 152, three of them new); `bun run lint:actions`
exit 0. Local round trip: keygen → stamp 9.9.9 → `RUNNER_OS=Linux feed` over a dummy AppImage signed
with the throwaway key: `verify: all 1 platform(s) bound to the signed envelope`; the same feed signed
with a second key and verified against the stamped pubkey exits nonzero. Stamped files restored by
`git checkout`.

## Attempts and gotchas

- `keygen`'s first draft set `trap 'rm -rf "$dir"' EXIT` on a `local dir`: the trap fires after the
  function returns, the local is gone, and `set -u` turns cleanup into an unbound-variable failure.
  The key directory is a global for that reason.
- The contract tests were mutation-checked: dropping the Linux branch's `assert-no-test-hooks.sh`
  fails K5; pointing Windows `feed` at `n1` fails the order test. Both reverted.
- A `[["a","b"], …]` tuple list loses its element types without `as const`: `bun test` passed but
  `bun run test`'s typecheck failed (`string | undefined`). Run the full gate, not only the file.
- The worktree guard refuses compound shell commands and `sed` programs that read files; splice with
  a scratch script or Edit instead.

## Not proven here

Payload signatures and every OS × role build path: Phase 2's dispatch.

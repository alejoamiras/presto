# Phase 5 — real-bb CI job, HTTP smoke, `PRESTO_HOME` + `--port`

Date: 2026-09-08.

## What landed

- `core/tests/ultra_honk_real_bb.rs` (`#[ignore]`, in-process router + the real bb): native proof,
  public inputs, and `--write_vk` key byte-equal to the WASM fixtures for both circuits; tampered
  proof fails `bb verify`; every target bb proves verifies natively; the starknet pair pinned as bb's
  own refusal; a key from another circuit never yields a verifying proof (F-21).
- `packages/presto/scripts/ultra-honk-smoke.ts` (+ unit test of the pure parts): the first real HTTP
  consumer of `/prove/ultra-honk` — posts both fixtures with and without the key, checks bytes against
  the WASM references, verifies with the native bb. `PRESTO_URL` / `BB_BINARY_PATH`.
- `PRESTO_HOME` override in core (`config.json`, `versions/`, `data/` under one directory) so parallel
  runs never share state; `server::start_on(state, port)`; `presto-server --port <n>` only with an
  isolated `PRESTO_HOME` (the default port needs none).
- `.github/actions/start-headless-presto` (launch a built binary on a port with a private home, poll
  `/health`, print the pid for the caller's `if: always()` kill) and the `ultra-honk-real-bb` job in
  `presto.yml`: cargo real-bb suite, then the smoke over HTTP against one instance, then a second
  instance on another port to prove two servers coexist; wired into `presto-status`. Filters:
  `headless_server` and `sdk_integration` pick up the fixtures, the smoke script, and the action.

## Findings

- **bb 5.2.0 refuses the starknet targets.** `-t starknet` / `starknet-no-zk` are in bb's own
  accepted list but `bb prove` exits 1 with `Invalid proof system settings: oracle_hash_type=
  'starknet', … ipa_accumulation=0`. Six of the eight targets prove; the plan's "all 8" became "the
  six bb proves, plus a pinned refusal" (F-25). The route keeps passing the strings through: a bb
  that adds them needs no Presto change, and the pinned test flips to say so.
- The `ExitStatus` `Display` already reads `exit status: 1`, so the wrapped message said
  `(exit exit status: 1)`; now `bb prove failed (exit status: 1)`.

## Notes

- `pgrep -f` / `pkill -f` match the invoking shell's own argv when the pattern appears in the
  command line, so a cleanup like `pkill -f 'presto-server --port 59901'` killed the tool shell
  (exit 144) before the registry row was removed. Use the `[p]resto-server` bracket trick or a pid
  file; the start-headless-presto action kills by pid for the same reason.
- The sandbox refuses compound shell commands that feed runtime variables or heredocs into files
  inside the worktree; multi-line file edits go through the Edit tool, probes as plain commands.
- The Windows cross-check regenerates `src-tauri/gen/schemas/windows-schema.json` with `set_theme`
  allow/deny entries that main never committed (the other schemas have them). Reverted here, not
  ours to fix in this arc; worth a one-line hygiene commit on main.
- Ports: the local smoke used 59901 registered in `~/.agents/ports.md` and released after the run;
  CI uses 59900/59901 on the runner with `${{ runner.temp }}/presto-home-{a,b}`.

## Gate

`bun run lint:actions` ✓ · `bun run lint:rust` ✓ · `bun run lint:clippy` ✓ · core `cargo test
--locked` (287) ✓ · server (122 + 10 + 1) ✓ · src-tauri (13 + …) ✓ · `cargo check --target
x86_64-pc-windows-gnu --lib` ✓ · `bun run --cwd packages/presto test:unit` (105) ✓ ·
`bun run test:scripts` (125) ✓ · `cargo test --test ultra_honk_real_bb -- --ignored` with
`BB_BINARY_PATH` (4) ✓ · local smoke against `presto-server --port 59901 --allow-all` with a private
`PRESTO_HOME`: 4/4 ok ✓ · `presto.yml` dispatch on the branch (run 34173789777, commit 5fbeac9): `UltraHonk Real bb` ✓ — https://github.com/alejoamiras/presto/actions/runs/34173789777

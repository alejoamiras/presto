# Phase 2 — `bb.rs`: `run_bb`, `VerifierTarget`, `prove_ultra_honk`

Date: 2026-09-07.

## What landed

- `core/src/bb/ultra_honk.rs` (child module of `bb`): `VerifierTarget` (8 bb spellings, `FromStr` /
  `Display`, `is_deterministic`, truncated `UnknownVerifierTarget`), `UltraHonkJob` / `UltraHonkOutput`,
  `prove_ultra_honk(_with_timeout)`, a private `UltraHonkWorkspace` (0600 `bytecode.gz`, `witness.gz`,
  optional `vk`), `build_ultra_honk_command` (`-k` with a client key, `--write_vk` without), and
  output validation (`public_inputs` may be empty; `vk` read only on the `--write_vk` path; every read
  capped and file-named on error).
- `bb.rs`: `run_bb(cmd, timeout)` now holds the spawn-under-containment → capped drain → wait →
  `finish` → log → `require_success` sequence once; `prove_with_timeout` calls it. `finish_command`
  holds the thread-cap/kill_on_drop/containment tail shared by both builders. `BbError` alias. The
  fake-bb harness moved to a `#[cfg(all(test, unix))] pub(super) mod test_support` so both suites use it.

## Verified here

- 7 new unit tests (targets round trip, output length rules, argv shape for `-k` vs `--write_vk`,
  0600 workspace files, fake-bb success incl. key-only-when-computed, empty vs missing vs misaligned
  public inputs, empty key, timeout). Core: 273 pass. Clippy (`--all-targets`, 25/80) clean on all
  three crates without any `#[expect]` in the new code. Windows `cargo check` clean.

## Notes

- A child module can use the parent's private items (`super::read_capped` etc.), so the sibling
  scheme needed no visibility changes in `bb.rs`.
- `read_capped` on a missing file surfaces as an anonymous "No such file or directory"; the route's
  error must name the output, hence `read_output`.
- Local clippy on the desktop crate needs the frontend bundles (`bun run --cwd packages/presto
  frontend:build`) and the bb sidecar (`prebuild`) present, plus the empty Windows sidecar placeholder
  for the cross-target check — the same three preconditions CI's `setup-presto` provides.

## Gate

`bun run lint:rust` ✓ · `bun run lint:clippy` ✓ · `cargo test --locked` (core, 273) ✓ ·
`cargo check --target x86_64-pc-windows-gnu --lib` (src-tauri) ✓.

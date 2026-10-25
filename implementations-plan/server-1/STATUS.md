# server-1 status

- 2026-10-25 recon done: two demonstrated path leaks (`download_failed` via tar, official-route `prove_failed` via tempfile).
- 2026-10-25 decision: both leaks in arc a1, because the lane's invariant names every client-facing error body.
- 2026-10-25 plan drafted; sent to the Codex audit.
- 2026-10-25 Codex round 1: conditional approve; 5 findings adopted; prove failures now fixed text on both routes.
- 2026-10-25 Codex final fresh pass: conditional approve; 4 adopted, 1 rejected (macOS filter); resumed check: approve.
- 2026-10-25 gate passed under auto-continue: no owner ask on a surface arc 1 touches.
- 2026-10-25 phase 1 gate green: core cargo test 440 passed (one rerun: `verified_sites::store` `a_directory_never_blocks_and_fails_the_save` failed its `lock_is_free` check under full-suite load, passed alone 3/3 and on the rerun; not this lane's code); lint:clippy, bun run lint, bun run test exit 0; gated live 404 test ran and passed.
- 2026-10-25 phase 2 gate green: core cargo test 441 passed; lint:clippy, bun run lint, bun run test exit 0; src-tauri windows-gnu --lib check and core --tests windows-gnu check exit 0.
- 2026-10-25 phase 3 gate green: bun run lint exit 0.
- 2026-10-25 codex loop: round 1 two Low findings fixed (1fab632); merged origin/main (de828ab); round 2 clean.

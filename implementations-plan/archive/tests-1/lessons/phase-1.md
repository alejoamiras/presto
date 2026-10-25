# Phase 1: lock-release checks (#141)

- `run_alone(module_path!(), "<fn>")` in `core/src/lib.rs`, lifted from the inline copy in
  `server/tests.rs`, which now calls it. Applied to the four probing store tests and the config
  lock test. `cargo fmt` wraps the longer calls over five lines.
- Mutant 1 (reverted): `std::mem::forget(f.try_clone())` of the lock file in `save_if_newer`. The
  four probed store tests failed, each inside its child process; the other nine store tests passed.
- Mutant 2 (reverted): the same leak in `acquire_config_write_lock`. The config test failed at
  "acquire must succeed once the lock is released". Ran with `--exact`: with the leak, the blocking
  `concurrent_saves_under_lock_never_corrupt` would wait forever.
- Name check (reverted): a mistyped test name makes the child run 0 tests, and the parent fails.
- Gate: `cargo test --locked` from `packages/presto/core`, 40 runs, 0 failures (baseline 7 of 40).
  `bun run lint:clippy`, `bun run lint` and `bun run test` exit 0.
- A clippy build of src-tauri rewrote `gen/schemas/linux-schema.json` again; restored.

# Phase 2: case_24 (#136)

- case_24 runs on the default current-thread runtime, with a one-line comment on why. The worst-gap
  assertion is gone. With it gone, the stub only needed a count, so the `Vec<Instant>` became an
  `AtomicU32`.
- Gate: `cargo test --locked --test verified_sites_feed` from `packages/presto/src-tauri`: 9
  passed, 1 ignored (the live case). case_24 alone with `--exact`: 20 of 20 green.
- Mutant (reverted): `refresh` sends the request (a 100 ms timeout on the fetch), then blocks its
  thread for 2 s. case_24 failed 3 of 3 with "only 7 update checks". Before this phase, the same
  mutant passed the multi-thread test (`lessons/phase-0.md`).
- `bun run lint:clippy` and `bun run lint` exit 0. `gen/schemas/linux-schema.json` restored after
  each build.

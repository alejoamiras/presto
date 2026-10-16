# Phase 4: client channel wiring

- The plugin's `Update` cannot be built outside the plugin (private fields), so the check-time
  gate is a pure `gate(feed, pubkey, channel, current, state_path)`: Layer A, `admits`, Layer B.
  `verify_and_gate` only adapts the plugin's update and logs the refusal.
- Act and present time take a `FoundUpdate` (version + kind) because the update itself has moved
  into the pending slot by then. `decision.rs` gained the pure `after_admission` (act time) and
  `skip_presenting` (present time, which replaces `should_present` and the busy/snooze mapping that
  `main.rs` used to do). A present-time refusal clears the slot: the leave's own `slot.clear()` can
  run before `act_on`'s `slot.set`.
- `tauri-plugin-updater` 2.11.0 builds the returned `Update` with `timeout: None`
  (`updater.rs:595`), so `RC_ENDPOINT_TIMEOUT` bounds the two feed requests only. The artifact
  download stays under our 60 s stall watchdog.
- The two channel commands are async: the join check waits up to 90 s, and a sync command would
  hold the main thread for that long. Their effects live in `channel_change.rs` behind a
  `ChannelEffects` trait, so the tests can run without an `AppHandle`. `try_mutate_config_at` lets
  a refused change save nothing and gives the tests a temporary path.
- Clippy's `cognitive_complexity` (25) counts `tracing` macros heavily. `verify_and_gate` moved its
  logging to `GateRefusal::log`, `FoundUpdate::admission` logs its own refusal, and `present` calls
  `clear_pending`.
- Mutations, 11 of 11 red. Each of the following fails its named test:
  - act-time admission ignored, and present-time admission ignored (decision tests);
  - RC endpoints reversed;
  - the gate skipping admission (the RC fixture test);
  - install reading the cached channel (`install_admission_reads_config_from_disk`);
  - effects before the save result;
  - an unchanged channel still checking;
  - the join using `try_send`.

  Three wiring mutations fail the wiring guards: install admission removed, `act_on` without admission, and an environment variable read.
- The `try_send` mutation first hung `join_sends_one_live_manual_check_and_returns_its_result` for
  over an hour. Its helper awaited a request from a queue the test itself held open. The helper now
  waits at most 5 s, and the mutation fails both join tests in 6 s.
- The admission-order guards now use `expectInOrder` (first occurrences, in order) inside their own
  `describe`. The file's single `describe` had passed Biome's 80-line limit. Swapping `admits` and
  the floor check in `gate` fails the guard.
- Generated schemas: the Windows cross-check regenerates `windows-schema.json`, and arc 1 had
  committed it without `set_developer_mode`. This arc commits it with both commands, matching the
  other schemas.
- Merging main (#120's `bun.lock`) makes `build.rs` refuse with F-012 until
  `bun run --cwd packages/presto frontend:build` reruns: a local rebuild, not a code change.
- Gate after merging arc 1's head (4f17ca7):
  - cargo test: core 411 passed, server 14, src-tauri 187 (4, 0 and 8 ignored);
  - `bun run lint:clippy` and clippy `--features webdriver`;
  - `bun run test`, `bun run lint:actions`;
  - `cargo check --target x86_64-pc-windows-gnu --lib`.

  All pass.

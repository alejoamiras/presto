# Phase 1 — `update_schedule` in presto-core

## What shipped

- `core/src/update_schedule.rs`: the constants, `check_due` / `effective_last_check` / `is_snoozed`,
  `ScheduleStore` (the file, both mirrors, the in-process mutex and the cross-process file lock),
  `InstallGate` / `InstallClaim` / `run_claimed`, `StallWatch`, `wait_until_idle`, `install_opts`,
  `download_guarded` and `run_updates`, under the panic-free `deny` lints.
- `core/src/file_lock.rs`: the flock / `LockFileEx` body moved out of `config.rs`;
  `acquire_config_write_lock` delegates to it, and every existing config test passes unmodified.
- `updater_state::write_private_atomic`: `write_state`'s body, moved mechanically (same file fsync →
  rename → directory fsync order) plus a `#[cfg(test)]` directory-fsync failure switch.
- `HeadlessState::prover_idle()`.

## Deviations from the plan's sketch

- `run_claimed` is an `async fn` instead of `fn -> impl Future` with an `async move` block (clippy
  `manual_async_fn`). The semantics are identical: an `async fn` moves every argument into its future,
  so dropping the future before its first poll still drops the claim. F2's before-first-poll case pins it.
- `ScheduleStore::snoozed_until(candidate, now) -> Option<u64>` was added, so the `Update snoozed` log
  line can name the covering snooze's end; `is_snoozed` delegates to it. It reports the latest end
  among the covering snoozes (the file's or the mirror's).
- The store uses `parking_lot` mutexes, which do not poison, so there is no `into_inner` recovery.

## 🧬 Mutations (47/47 red, then green)

Runner: apply one mutation, run the named tests with `cargo test --lib`, and require a test failure,
or a compile or clippy error where the type system or lint is the guard. Then restore and verify the
restore byte for byte.

| Row | Mutation | Failing test(s) |
|---|---|---|
| A2 | `>=` → `>` in `check_due` | `a1_a2_a4_due_boundaries` |
| A3 | drop the future-dated branch | `a3_clock_moved_back_makes_a_check_due` |
| A5 | record at 0 (drop the `now == 0` guard) | `a5_a_clock_stuck_at_zero_…`, `a5_extreme_values_…` |
| A6 | mirror = max(mirror, now) | `a6_a_success_replaces_a_future_dated_mirror` |
| A7 | skip the future-dated file-value drop | `a7_future_dated_unwritable_file_defers_to_the_mirror` |
| A7b / C6b | honour a foreign writer's timestamp | `a7b_…`, `a7c_…`, `c6b_…` |
| A7c | filter the snooze by writer too | `a7c_a_foreign_timestamp_is_ignored_but_its_snooze_applies` |
| A8 | drop the stretch bound | `a8_snooze_matches_one_version_for_at_most_a_day` |
| B2b | remove the 4 KiB cap; also the cap and the read limit together | `b2b_valid_content_past_the_size_cap_is_rejected` |
| B4 | drop `O_NONBLOCK` | `b4_a_fifo_without_a_writer_neither_blocks_nor_loads` (no hang: the rescue open fires) |
| B5 | drop the regular-file check | `b5_a_fifo_holding_valid_json_is_rejected_…` |
| B6 | add `deny_unknown_fields` | `b6_unknown_fields_are_ignored` |
| B8 | write only the field being recorded | `b8_…`, `b9_concurrent_records_keep_both_fields` |
| B10 | set the mirror after the write | `b10_a_failed_write_still_holds_in_the_mirror` |
| B12 | writer = `CARGO_PKG_VERSION` | `b12_the_writer_is_the_injected_app_version` |
| B14 | drop the file lock | `b14_the_file_lock_serialises_instances` |
| B15 | "file snooze, else mirror" precedence | `b15_a_failed_snooze_write_applies_…` |
| B15' | report the first covering snooze's end, not the latest | `b15_…` (after adding the "another instance snoozed later" case; it survived before) |
| B16 | directory fsync before the rename | `b16_the_directory_fsync_follows_the_rename` |
| C1 | launch check conditional on due-ness | `c1_the_launch_check_always_runs` |
| C2 | `interval` instead of `interval_at` | `c2_a_failed_launch_check_is_not_retried_at_once` |
| C4 | a monotonic `sleep(6 h)` loop | `c4_a_wall_clock_jump_across_sleep_triggers_the_next_tick` |
| C5 | record failed checks too | `c5_…`, `c10_a_successful_click_postpones_…` |
| C7 | record after `act` | `c7_the_timestamp_is_recorded_before_act_runs` |
| C8 | two concurrent fetches per request | `c8_slow_checks_never_overlap` |
| C9 | serve a click during the launch delay | `c9_a_click_waits_for_the_running_check` |
| C10 | reverse the `select!` branch order | `c10_a_due_tick_outranks_a_queued_click` |
| C10' | a click never counts as a check | `c10_a_successful_click_postpones_…` |
| C11 | skip the closed-reply check | `c11_a_click_the_tray_abandoned_…` |
| C12 | an abandoned click becomes `Scheduled` | `c12_a_click_abandoned_during_its_check_stays_manual` |
| C13a | `None => return` | compile error E0069: the `Infallible` return type rejects an exit |
| C13b | drop the `if manual_open` guard | `c13_losing_every_sender_neither_stops_nor_spins_the_loop` |
| C15 | call `check` anyway while busy | `c15_while_installing_requests_skip_the_fetch_…` |
| F1 | a second claim succeeds | `f1_one_claim_at_a_time` |
| F2 | the claim is forgotten (never released) | `f2_f5_a_claimed_future_releases_the_gate_…` |
| F5 | the claim is released before the install runs | `f2_f5_…` ("held while pending") |
| F7 | remove the watchdog from `download_guarded` | `f7_…`, `f9_a_chunk_at_fifty_nine_seconds_resets_the_watchdog` |
| F8 | a total timeout instead of an idle one | `f8_a_slow_but_progressing_download_…`, `f9_…` |
| F11a | skip the idle wait | `f11_an_automatic_install_waits_for_a_real_proof_to_finish` |
| F11b | `install_opts(Auto)` returns no-wait | `f11_…`, `f14_only_automatic_installs_wait_for_the_prover` |
| F11c | keep the watchdog running into the wait | `f11_…` (the watchdog fires during the 5 min wait) |
| F12 | idle once any permit is free (the tray flag's semantics) | `prover_idle_tracks_every_admitted_proof` |
| F13 | remove the 30 min cap | `f13_continuous_proving_delays_…` |
| J1 | insert an `unwrap` | clippy `unwrap_used` |

## Gotchas

- **Paused-time tests race exact tick instants.** Under `start_paused`, a test that wakes on the same
  instant as the loop's tick races it. Assertions must sit strictly past tick times. The tick
  schedule starts when the launch check *completes*, so a 10 s launch check moves every tick by 10 s.
- **A spinning mutant freezes paused time.** Auto-advance needs every task idle, so a spin probe must
  not await a timer. C13 counts loop wake-ups across 1,000 `yield_now`s instead; `mpsc::recv`'s
  cooperative budget returns control even to a spinning loop.
- **`config_write_lock_is_exclusive_and_released_on_drop` failed once in the full core suite**, then
  passed alone and in 6/6 further full runs. It predates this work; the likely cause is a fork window
  in the process-spawning bb tests inheriting the lock fd (moderate confidence). Not chased: the new
  `file_lock` extraction is mechanical.
- **Local src-tauri builds on this machine needed system packages**: CI's `setup-presto` list
  (`libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libssl-dev libgtk-3-dev`) for
  clippy, and `gcc-mingw-w64-x86-64 g++-mingw-w64-x86-64 nasm` for the Windows `cargo check` (`ring`
  and `aws-lc` compile C in their build scripts). The worktree also needs `bun run --cwd packages/presto
  prebuild` (the bb sidecar), `frontend:build`, and an empty `binaries/bb-x86_64-pc-windows-gnu.exe`.

## Validation

- `cargo test --locked --manifest-path packages/presto/core/Cargo.toml`: 356 passed (exit 0).
- `bun run lint:rust`: exit 0. `bun run lint:clippy` (core, server, src-tauri): exit 0.
- `cargo check --target x86_64-pc-windows-gnu --lib` from `src-tauri`: exit 0.

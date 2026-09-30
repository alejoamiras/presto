# Phase 2 — Classify-only check, record-then-act, the slot, snooze

## What shipped

- `updater.rs`: `check_for_update(app) -> CheckOutcome` only fetches (30 s `FEED_TIMEOUT`) and
  classifies; `spawn_install(app, claim, update, opts, after)` is the only way to reach the now
  private `perform_update`, whose bytes come through core's `download_guarded` (the chunk callback
  touches the `StallWatch`). `update_schedule_path()`, the manual-channel types, and the main-thread
  record for the presenter guard.
- `updater/decision.rs` (new, pure, panic-free lints): `OutcomeKind`, `CheckMode`, `mode_and_reply`,
  `Decision`, `decide`, `should_present`, `prompt_action`, `presenter_allowed`, `ManualCheckResult`,
  `Presentation`.
- `commands.rs`: the slot gains `clear()` and a non-consuming `match_displayed`;
  `commands/update_prompt.rs` (new) holds `handle_later`, `handle_update_now` and the shared
  `prompt_url` / `prompt_version`, which `Reprompt::navigate` now uses too. `respond_update_prompt`
  keeps its signature and reads the store and gate through `try_state`.
- `main.rs`: the managed `Arc<ScheduleStore>` (memory-only under `webdriver`), `Arc<InstallGate>` and
  manual sender in the `Builder` chain; the update task runs `run_updates` with `check_for_update` and
  `act` (`decide`, then clear / hold snoozed / present / install through a claim).
- `windows.rs`: `show_update_prompt_window(..., focus) -> bool` refuses the main thread, then opens,
  re-points, focuses, or leaves the prompt alone per `prompt_action`.
- `scripts/update-wiring.test.ts` (new): H7, G7's lexical tripwire, and "installs only through
  `spawn_install`".

## Deviations from the plan's sketch

- The pure decision logic lives in a submodule, `updater/decision.rs`, rather than inline in
  `updater.rs`, so the plugin-facing file keeps only I/O.
- `CheckOutcome::Available` boxes its `VerifiedUpdate` (clippy `large_enum_variant`: 640 bytes against
  unit variants).
- A manual check that ends in `Rejected` replies `Failed` ("Couldn't check — try again"): the feed
  answered, but with nothing the app may install, so "Up to date" would be the wrong claim.
- The `Reprompt::navigate` warning now reads "refusing an answer for a version that is not pending",
  because "Later" reaches it too. No smoke or test matches the old text.
- The static guard also pins that `perform_update` is private and called only from `spawn_install`,
  which is what makes "every install holds the gate" true.

## 🧬 Mutations (20/20 red, then green)

| Row | Mutation | Failing test(s) |
|---|---|---|
| D1 | remove the feed timeout | `d1_a_silent_feed_fails_at_thirty_seconds` |
| E1 | a refused candidate leaves the slot unchanged | `e_decide_rows` |
| E3 | route manual like scheduled | `e_decide_rows`, `e_decide_invariants` |
| E4 | an expired manual check auto-installs | `e_decide_rows`, `e_decide_invariants` |
| E6 | ignore the snooze for auto-install | `e_decide_rows` |
| E9 | treat Launch as manual | `e_decide_rows`, `e_decide_invariants`, `h5_…` |
| E10 | ignore busy for an available update | `e_decide_rows`, `e_decide_invariants` |
| E11 | `clear()` keeps the item | `e11_a_cleared_slot_installs_nothing` |
| E12 | keep the highest version | `e12_the_latest_fetch_wins_not_the_highest_version` |
| F3 | take before claiming | `f3_update_now_while_installing_leaves_the_pending_item` |
| G1 | present while an install runs | `g1_g3_presenting_rechecks_the_gate_and_the_snooze` |
| G4 | always re-point an open prompt | `g4_the_version_on_screen_is_never_reloaded` |
| G5 | re-point without URL-encoding | `g5_repointing_keeps_the_origin_and_path_and_encodes_the_query` |
| G7 | allow the main thread | `g7_the_presenter_refuses_the_main_thread` |
| G7 (static) | drop the presenter's main-thread guard | `update-wiring.test.ts` G7 |
| H2 | snooze whatever version the prompt claims | `h2_later_on_another_version_reprompts_and_writes_nothing` |
| H5 | a snooze covers any version (core) | `h5_a_restart_keeps_the_snooze_for_that_version_only` |
| H7 | manage the store in `setup` / take the gate as command `State` | `update-wiring.test.ts` H7 (both) |
| — | `perform_update` made `pub` | `update-wiring.test.ts` "installs are reachable only through spawn_install" |

## Gotchas

- **`cargo clippy --features webdriver` rewrites `src-tauri/gen/schemas/*.json`** to include the
  `webdriver:default` permission. Restore those three files before committing; they are build
  output of the feature build, not part of the change.
- **Clippy's `too_many_lines` applies to tests here**, and rustfmt spreads a decision table over three
  lines a row. A `#[rustfmt::skip]` on the rows keeps one row per line; the table was also split into
  rows and invariants.
- The plugin's `Update::download` calls `on_chunk` per streamed chunk, then verifies the signature
  synchronously before resolving, so the watchdog measures real network progress.

## Validation

- `cargo test` core (356) and src-tauri (lib 142, bin 10): exit 0.
- `bun run lint:rust`, `bun run lint:clippy`, and clippy with `--features webdriver`: exit 0.
- `cargo check --target x86_64-pc-windows-gnu --lib`: exit 0.
- `bun run --cwd packages/presto test:e2e:ui`: 84 passed, `update-prompt.spec.ts` unedited (H8).
- `bun run test`: exit 0 (250 pass, 1 skip).

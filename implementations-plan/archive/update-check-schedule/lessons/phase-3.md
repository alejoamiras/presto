# Phase 3 — Tray "Check for Updates…"

## What shipped

- `src-tauri/src/update_menu.rs` (+ `update_menu/tests.rs`): `ManualCheck<S: LabelSink, U: UiThread>`
  with states Idle / Checking / UpToDate / Failed / Installing and their labels; single-flight
  `click` on the main thread writes "Checking…" inline, `try_send`s a reply channel to the update
  task, and waits for the answer on Tauri's runtime with the 90 s ceiling; every later write
  (result, 5 min revert) is posted to the main thread and re-checks the click generation inside the
  posted closure. `TauriUi` posts with `run_on_main_thread` and spawns with
  `tauri::async_runtime::spawn`; tests use a queue they drain by hand. The module denies the
  panic lints (J1).
- `tray.rs`: `Entry` + `menu_layout(dev_mode, has_check)`; `build_tray_menu` follows the layout and
  takes `check_updates: Option<&MenuItem>`. Without the item, both variants keep the order they
  shipped with.
- `main.rs`: `tray_action(id)` + `on_tray_menu(app, id)` (the single dispatch for native menu
  events); the item is created once in `setup_desktop` iff `should_poll_for_updates()` (now
  evaluated once and passed to `start_background_tasks`) or the WebDriver feature; a creation
  failure is logged and the tray is built without it; the controller is managed next to it and
  the dev-mode rebuild passes the same item.
- `update-wiring.test.ts` I12: no Tokio spawn or `Handle::current()` in `update_menu.rs` or
  `on_tray_menu`, and the wait goes through `tauri::async_runtime::spawn`.

## Deviations from the plan's sketch

- **`menu_layout` returns `Vec<Entry>`, not `Vec<&'static str>`**, so `build_tray_menu`'s match over
  it is exhaustive and a layout entry without an item cannot compile.
- **`UiThread` also spawns** the reply wait, so the tests run the whole controller on a paused
  Tokio clock without a Tauri runtime.
- **`State::after(Presented)` is Idle with no revert scheduled** (a shown prompt is its own answer);
  `i6b` pins that no revert is queued.
- **I13 is a pure `tray_action(id)` table**; `on_tray_menu` only executes the action.
- In WebDriver builds the manual receiver is still dropped here, so a click reads "Couldn't check";
  Phase 4 replaces that with the stub-backed update task.

## 🧬 Mutations

| Row | Mutation | Evidence |
|---|---|---|
| I3 | drop the single-flight check | `i3_a_click_during_a_check_sends_nothing` fails |
| I5 | await the answer without the 90 s timeout | `i5_no_answer_fails_at_90s_and_expires_the_request` fails |
| I7 | check the generation before posting the revert, not inside it | `i7_a_stale_revert_never_overwrites_a_new_click` fails |
| I9 | put the item after Quit | `i9_check_for_updates_sits_below_the_version_line` fails |
| I13 | drop the update item's route | `i13_tray_ids_route_to_their_actions` fails |
| I12 | `tokio::spawn` in `on_tray_menu` | `I12: the tray click path never reaches for Tokio's runtime` fails |
| J1 | an `unwrap` in `update_menu.rs` | clippy `unwrap_used` at the module's `deny` |

7/7 red, then green (`scratchpad p3_mut.py`, not committed).

## Gotchas

- **A test helper that drops the request receiver turns every later click into "Couldn't check"**:
  the first `i7` draft failed on its own fixture, not the code. The helper now returns the receiver,
  and `i7` answers `UpToDate` so a closed channel (which reads Failed) cannot pass for a result.

## Validation

The Phase 2 gate on the Phase 3 tree: core tests, src-tauri tests, `bun run lint:rust`,
`bun run lint:clippy`, clippy with `--features webdriver`, the Windows `cargo check`,
`test:e2e:ui` and `bun run test` — all exit 0.

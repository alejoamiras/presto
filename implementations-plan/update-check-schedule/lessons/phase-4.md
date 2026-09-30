# Phase 4 — WebDriver tray E2E and static guard

## What shipped

- `src-tauri/src/e2e_tray.rs` (`#[cfg(feature = "webdriver")] mod e2e_tray;`): every test hook.
  - A stub check that never finds an update. Tray requests pop queued outcomes, each held until the
    driver releases it; launch and scheduled checks answer `UpToDate` and are counted separately.
  - `start()` runs the real update task (`run_updates`, the real `act`, the real controller) on that
    stub, always, so the WebDriver tray item never talks to a closed channel.
  - When `PRESTO_E2E_TRAY_REPORT` is set, a driver posts `on_tray_menu(app, "check_updates")` to
    the main thread (the production dispatch a native click reaches), polls the native item's
    `text()` / `is_enabled()` with a deadline per state, and writes
    `{steps, stub_calls, launch_calls, menu_has_item, complete}` via a rename.
  - The 2 s revert (`REVERT`) replaces the production 5 min only in these builds.
- `main.rs`: `act`, `act_on`, `hold_snoozed` and `install_automatically` now compile in WebDriver
  builds; `present` has a WebDriver variant that logs an error and shows nothing;
  `spawn_update_task` takes the check as a closure (production passes `check_for_update`);
  `build_tray` also returns the menu, which only the driver uses.
- `e2e-webdriver/tray-update.spec.ts`, listed before `autostart.spec.ts`: asserts the exact
  `(label, enabled)` sequence, `complete`, `stub_calls == 2` (the click during "Checking…" reached
  no check), `launch_calls == 1` and `menu_has_item`.
- `_e2e-webdriver.yml`: the Launch step exports the report path (and persists it for the spec); a
  step asserts the binary under test contains `PRESTO_E2E_TRAY_REPORT` (K5's teeth); the failure
  upload includes the report; the prompt guard's comment now says the feed check, not the update
  task, is compiled out.
- `scripts/assert-no-test-hooks.sh` (+ test): fails if a binary, a bundle directory or an AppImage's
  extracted payload contains `PRESTO_E2E_TRAY_REPORT`, and on a missing path. Both smoke workflows
  run it after every N-1 and N build: the macOS `.app`, the Linux AppImage, and on Windows the raw
  `Presto.exe` the LZMA-compressed installer packs.
- `scripts/webdriver-only-hooks.test.ts`: K1–K5 and L3.

## Deviations from the plan's sketch

- **K5 on Windows scans `target/release/Presto.exe`**, not the installer: NSIS compresses its
  payload, so the installer's bytes cannot show the string either way.
- **L3 is also static**: the guard requires `wdio.conf.ts` to list every `*.spec.ts` in
  `e2e-webdriver/`, the tray spec right before autostart, besides the CI log grep.
- **The report carries `launch_calls` and `complete`**, so a driver that stopped early fails on
  more than the step list.

## 🧬 Mutations

| Row | Mutation | Evidence |
|---|---|---|
| I14 | drop the `check_updates` route (release `--features webdriver` build, run locally) | the spec fails; the report shows the item never leaving Idle and `stub_calls: 0` |
| K5 | a WebDriver build scanned as if shipped | `assert-no-test-hooks.sh` on the local release WebDriver binary exits 1 |
| K1 | delete the cfg on `mod e2e_tray` | K1 fails |
| K2 | ungate `e2e_tray::REVERT`; the report variable in `tray.rs` | K2 fails, both times |
| K3 | `default = ["webdriver"]` | K3 fails |
| K4 | `--features webdriver` in `release-presto.yml` | K4 fails |
| K5 | the Windows N build skips the scan | K5 fails |
| L3 | the tray spec left out of wdio's list | L3 fails |

9/9 red, then green (`scratchpad p4_mut.py`, `p4_i14.py`, not committed).

## Gotchas

- **A raw `cargo build --features webdriver` serves the built frontend** because
  `tauri.conf.json` has no `devUrl`, so the release variant runs locally under Xvfb with only
  `bun run frontend:build` first. The local runner gives the app and wdio a private `HOME`, so no
  spec touches the real `~/.presto`.
- **Menu item getters block on the main thread**, so the driver reads them in `spawn_blocking`.
- The clippy `--features webdriver` build regenerates `gen/schemas` with the plugin's permission;
  restore them before committing.

## Validation

- Local: the tray spec green against `cargo build --release --features webdriver` (the production
  menu variant, L4) under Xvfb; the report
  `{"complete":true,"launch_calls":1,"menu_has_item":true,"steps":[…6 states…],"stub_calls":2}`.
- Local gate: core and src-tauri tests, `bun run lint:rust`, `bun run lint:clippy`, clippy with `--features webdriver`, the Windows `cargo check`, `test:e2e:ui`, `bun run test` and `bun run lint:actions` — all exit 0.
- CI: CI_RESULT.

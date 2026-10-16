# Phase 3: desktop backend (picker, commands, tray, popup DTO)

## Arc 2 (2026-10-16)

- **Branch:** `custom-bb-desktop`, rebased onto `main` `eb4b751` (#143, the arc 1 squash).
  - `df9fd6b` P3: the four Settings-only commands, the picker, the tray line, the popup DTO.
  - `e3114ce`: `plan.md` marks P1 and P2 landed at `eb4b751`.
  - `d8ecf59` P4: the Settings banner and card, the popup line, the popup at 400×360.
  - `aa3388a` P5: the T13 WebDriver spec and the docs (SECURITY_MODEL decision 8, the READMEs,
    `CLAUDE.md`).
- **Approved table:** no deviation. There are four commands and four `allow-*` grants, all on
  `settings.json`, plus `get_pending_auth.custom_label`. `tauri-plugin-dialog` is registered in Rust
  with no `dialog:*` grant (T10 pins it).
  - Changes inside existing commands only: `set_developer_mode` calls
    `custom_bb::developer_mode_saved`, which drops the candidate when developer mode turns off.
  - The auth popup grew from 400×300 to 400×360, as the plan allows ("grow the popup").
- **`tauri-plugin-dialog` vetting:** complete, recorded below under "Supply chain".
  - `=2.7.3`, with `tauri-plugin-fs` held at 2.5.2 and `rfd` 0.16.0.
  - Each `.crate` is identical to its upstream tag: 39/39, 94/94 and 54/54 files.
  - The transitive list is below.
- **Uncommitted on purpose:** `implementations-plan/custom-bb/ux/`, the local UX mockups, which are
  never committed.

## Arc 2 Codex fix loop

The first round-1 thread (`01a1457a-9c96-7853-a9b6-4bed1f2a1bb6`) died with the session that
started it, before answering. Round 1 ran again from the same prompt.

**Round 1** (`gpt-6.1-sol`, high, session `01a14584-82c4-7750-8f23-e24f0f328390`): **reject**,
findings 1–2 blocking. Each was traced against the code; all five are accepted and fixed.

| # | Severity | Claim | Disposition |
|---|---|---|---|
| 1 | blocking | `custom_bb_save` snapshots the candidate before the rehash and never looks at the slot again, so developer mode going off and on, or a new review, during the rehash still lets the snapshot's pin through. | Fixed: the pin is written by `commit`, which checks the slot under the config lock (same tested candidate, same bytes) and clears it with the write. A review that answers after developer mode went off stores nothing (read the mode first, then take the slot: a save holds the config lock while it takes the slot, so the reverse order would deadlock). Test: `a_save_commits_only_the_candidate_still_under_review`. |
| 2 | blocking | A test run started with developer mode on spawns the file after the mode went off during the rehash. | Fixed: core's `test_run` takes an `admit` closure asked after the rehash and right before the spawn; the desktop's checks developer mode and that the slot still holds these bytes. `Withdrawn` otherwise, and the file never runs (core test extended). |
| 3 | should-fix | `closeCustomBbPanels` hides the review, but a `custom_bb_review` still in flight reopens it when it answers, and developer mode back on shows the stale review. | Fixed: a `reviews` ticket, bumped when the panels close; an older review's answer is dropped. Playwright test added, and it fails without the bump. |
| 4 | should-fix | A versions rebuild reads the custom line, builds, then publishes after a newer custom summary has, so the tray regresses to the old line; tooltips can publish out of order the same way. | Fixed: `TrayMenu` posts every read-build-publish sequence to the main thread (`rebuild`, `set_custom`, and the status line through the new `set_status`), so they apply in posting order with no lock held across a setter. |
| 5 | should-fix | T13's last assertion accepts any response without `x-presto-bb`, an error included, and the unreleased label sends the app through a real download attempt. | Fixed: the label is the one the test run suggests, which is the bundled version since the file is the sidecar, so the custom route outranks the bundled shortcut while pinned and, after the stop, the same request must be a 200 official proof of the fixture's bytes with no header. |

Codex also confirmed, read-only: the ACL grants, the popup size pins and the contrast pairs.

**Round 2** (same session): **reject**, one blocking. It confirmed the round-1 fixes close their
findings, that no caller nests the slot before the config lock, that the headless server never calls
`test_run`, and that the locked Tauri runtime runs a main-thread task inline from the main thread
and queues it from any other, during `setup` included. Each remaining item is a hole the fixes
left; all five are accepted and fixed.

| # | Severity | Claim | Disposition |
|---|---|---|---|
| 1 | blocking | `admit` returns a bool and releases its locks before the probe creates its workspace and spawns, so developer mode can go off in that gap and the file still starts. | Fixed: `admit` returns a guard (`Option<G>`) the core holds across the spawn and drops before the wait; `run_version_probe` split into the synchronous `start_version_probe` and the async `finish_version_probe`. The desktop's guard is the config read guard plus the slot guard (config before slot). |
| 2 | should-fix | The review's config read guard drops at its semicolon, so a developer-mode-off save can land between the read and the slot write. | Fixed: the read guard lives for as long as the slot is held. |
| 3 | should-fix | `commit` clears the slot inside the mutation closure, before persistence; a failed save loses the candidate while the UI still shows its review, and a retry fails with "Review the file again". | Fixed: the closure only checks; the slot is cleared after `try_mutate_config_at` returns Ok. The test adds a failed save (a path under a missing directory) that keeps the review and then succeeds on a retry. |
| 4 | should-fix | The ticket check runs before posting: an older task can pass it, get descheduled, and post after a newer one, so the main thread applies the stale summary last. | Fixed: `set_custom` takes a `fresh` closure evaluated on the main thread right before applying. |
| 5 | nit | A test doc comment restating its name and assertions; a three-line T13 comment. | Deleted; shortened to two lines. |

## Supply chain: `tauri-plugin-dialog` (2026-10-16)

**Pinned `=2.7.3`, not the newest 2.x.** 2.8.0 and later require `tauri ^2.12`. Taking any of
them would have bumped `tauri` (2.11.5 → 2.12.4) and eight sibling `tauri-*` crates to releases
published 2026-10-14, two days old, which fails the 7-day rule. 2.7.3 (2026-08-31) requires
`tauri ^2.10`, so the tree's 2.11.5 stays.

**`tauri-plugin-fs` was held at 2.5.2.** Left alone, Cargo resolved the dialog's `^2.5.2` to fs
2.7.1, which requires `tauri ^2.12` and so dragged the same bump in. I resolved once with a
temporary `tauri-plugin-fs = "=2.5.2"` line, then dropped it; the lock keeps 2.5.2. A
`cargo update` that touches fs must keep it until tauri itself moves.

**The lock adds three crates and changes nothing else:**

| Crate | Version | Published | Upstream tag → commit | `.crate` vs tag |
|---|---|---|---|---|
| `tauri-plugin-dialog` | 2.7.3 | 2026-08-31 | `tauri-apps/plugins-workspace` `dialog-v2.7.3` → `6aa2854f` | 39/39 files identical |
| `tauri-plugin-fs` | 2.5.2 | 2026-08-31 | same repo, `fs-v2.5.2` → `6aa2854f` | 94/94 identical |
| `rfd` | 0.16.0 | 2025-11-24 | `PolyMeilex/rfd` `0.16.0` → `5d32eec3` | 54/54 identical |

- **Method:**
  - the `.crate` from Cargo's cache, its SHA-256 equal to `Cargo.lock`'s checksum;
  - each file compared with the tag's tarball (the `.crate`'s `Cargo.toml.orig` against the repo's
    `Cargo.toml`; the normalized `Cargo.toml` and `.cargo_vcs_info.json` skipped);
  - each `.cargo_vcs_info.json` commit equal to the tag's commit (`gh api …/commits/<tag>`).
- **Already in the lock**, so no new code: every other transitive crate. That covers:
  - dialog: `log`, `raw-window-handle`, `serde`, `serde_json`, `tauri`, `thiserror`, `url`, and
    `tauri-plugin` (build);
  - `rfd`:
    - Linux: GTK3 (`glib-sys`, `gobject-sys`, `gtk-sys`); no xdg-portal or D-Bus stack;
    - macOS: `objc2`, `objc2-app-kit`, `objc2-foundation`, `objc2-core-foundation`, `block2`,
      `dispatch2`;
    - Windows: `windows-sys`;
    - wasm only: `js-sys`, `wasm-bindgen`, `wasm-bindgen-futures`, `web-sys`;
  - fs: `anyhow`, `dunce`, `glob`, `percent-encoding`, `serde_repr`, and at build time `schemars`,
    `tauri-utils`, `toml`.
- **Build scripts:** the dialog and fs crates run `tauri-plugin`'s build helper, which generates
  their permission files. The plugin is registered with no `dialog:*` or `fs:*` grant, so none of
  its JS commands is reachable. `tauri-plugin-fs` comes in as a dependency and is never registered.
- **Injected script:** the plugin adds `init-iife.js` to every webview. It rebinds `window.alert`
  and `window.confirm` to `plugin:dialog|message` and `plugin:dialog|confirm`. Without a grant
  those calls are refused, and no Presto page calls either function, so behaviour is unchanged.
  Removing the injection would mean `rfd` directly, which the plan rejected.

## Shape (2026-10-16)

- `src-tauri/src/custom_bb.rs` (lib) holds:
  - the four commands; the in-memory `Candidate` (inspection plus "tested");
  - `Status` and its `State` (off, in use, changed, missing, unsafe, overridden, revoked);
  - `tray_summary`, `popup_label`, and `check_save` (T8).
- **Order in `check_save`:** developer mode → override → reviewed bytes → tested → label → rehash.
  The rehash is a closure that runs last, so T8 proves a refusal does no I/O.
- **The tray:** `TrayMenu` (bin) is shared by the versions rebuild and the custom bb rebuild, so
  each keeps the other's lines.
  - `TrayText` holds the status text and the suffix; `on_status` builds the tooltip from it.
  - The custom bb callback rehashes on `spawn_blocking`, applies only the newest result (a ticket
    counter), and skips an unchanged summary. No lock is held across the menu setters.
  - `set_developer_mode` and the custom bb save fire it, as does launch when a pin is in effect.
- **Tray placement:** the line goes right below the version line, so the update item moves down
  one place while a custom bb is set (mockup A). `i9` still pins the layout without the line, and
  `the_custom_bb_line_sits_below_the_version_line` (T9) pins it with the line.
- **The picker seam:** `TestPick(PathBuf)` is managed state. Only `e2e_tray::start` manages it,
  from `PRESTO_E2E_CUSTOM_BB_PATH`. The shipped binary carries the type, never the variable's
  name.
- **The DTO:** `get_pending_auth` takes `ConfigState` to compute `custom_label`. Its JS arguments
  are unchanged. The popup polls every second, so the line follows a stop or a re-pin within a
  second.
- **Generated schemas:** keep main's convention. `desktop-schema.json` and `acl-manifests.json`
  come from a plain build (no `webdriver:default`), and `linux-schema.json` from a
  `--features webdriver` build (with it). The diff is additions only.

## Gate (2026-10-16, Linux x86_64)

- `cargo test --locked` (src-tauri): 168 lib, 13 bin, plus the integration suites. T8, T9, the
  DTO test and the tray summary pass.
- `bun run --cwd packages/presto test:unit`: 219 passed. One provisioning-key test timed out at
  5 s while the release build ran beside it; it passed 6/6 on its own.
- `bun run lint`, `bun run lint:clippy`, and clippy with `--features webdriver`.
- The Windows cross-check: `--lib --bins`.
- `tauri-trust-boundary.test.ts` (T10: 26 handlers, no `dialog:` grant) and
  `webdriver-only-hooks.test.ts`.
- `cargo build --release --locked`, then `assert-no-test-hooks.sh`: no test hooks.

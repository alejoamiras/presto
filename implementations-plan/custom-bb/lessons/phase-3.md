# Phase 3: desktop backend (picker, commands, tray, popup DTO)

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

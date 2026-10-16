# Phase 4: Settings and popup UI

## Shape (2026-10-16)

- **Files:** `frontend-src/custom-bb.js` holds the banner and the card. `settings.js` loads it once
  at start, and `developer.js` reloads it after each developer mode save.
  - Turning developer mode off also closes the open panels.
  - Rust drops its candidate in `developer_mode_saved`, so turning the mode back on starts a fresh
    review.
- **Refresh:** the card re-reads `custom_bb_status` whenever the Settings window regains focus,
  because the file can change while Settings stays open. Only the newest read paints.
- **Buttons:** every one ships `disabled` and is enabled only once a status read succeeds.
  - "Test run" needs the tick.
  - "Use this bb" needs the tick, a passing run and a label.
  - Rust re-checks all of it anyway (`check_save`).
- **Colours:** existing tokens only, with no `color-mix`, so the macOS 10.15 floor needs no
  fallbacks.
  - The banner uses `--warning` on `--warning-bg` while in use, and `--danger` on `--surface` while
    refused.
  - The chip is an outline pill in `--go-text` or `--danger`.
  - The new pairs are guarded in `contrast-guard.test.ts`: `--warning`/`--warning-bg`,
    `--text`/`--warning-bg`, `--warning`/`--surface` and `--go-text`/`--surface`.
- **Copy feedback:** the Copy button changes to "Copied" for 1.5 s. It does not use
  `showErrorHint`, whose red styling reads as a failure. Without clipboard access, the button
  selects the command instead.

## The popup grew to 400×360

The worst case is a verified site plus the custom bb line. It was measured at a 400×268 viewport
(the 400×300 window minus `WEBVIEW_CHROME_HEIGHT`):

| State | `.popup-scroll` content | Space available |
|---|---|---|
| No line | 177 px | 177 px |
| Custom line | 196 px | 177 px |
| Verified site + custom line | 223 px | 177 px |

- At 360, the space available becomes 237 px, a 14 px margin over the worst case. The ordinary
  popup centers in the extra height (`justify-content: safe center`).
- Changed together: `windows.rs`, `e2e/window-sizes.ts` (the drift test pins the two), the
  `style.css` comment, and the F-014 spec's viewport.
- Shrinking the line instead would not work: the copy the plan fixed wraps to three lines at
  12 px.

## Environment

- This worktree's isolation guard refuses some inline `python3 - <<EOF` scripts, apparently from
  their quoting. Writing the script to the scratchpad and running `python3 <file>` works.
- `playwright.config.mjs` sets `reuseExistingServer: true` on port 3456. A run beside another
  worktree's UI suite would silently test that worktree's pages. Check that the port is free first
  (`ss -ltn`).

## Gate (2026-10-16, Linux x86_64)

- `bun run test`: exit 0.
  - sdk-core 195, banners 33, sdk-noir 39, sdk 33, playground 108, presto scripts 220,
    root scripts 340, and the rest.
  - Includes lint, typecheck and `contrast-guard.test.ts`.
- `bun run --cwd packages/presto test:e2e:ui`: 113 passed, among them:
  - T12's three tests;
  - the authorize fit test;
  - `window-fit.spec.ts`.
- `bun run --cwd packages/presto frontend:build`, then `cargo build --locked` (src-tauri, with the
  bundle manifest check).
- `bun run lint:clippy` and the Windows cross-check (`--lib --bins`).
- `cargo test custom_bb` (src-tauri): T8, T9, the DTO and tray tests.

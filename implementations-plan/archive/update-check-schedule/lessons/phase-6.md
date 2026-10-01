# Phase 6 — Docs and follow-ups

## Arc 1 (commit 698b8c8)

- `CLAUDE.md`: the Presto bullet gains the 6 h wall-clock checks, the 24 h snooze and install
  safety; the CI bullet describes both ephemeral smokes and their modes; the Rust and TS counts.
- `UPDATER_TESTING.md`: the schedule assertion, the negative smoke's "N-1 still answers /health",
  and the "Ephemeral smokes (manual dispatch)" section with the `prompt` and `stall` modes.

## Arc 2

- `CLAUDE.md`: the tray **Check for Updates…** item in the Presto bullet; the hook scan in both
  smokes and `webdriver-only-hooks.test.ts` in the CI bullet; counts recounted from the tree
  (Rust 551, 540 non-ignored on Linux: core 362/4 ignored, server 13, src-tauri 176/7; presto
  scripts 145 TS tests; 26 WebDriver tests), recounted after the review loops.
- `UPDATER_TESTING.md`: the ephemeral smokes' hook scan.
- `follow-ups.md`: consolidating the ephemeral smoke setup; the update-scheduling residuals under
  accepted risk.

## Not carried

- **The same-length tamper follow-up (L7) was dropped: its premise was wrong.** The plan assumed
  the appended byte is rejected by our signed-size check before signature verification matters.
  Every negative smoke on this branch (unix `36781824472` on both legs, Windows `36779285628`) logged
  `Update download failed: The signature verification failed`: the plugin verifies the minisign
  signature inside `download()`, before our size check ever sees the bytes. The negative smokes
  already prove signature verification, and their oracle now requires that line (or the size
  refusal behind it).
- **No new lane for the matrix's uncovered items.** Real sleep, a click on a prompt in a release
  binary and a Wayland tray need hardware or a desktop session no hosted runner provides; they are
  listed under accepted residual risk instead.

## Validation

`bun run test` and `bun run lint:actions` exit 0; the private-RPC grep
(`git grep -nE '/k/[0-9a-f]{32,}'`) prints nothing.

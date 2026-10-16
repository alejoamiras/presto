# Phase 2: developer mode in Settings

- **Layout (A2).** Advanced sits in its own section after General, as the approved mockup draws it.
  At the real 500×648 viewport the default view is 676 px tall: it overflows by 28 px, all of it the
  folded row. The fit test now measures the page with the Advanced section hidden (must fit, speed
  wholly visible) and requires the summary to be reachable by scrolling.
- **No empty custom-bb element.** An empty container proves nothing and adds a gap; custom-bb adds
  its block inside `#developer-section` when it stacks on this arc. Until arc 2 adds the channel row,
  developer mode on shows a heading alone, which never ships: no release runs from a partial stack (O1).
- **Contract pins for custom-bb** (director request): `effective_channel_table` loads a block with an
  unknown `custom_bb` field and keeps `rc` (mutation `deny_unknown_fields` → red), and
  `developer_off_resets_block_in_same_save` compares the whole struct with `Default`, so a field
  added later must reset with it once its own test sets it.
- **wdio order.** `webdriver-only-hooks.test.ts` pinned the tray spec directly before autostart; it
  now pins the last three as tray-update, developer, autostart.
- **Generated schemas.** `src-tauri/gen/schemas/*` are committed and regenerate on build; they carry
  the new permission.
- Local gate: src-tauri tests, UI suite 90, `bun run test` 0, `bun run lint` 0. The WebDriver lane
  runs through the `presto.yml` dispatch.

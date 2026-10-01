# Real tray click in a release binary (owner request, after delivery)

The owner asked for an end-to-end test of "tray click finds an update → prompt opens" in a release
build. The WebDriver E2E calls `on_tray_menu` from a stub-backed WebDriver build. The prompt smoke
presented from the launch check, not from a click.

## What was found

- **libappindicator exports the tray menu on the session bus** as `com.canonical.dbusmenu` under
  `/org/ayatana/NotificationItem/<id>/Menu`, with or without a tray host.
- A local probe (Xvfb plus a private `dbus-run-session`, the release `--features webdriver` binary)
  sent `Event(id, "clicked")`. The item went "Checking…" (disabled), "Up to date", then back to
  idle: the real GTK → muda → `on_tray_menu` path, with no hook involved.
- **`busctl` reads a negative argument as an option.** `GetLayout iias 0 -1 0` failed with
  `invalid option -- '1'` until a `--` was placed before the arguments.

## What was added

- `scripts/tray-menu.ts`: `list | dump | click <label> | wait <label> <s>` over `busctl --json`. It
  clicks only if exactly one app exports a tray menu, and only an enabled item with that exact label.
- **The `prompt` smoke, step 2b (Linux; `TRAY_CLICK=1` in `updater-smoke-linux.sh`).**
  - Setup: N-1 is running with N snoozed, and has shown no prompt for 30 s.
  - The step clicks **Check for Updates…**, then requires `Update prompt presented version=N` and
    the item back at its idle label.
  - Only a manual check presents under a snooze, and no manual check ran before the click, so the
    line is caused by the click.
  - macOS logs the step as skipped.
- `tray-menu.test.ts` (4 tests):
  - the real captured layout;
  - submenus and malformed replies;
  - exactly one exported menu;
  - the smoke's click label equals the app's `State::Idle` label, and the Linux script enables
    the step.
- 🧬 Each mutant turned the suite red:
  - absent `enabled` read as false;
  - submenus ignored;
  - first of several menus accepted;
  - a stale label in the smoke;
  - `TRAY_CLICK=1` removed.

## Validation

- `bun run test`, `bun run lint:actions` and shellcheck 0.9 (CI's version) exit 0.
- CI: `smoke-updater-unix.yml` prompt 36794011299 at `f4b9d94` ✓.
  - **Linux:** logged `PROMPT 2b/3`, then `clicked "Check for Updates…"`. Its middle
    `Update prompt presented version=9.9.9` (00:13:53) is the snoozed launch's click-driven prompt,
    in the shipped AppImage with stalonetray as the host.
  - **macOS:** logged the step as skipped.

## Unrelated finding: the test bundle's Linux HTTP leg

Packaged E2E (linux, http) failed twice (36790281980 and its re-run) on
`checkAztecNode (live node)`. The leg sets `AZTEC_NODE_URL=http://localhost:8080`. Since #73, the
test pins happy-dom's page to `https://playground.presto.build/`, and happy-dom then blocks the http
request before it is sent. A CORS-open local stub received no request from the test. The break
belongs to `main`.

The owner chose to fix it in arc 2 (2026-10-01) rather than in a separate PR, because the plan's
bundle gate needs a green run at arc 2's head. The test now probes an `http:` node from the dev
server's origin (`http://localhost:5173/`) and anything else from the deployed playground's.
- 🧬 Against the local http stub, the unfixed test fails and the fixed one passes (12/12).
- The https path keeps its URL.

## Unrelated flake: Windows `auth-flow.spec.ts` Deny

Presto run 36796778684 at `3b6835c` failed the Windows dev WebDriver leg. `tray-update.spec.ts`
passed there. The failing test was the Deny case, where `waitForNewWindow` returned null.
- The test before it called `removeOriginViaUI`, which read `.origin-item` as `[]` 500 ms after a
  refresh and removed nothing.
- The origin stayed approved, so the Deny test's prove opened no consent window.
- This stack does not touch the auth flow or its helpers, and the same suite passed at `1bcfd2a`.
- Logged in `follow-ups.md`.

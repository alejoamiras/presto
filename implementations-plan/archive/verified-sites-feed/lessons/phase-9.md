# Phase 9: the WebDriver list hook, integration and gate

The feed, spec, CI wiring and release scan are logged in `phase-9-e2e.md`, merged here (merge, no
rebase, no conflicts). This log covers the Rust hook and the integrated gate.

## Shipped

- `src-tauri/src/e2e_tray.rs` gains the list hook beside the tray driver, under the same `cfg`:
  - `start_list_feed` reads `PRESTO_E2E_VERIFIED_SITES_URL` and `PRESTO_E2E_VERIFIED_SITES_PUBKEY`.
    Neither set means no list check at all (WebDriver builds skip the production one). Anything else
    but both valid logs an error and starts nothing.
  - `test_feed` accepts exactly `http://127.0.0.1:<port>/` (decimal, no leading zero, 1–65535) and a
    key that `ListKey::from_document` takes, which needs the final newline. The feed is
    `Feed::production(key)` with that URL and `https_only` off, so the timeout and cap match production.
  - It calls the production `spawn_refresh` with a channel, and `pump` sends one request a second,
    holding each reply until answered: `run_updates` skips a request whose reply is already dropped.
- K2 is green: both names live in `e2e_tray.rs` and nowhere else.

## Decisions

- **No committed test for `test_feed`.** No CI lane runs unit tests with `--features webdriver`, so
  one would never run. A temporary test (not committed) checked it against the contract URL and
  twelve near misses (no slash, `https`, `localhost`, `127.0.0.2`, `[::1]`, port 0, 65536, a leading
  zero, `+45`, an empty port, a path, a query) plus a bad key and a key without its final newline.
  The spec covers the accepting path.

## Findings

- **I7 holds on Linux:** tauri-plugin-webdriver refreshes the consent popup, and the reloaded page
  shows the new badge. Without the refresh, step 2 fails, so the popup reads its badge only when it
  loads. The plan said step 4; corrected in plan.md.
- **The plugin's `refresh()` returns before the reload.** The first `#origin` lookups find the old
  document's element and fail as stale; `waitForActivePopup`'s polling absorbs it, about 3 s per
  reload. Harmless, but it is most of the spec's runtime.
- **A failing step leaves the `after` hook timing out.** `after` awaits the pending `/prove` before
  closing the popup, and the server holds that request until its 60 s decision deadline, past
  Mocha's 30 s. Seen in both spec mutants as a second failure, "after all" hook. It then skips
  `closeExtraWindows` and `serve(none)`. A pass is unaffected. Closing the popup first would answer
  the request (a closed popup is a deny). Not changed here: the spec belongs to the E2E side.
- Spec runtime: 13.1 s in the full suite and 12.4 s alone, against an estimate of 20–30 s. The whole
  suite took 43 s.

## Running the WebDriver suite locally on a host without a display

This host has `Xvfb` but no `stalonetray`, `dbus-launch` or root. What worked, all outside the repo:

- `apt-get download stalonetray`, then `dpkg -x` into a scratch prefix, put first on `PATH`. Its
  libraries (libX11, libXpm) were already installed.
- `dbus-run-session -- bash packages/presto/scripts/run-webdriver-local.sh`. The script reuses an
  existing `DBUS_SESSION_BUS_ADDRESS`, which here is the login session's bus. The private session ends
  with the run, together with the portal services it activates. Their `fuse init failed` and
  `portal.desktop.gtk` lines in the log are noise.
- `HOME` points at a fresh scratch directory for each run, so the app's `~/.presto`, its NSS
  databases and its autostart entry never touch the real home. `CARGO_HOME` and `RUSTUP_HOME` are
  set explicitly on this machine, so cargo is unaffected.
- `WEBDRIVER_LOG_DIR` is set, because the default writes into an archived plan's directory. Its logs
  are moved out of the tree after the run.
- A `--features webdriver` build rewrites `src-tauri/gen/schemas/`. Restore it after each run.
- For single-spec runs (the mutants): a scratch copy of the runner, ending in
  `npx @wdio/cli run ./wdio.conf.ts --spec ./e2e-webdriver/verified-sites.spec.ts`. The spec passes
  on its own.

## Gate (2026-10-13; the local `history/1` stand-in present for every src-tauri build and E2E run)

- `bun test` over the four Phase 9 files: 50 pass. `updater-feed-server.test.ts` (the smoke feed's
  404 for `/releases/verified-sites.json`): 3 pass. The feed's test produces `envelope-4.json` byte
  for byte.
- `cargo clippy --features webdriver --all-targets -- -D warnings`: clean.
- Published 1.2.0-rc.1 (`gh release download`, deleted after):
  - the scanner passes the `.deb`, the Apple Silicon `.app.tar.gz` and the AppImage;
  - the same `.app.tar.gz` and `.deb`, repacked with a hook name appended to `Presto`, fail it.
- Build pair:
  - the `--features webdriver` debug binary fails `assert-no-test-hooks.sh`, carrying all three
    names;
  - the release-profile binary passes it.
- shellcheck v0.9.0 is clean on `assert-no-test-hooks.sh`, `autostart-test.sh` and
  `run-webdriver-local.sh`.
- `grep -r PRESTO_E2E_ src-tauri/frontend-src`: empty.
- `run-webdriver-local.sh` passes every spec, 9 of 9 with 27 tests, tray-update included. The
  feed's log shows the sequence: none, with, tampered, without, none.
- Mutations, each caught, then reverted with a byte comparison:
  - sign the `tampered` list validly: fails at step 3 (`verified-sites.spec.ts:128`, name null);
  - skip the refresh in `reloadedBadge`: fails at step 2 (the reloaded badge is null);
  - move the release scan after "Upload artifacts": the `release-contract` scan test fails;
  - drop the `.deb` target: the same test fails.
- `bun run test` and `bun run lint:actions` (stand-in removed): see the checkpoint.

## What waits for `history/1` on `main` (Phase 10)

- The spec and `run-webdriver-local.sh` on the real record. The stand-in is the unsigned source list,
  and the spec only reads its entries.
- The release/WebDriver build pair on the real record, and CI's WebDriver lanes on every OS.
- The spec mutants against the real record. They are expected to behave the same, since the feed
  builds every served list from the newest record.

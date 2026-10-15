# Phase 8: app wiring and the in-process integration test

## Shipped

- `src-tauri/build.rs` drops the JSON syntax check of the source list and picks the newest
  `verified-sites/history/<N>.json` instead: any other file name, a record without its `.minisig`,
  a carriage return in the chosen record or in `key.pub`, or no record at all fails the build. It
  watches the history directory and `key.pub`, and exposes the record's path as
  `PRESTO_VERIFIED_SITES_RECORD`.
- `src-tauri/src/verified_sites.rs` is rewritten around `VerifiedSites { current, store }`:
  - `load` takes the newer of the built-in and the verified cache, with no network and no lock. On a
    tie with different bytes the built-in wins and a `SECURITY:` error is logged. A built-in that
    does not parse leaves an empty registry instead of panicking.
  - `refresh` runs fetch → verify → screen against the list in use → `save_if_newer` on a blocking
    thread → adopt the winner, re-judged under the write lock. It returns a `Refresh` outcome
    (`Unreachable`, `Refused`, `Kept`, `Equivocation` or `Swapped { persisted }`), whose
    `reached_feed` is true for any 200 within the cap.
  - `run_refresh` is `run_updates` with a memory-only `ScheduleStore`, `busy = || false`, and
    replies to requests. `spawn_refresh(app, feed, requests)` runs it on the managed registry, and
    `spawn_production_refresh(app)` passes the pinned key's production feed and a closed channel.
- `commands.rs`: `VerifiedSitesState = Arc<VerifiedSites>`. `get_verified_info` keeps its name, DTO
  and guard, and calls the new `verified_info(&VerifiedSites, &str)`.
- `main.rs`: `VerifiedSites::production()` is built before `.manage`, and `start_background_tasks`
  gains the one line `verified_sites::spawn_production_refresh(app);`.
- `tests/verified_sites_feed.rs`: plan cases 1–24 in 9 test functions (4–16 and 17–20 are tables),
  plus case 25 behind `#[ignore]`, which refuses to run without `PRESTO_VERIFIED_SITES_LIVE=1`.
- CI and scripts:
  - `presto.yml`'s Cert Trust matrix runs `cargo test --test verified_sites_feed` on every OS.
  - `.github/filters/presto.yml`: `key.pub` joins `rust_platform`, `desktop_runtime` and
    `windows_packaging`. The source list and its schema leave those three lanes, since neither is
    compiled in any more. `ci-filter-contract.test.ts` pins both routes.
  - `autostart-test.sh` copies `verified-sites/` into its container tree.

## Decisions

- **`spawn_production_refresh(app)` is the one line in `start_background_tasks`.** The pinned key
  parses into an `Option` (the app must not panic on a malformed compiled-in key, though a test
  rules that out), so the production feed cannot be built inline in one line. The WebDriver hook
  calls `spawn_refresh` with its own feed, so both go through the same production function.
- **`current` and `store` are `Option`s.** `current` is empty only when the built-in does not
  parse, and `store` is absent only when the pinned key does not parse. `SiteList` has no empty
  value: an empty list at version 1 would become a floor that equivocates with a real version 1.
- **`refresh` returns a `Refresh` outcome, not a bool.** The tests assert the outcome directly:
  case 21's "the error is logged" is pinned as `Swapped { persisted: false }`, emitted beside the
  error log.
- **Case 1 ("persisted before the swap") holds the store's lock file from the test** with
  `std::fs::File::lock`. While the save waits, the registry must still show list 4. The hold is
  500 ms, inside the store's 1 s lock wait.
- **Case 24** runs the list's `run_refresh` against a hung server beside a stub `run_updates`, both
  with 10 ms delays, for 1 s. It asserts at least 20 stub checks, no gap over 250 ms, and the list's
  launch check still hung.
- **The integration test installs the aws-lc-rs provider**, as `main` does: both ring and
  aws-lc-rs are linked into src-tauri.
- `clippy::cognitive_complexity` scored the first `refresh` at 61/25 (tracing macros), so it is
  split into `fetch_verified`, `screen` and `persist`. The 4–16 table became a `BadAnswer` struct
  (`too_many_lines`, `type_complexity`).

- **`autostart-test.sh` was already broken on `main`.** `tauri.conf.json` bundles
  `../../../LICENSE` as a resource (since `8325578`), and the script never copied it into its
  container tree, so tauri-build failed before any test ran. It now copies `LICENSE` beside
  `bun.lock`.
- A `--features webdriver` build rewrites `src-tauri/gen/schemas/*.json` (it adds the webdriver
  plugin's permissions). Restore them before committing.

## History record: what waits for `history/1` on `main`

`build.rs` refuses to build without a record, and none is committed. Locally, every src-tauri build
in this phase ran with an uncommitted placeholder: the source list copied to `history/1.json` plus a
dummy `.minisig`, created and removed by a scratch script, and never staged. It was absent while the
core tests and `bun run test` ran, since the core repository test rejects its signature. Until
`history/1` is on `main`:

- no src-tauri build works on this branch, which takes in CI every Rust, desktop, WebDriver and
  Windows lane, and `bun run lint:clippy`;
- `the_built_in_is_the_newest_record_byte_for_byte` only proves the mechanism, against the
  placeholder;
- case 25 needs the published list (after O5);
- the new per-OS `verified_sites_feed` step and `autostart-test.sh` need the record too.

## Gate (2026-10-13, placeholder present for every src-tauri build)

- `frontend:build` (with `prebuild` for the bb sidecar).
- `cargo test` for src-tauri: lib 151, bin 12, `verified_sites_feed` 9 passed and 1 ignored (case
  25), the other suites unchanged. Server: 13 passed. Core: see below.
- `cargo clippy --all-targets -- -D warnings` for src-tauri: clean.
- Windows cross-check: `cargo check --target x86_64-pc-windows-gnu --lib --tests` for src-tauri:
  clean in the new code. Its warnings are all in `autostart_heal.rs` and `uninstall_ownership.rs`,
  which this phase did not touch.
- `cargo check --features webdriver`: clean.
- `bash packages/presto/scripts/autostart-test.sh` (Docker): passes once `LICENSE` is copied;
  shellcheck 0.9.0 on it: clean.
- `bun run lint:clippy`, `bun run test`, `bun run lint:actions`: pass. Core `cargo test`: 392 + 5,
  without the placeholder.
- Updater identity (scratch script) against the PR 1 head:
  - the untouched updater files are identical;
  - in `main.rs`, `spawn_update_task`, `spawn_floor_tracker`, `should_poll_for_updates`,
    `schedule_store` and `start_background_tasks` differ by one added line, the list refresh.
- Mutations, each failing its test, then reverted (byte-compared):
  - swap before persisting → case 1;
  - swap the candidate instead of the winner → case 22;
  - swap on the store's `Equivocation` → case 23;
  - remove the reqwest timeout → cases 4–16 (the outer 10 s deadline fires);
  - equal-but-different accepted (core `judge`) → cases 4–16;
  - union instead of replace (a built-in fallback in `display_name`) → case 3.

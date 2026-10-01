# Recon: update-check-schedule

Base: `main` at `da476fa`. Two read-only agents: one reuse sweep across six capabilities and one mapper for the updater test lanes. The driver re-read every load-bearing claim below against the source; line numbers are at `da476fa`.

## Reuse map

| Capability needed | Existing code | Verdict |
|---|---|---|
| Wall-clock "now" | `core/src/updater_state.rs:75` `now_unix()`; near-duplicates at `src-tauri/src/commands.rs:1020`, `main.rs:39` (inline), `update_marker.rs:115` (i64) | **reuse** `updater_state::now_unix()`; add no fifth copy |
| Clock-skew tolerance | `updater_state.rs:71` `CLOCK_SKEW_TOLERANCE_SECS = 15 * 60` | **reuse** |
| Clock abstraction for tests | none. Searched `trait Clock`, `FakeClock`, `SystemTime::now`, `Instant::now` and `start_paused` in `core/src` and `src-tauri/src`. The idiom is a pure function that takes `now: u64` (`load_state(path, now)`, `candidate_allowed`). `#[tokio::test(start_paused = true)]` appears twice (`core/src/server/tests.rs:1060`, `core/src/server/prove.rs:674`), both for bounded timeouts | **build new**, as parameters and not a trait: pure `now`-taking functions, plus a generic async loop driven under paused tokio time |
| Atomic private-file write | `updater_state.rs:340` `write_state`: same-directory `tempfile`, 0600, fsync of the file and its directory, rename, hard errors. `config.rs:572` `save_to` has its own variant with a Windows DACL and a lock | **adapt**: split the body of `write_state` into a `pub(crate)` helper that takes bytes, used by both the floor and the new schedule file. Mechanical, and the existing floor tests cover it |
| Persisted scheduler state | `updater-state.json` via `updater_state::StateFile`, `#[serde(deny_unknown_fields)]` (`updater_state.rs:84-95`). A schema mismatch or an unknown field reads as `Corrupt`, which quarantines the file and rebuilds it | **build new, separate file** (`~/.presto/update-schedule.json`). Adding fields to `StateFile` would make an older build quarantine the security-critical floor file after a downgrade. Soft scheduling state has no business sharing a file with the anti-rollback floor |
| State path | `updater.rs:34` `updater_state_path()` uses `dirs::home_dir()/.presto/`, deliberately not `PRESTO_HOME`; `certs.rs` and `update_marker.rs` do the same | **reuse the convention** with a sibling path; tests pass explicit paths, as the `updater_state` tests do |
| Background loop | `main.rs:383-391` `spawn_update_poller`: `sleep(5s)`, then `loop { run_update_check; sleep(12h) }` | **adapt**: keep the 5 s launch check as is; replace the 12 h sleep with a 15 min tick and a wall-clock due test |
| Poll gate | `main.rs:254-267` `should_poll_for_updates()` (`PRESTO_NO_UPDATE`; debug builds unless `PRESTO_FORCE_UPDATE_CHECK`) | **reuse**; it also gates whether the tray item exists |
| Update check | `updater.rs:233-289` `check_for_update(app, config) -> Option<VerifiedUpdate>`. The `Some(true)` branch auto-installs and returns `None`; a check error also returns `None`, so "no update", "failed" and "installing" look the same to the caller | **adapt**: return a typed outcome and take a mode (`Scheduled` or `Manual`). `Manual` never auto-installs. Scheduled behavior is unchanged |
| F-004 gate | `updater.rs:178` `verify_and_gate`, `:146` `layer_b_gate` | **reuse untouched** |
| Prompt consent | `commands.rs:169-241` `PendingUpdateSlot::take_or_reprompt`; `main.rs:283` stores the pending update; `windows.rs:335` `show_update_prompt_window` → `open_or_focus_window` with `focus_if_open: false` | **reuse** for the manual path |
| "Later" handling | `commands.rs:1107-1110` closes the window and logs. Nothing is persisted; the doc comment says the prompt "returns next launch" | **adapt**: persist a 24 h snooze for `displayed_version` (validated SemVer) |
| Tray menu | `tray.rs:72-124` `build_tray_menu(app, dev_mode, bundled_version, status)`. `status` is created once in `setup_desktop` (`main.rs:781`) and passed into every rebuild (`main.rs:511` `versions_changed_callback`, dev mode only) | **adapt**: create the new item once the same way and pass it into every build, so a rebuild keeps its handle and label |
| Label updates | `main.rs:541-557` `status_callback` → `MenuItem::set_text` from the server's async context | **reuse the pattern** |
| Menu dispatch | `main.rs:452-475`, a flat `match event.id()` inside `build_tray` | **adapt**: add a `"check_updates"` arm that routes to a named handler function |
| Tray tests | none. `grep -c '#\[test\]' tray.rs` finds 0, and no WebDriver spec touches the tray: the native tray is outside the DOM, and the only "tray" hits are comments about stray windows (`e2e-webdriver/helpers.ts:25`, `smoke.spec.ts:11`) | **build new** |
| Test-only IPC hook | The ACL is locked down. `build.rs:143-165` lists the commands, which must equal `generate_handler!` (`main.rs:866`) and the union of capability grants. `scripts/tauri-trust-boundary.test.ts:201` pins exactly 5 capability files, and `:276` pins the allowlist in `tauri.conf.json` | **do not extend**. A webdriver-only command would need a feature-conditional ACL across `build.rs`, the capabilities and a pinned guard. Use a startup-scripted driver compiled only into webdriver builds instead (see the plan) |
| Frontend prompt | `frontend-src/update-prompt.js:23-27` sends `{action: "later", autoUpdate, displayedVersion}`; asserted by `e2e/update-prompt.spec.ts` against `e2e/tauri-mock.js` | **reuse**; the IPC shape does not change |

## Load-bearing facts

1. **Release builds abort on panic.** `src-tauri/Cargo.toml:125` sets `panic = "abort"`. Crash recovery (Windows Task Scheduler PT1M, launchd `SuccessfulExit:false`, systemd `on-failure`) relaunches the app. A deterministic panic in new code on a startup path is therefore a crash loop on every user's machine, and a crashed app cannot update itself.
2. **The launch check is the recovery path.** `spawn_update_poller` checks 5 s after launch no matter what state exists. Every updater smoke relies on it: `updater-smoke.sh:217-234`, the Linux script and the Windows `.ps1:329-332,352-357` poll `/health` for 300 s after starting N-1 with `auto_update: true`, and never set `PRESTO_FORCE_UPDATE_CHECK`. The next release's smoke will use this release as its N-1 baseline.
3. **The release is gated by** `release-presto.yml:815`: `release` needs `update-smoke`, `update-smoke-linux`, `update-smoke-windows`, `update-smoke-windows-negative` and `e2e-webdriver`. The pre-release WebDriver gate (`:166-199`) runs a release-mode binary with `--features webdriver`.
4. **WebDriver builds compile the updater out.** `#[cfg(not(feature = "webdriver"))]` gates `should_poll_for_updates`, `run_update_check`, `spawn_update_poller`, `spawn_floor_tracker` and `start_background_tasks` (`main.rs:254,275,382,406,763`) and `show_update_prompt_window` (`windows.rs:334`). `_e2e-webdriver.yml:122-135` fails the job if the app log ever contains `Showing update prompt`.
5. **WebDriver launch.** The workflow starts the binary once (`_e2e-webdriver.yml:76-93`), then runs every spec against that instance.
6. **Monotonic sleep.** `tokio::time::sleep` measures `Instant`, which on Linux (`CLOCK_MONOTONIC`) and macOS (`CLOCK_UPTIME_RAW`) excludes suspend. A 12 h sleep therefore stretches by however long the machine sleeps. A 15 min tick bounds the post-wake delay at about 15 min on any OS.
7. **The tray menu is rebuilt only in dev mode** (`main.rs:519` returns early when not `dev_mode`), but the rebuild must still carry the new item.
8. **The PR paths filter.** `.github/filters/presto.yml` `desktop_runtime` covers `src-tauri/**` and routes `e2e-webdriver` (3 OS), `e2e-webdriver-builtdebug` and `desktop-ui`; `rust_platform` routes clippy and tests. `updater_feed` names `src/updater.rs` explicitly, so the change to `updater.rs` also runs the feed sign/verify job. The updater smokes run only in `release-presto.yml`, never on PRs.
9. **The feed endpoint is compile-time.** It lives in `tauri.conf.json:34-36`, with no runtime override. The smokes redirect the real host to a local HTTPS feed through `/etc/hosts` and a trusted local CA (`scripts/updater-feed-server.ts`).
10. **The Layer B gate rejects any candidate at or below `max(current, floor, pending)`** (`updater.rs:146-173`). Its rejection logs `SECURITY:` and today returns `None`, the same value as "no update".

## Collision and dedup risks

- There are four `now_unix` copies; the new code must use `updater_state::now_unix`.
- `check_for_update` has one caller today (`run_update_check`), confirmed with `grep -n "check_for_update\|run_update_check"`. Changing its signature therefore touches exactly one call site, plus the new manual caller.
- The Playwright `update-prompt.spec.ts` "Later" test asserts the IPC payload. It stays valid because the snooze lives only in Rust.

# Phase 5: channel control, prompt copy, real-binary lifecycle

## UI half

- **Copy.** Where the plan and the mockups differ, the plan's leave-check sentence wins. The mockups
  say "until 1.2.0 or later", which no command supplies, so the check reads "Presto stays on <v>
  until a newer stable release exists. It does not go back to an older version." The titles and
  buttons follow mockup B ("Stop release candidates?", Keep Release Candidates / Switch to Stable;
  "Turn off developer mode?", Cancel / Turn Off). There is no version chip.
- **One save path.** `frontend-src/developer.js` owns the switch, the channel control, both checks
  and the result line, and both commands report through its `save`. Arc 1's reload guard (a
  revision moved at each save's start and end) now covers both controls, and a counter of in-flight
  saves replaces the boolean. The controls stay enabled while a join check runs, so a newer change
  can supersede it, and only the newest change may write the result line.
- **The save is never hostage to the check** (director condition 1). `save_developer_mode` and
  `save_update_channel` in `commands.rs` are the commands' own saves. `a_failed_join_keeps_the_save`
  runs both with an update task that is gone: each returns `Ok(Some(Failed))`, and rc is on disk.
  The mutation that turns a failed join into an `Err` fails that test.
- **The hand-edited case** (director condition 2). A stored rc with developer mode off, then the
  switch turned on: "Checking…", then the result, with the switch and rc staying on.
  `developer on ignores the stored choice` and `a failed join reverts the save` both fail it.
- **Prompt URL.** The app percent-encodes the version (`urlencoding`), so `+` arrives intact. A raw
  `+` in a test URL decodes as a space and turns build metadata into a fake prerelease.
- **Generated schemas.** The `--features webdriver` clippy build adds `webdriver:default` to
  `desktop-schema.json`. Revert it before staging.
- Tests:
  - Playwright went from 92 to 106. That includes T4, T7, T8, T16, T17, T18, T19, the window fit
    of the RC prompt, and Developer section reachability at 500×680.
  - The WebDriver `developer.spec` covers a join showing the stub's "Up to date" with rc on disk,
    off resetting the block, and the channel refused while off.
  - `trust-boundary` denies both commands to the auth popup.
  - The app is 1.2.1-rc.1 on main, a prerelease, so the WebDriver off helper confirms the inline
    check.
- UI mutations, all red:
  - a superseded result written;
  - a failed join reverting the save;
  - leaving never asking;
  - developer on ignoring the stored choice;
  - showing the stored channel instead of the effective one;
  - the prompt never showing candidate copy.

## Smoke half (`rc-lifecycle`)

- **Relaunch stays in the group.** Tauri 2.11.5's `restart()` spawns the new binary with
  `Command::spawn` (macOS re-reads `CFBundleExecutable`), so the relaunched app keeps the launched
  process group and its stdout. One `stop_app` per leg ends it on macOS and Linux. On Windows the
  NSIS installer starts the new app, so the legs stop every `Presto` process by name.
- **R's macOS payload is renamed** `Presto-<version>.app.tar.gz`: R and N both bundle
  `Presto.app.tar.gz`, and one serve directory holds both. The signature covers bytes, not the name.
- **Feeds over R's payload.** `rc-feeds` signs four feeds over R's one payload: R in rc-v1, its v1
  twin, rc.2 in rc-v1, and v1 `0.0.1`. Only R's is meant to install. Under a broken admission, rc.2
  installs R's bytes, so `/health` would still read rc.1. The download assertion catches it, which
  is why every refusal leg checks the download before the version and the log line. A local dry run
  with a throwaway key checked the four through the real tool: R rc-v1 refused on stable and OK on
  rc; the twin refused on both (`PrereleaseNotCandidate`); rc.2 is rc-v1; 0.0.1 is v1.
- **Configs.** Every seed has `https_enabled: false`. With it true, first launch would install the
  local CA, and on Windows CurrentUser\Root that is a GUI prompt a headless runner never answers.
  `onboarding_version: 1` keeps the wizard closed. A1 and A2 seed a v1 config with no developer
  block.
- **Feed log marks.** The readiness probe also requests `latest.json`, so each launch reads only
  the feed lines after a mark taken just before it. On Windows, non-feed 404s go to `feed.err`.
  Every feed path is logged through the feed log.
- **Docs in this arc.** `UPDATER_TESTING.md` and the CLAUDE.md smoke list name the mode now, so the
  arc 2 PR does not leave them stale. Phase 7 still owns the release-smoke docs.
- Local checks before dispatch:
  - the feed-log helpers against a synthetic log (bash);
  - the Windows script parsed with zero errors, and its helpers run in a PowerShell container
    against the same kind of log;
  - shellcheck 0.9.0 and actionlint;
  - `ephemeral-updater.test.ts` refuses a non-rc.1 `rc-feeds` version, and the mutation that drops
    that check fails the test.
- Runs at `f411c06`, all green:

  | Mode | Run | macOS | Linux | Windows |
  |---|---|---|---|---|
  | `rc-lifecycle` | 38828585161 (unix), 38828587685 (Windows) | 20 min | 18 min | 27 min |
  | `positive` | 38828590815 (unix), 38828593217 (Windows) | 18 min | 12 min | 20 min |

  The plan estimated 12, 18 and 28 min for `rc-lifecycle`. The five legs take about 3.5 min on
  every OS (B and C2 install in 6–16 s); the rest is the third build.
- presto.yml 38828596481 at `f411c06` failed Cert Trust (macos) on
  `case_24_a_hung_list_check_never_delays_the_update_check`: a 334 ms gap between 10 ms update-check
  ticks, against a 250 ms limit.
  - Arc 2 touches neither the scheduler, the list refresh nor the test.
  - It is the only failure of that job in the last 120 presto.yml runs, and it passed at `ac5810f`
    (38830470281, all green).
  - Likely cause: the binary runs 10 tests in parallel, in debug, on a 3-vCPU runner.
  - The rerun of the failed job was cancelled by the new dispatch on the same branch (presto.yml's
    concurrency group).
- **Teeth.** The scratch branch `rc-update-channel-mutation` (never merged) has `admits` accept
  everything. A `from` input starts the lifecycle at A1, A2 or C1 (C1 runs B first), and the unix
  matrix runs Linux only, because the unix legs are shared code. All six runs failed on the
  download assertion of the leg they started at, before any log-line check:

  | Leg | Linux | Windows |
  |---|---|---|
  | A1 | 38830642332 | 38831263175 |
  | A2 | 38830645015 | 38831266135 |
  | C1 | 38830647608 | 38831268974 |

  Each run printed `<leg>: the app downloaded an update it must refuse`.

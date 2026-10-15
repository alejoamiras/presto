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

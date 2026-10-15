# Arc 1 review (Codex, gpt-6.1-sol, high, read-only)

Branch `worktree-rc-update-channel`, reviewed at `e1502d9`; fixes in `644bb14` and `d257a96`.

## Round 1: fix (5)

1. **Other serde encodings select RC** (`[true,"rc"]`, `{"rc":null}`). Declined: writing either
   needs write access to `config.json`, which already lets the writer store the plain object form,
   and no accidental damage produces them. The lenient deserializer keeps a damaged block from
   turning the whole config read-only; it is not a schema validator. Codex did not contest it in
   round 2.
2. **Stale reload repaints the switch.** Verified: reloads overlap (two quick Removes, a failed
   speed save), and one that read the config before a developer-mode save painted it off after the
   save. Fixed with a revision captured per load; a controlled Playwright test is red without the
   guard.
3. **Fit test did not bound the overflow.** Fixed: what Advanced adds must not exceed the folded
   summary plus the section margin.
4. **Debug build logged "Developer mode enabled".** Fixed: "Debug build" (the plan had it in
   Phase 4).
5. **Comments.** wdio order comment cut to the autostart constraint; `ChannelTransition` doc says
   what the fields are not; WebDriver wait comment corrected.

Also from CI run 38806220508: `developer.spec` failed on all three OSes. `browser.refresh()` returned
while the old document still answered, so the hydration wait passed on it and the read hit the new,
unhydrated page. `reloadSettings()` now marks the old window and waits for a fresh hydrated one.
Every other spec passed, including the auth popup's `set_developer_mode` denial.

## Round 2: fix (1)

A reload begun during a held save could read the old value and finish after it. Verified; fixed by
bumping the revision again when the save ends. A second controlled test is red without the bump.

## Round 3: clean

"No new material findings… VERDICT: clean". Converged.

# Recon: rc-update-channel

Base: `origin/main` at `a2a3a98` (2026-10-15). Two read-only Sonnet explorers (app side; release
pipeline) plus the driver's own reading of the updater, manifest, decision and plugin code.
Paths are repo-relative. `T` = `packages/presto/src-tauri`, `C` = `packages/presto/core/src`.

## Reuse map

| Capability needed | Existing code | Verdict |
|---|---|---|
| Persisted developer flag + channel | `PrestoConfig` (`C/config.rs:92-139`), additive `#[serde(default)]` fields with no `CONFIG_VERSION` bump (`:64-75`); enum shape of `Theme` (`:25`) | adapt: add a nested `developer` struct |
| Atomic, capability-gated save | `lock_mutate_save` (`C/config.rs:569-584`), desktop `mutate_config` (`T/src/commands.rs:21-40`), `save_to` flock + tmp + rename (`:495-557`) | reuse as is |
| Settings-only IPC | `require_label(window.label(), SETTINGS_LABEL)` (`T/src/commands.rs:684-696`), `capabilities/settings.json`, `build.rs` `AppManifest` list (`T/build.rs:193-216`), drift guard `scripts/tauri-trust-boundary.test.ts` (count pinned at 20, `:272`) | reuse; add two commands in the six registration places |
| Runtime updater endpoint | `tauri-plugin-updater` 2.11.0 `UpdaterExt::updater_builder().endpoints(Vec<Url>)` (plugin `updater.rs:224`); the app calls plain `app.updater()` (`T/src/updater.rs:333`) | adapt: build the updater per check with the channel's endpoint |
| Multi-endpoint "max" | Plugin tries endpoints in order and stops at the first success (plugin `updater.rs:458-565`); a 204 is "no update" (`:531`) | not reusable for max(stable, rc); build new (Worker or client) |
| Signed manifest binding | `update_manifest::verify_manifest` / `build_signed_envelope` (`C/update_manifest.rs`), schema `presto-update-manifest-v1`, `deny_unknown_fields` | adapt: channel-aware schema |
| Anti-rollback floor | `updater_state::candidate_allowed` (candidate > max(current, floor), ≥ pending), floor commit on healthy launch (`C/updater_state.rs`), re-checked at install time (`T/src/updater.rs:440`) | reuse as is; it already gives "stay on the RC until stable passes it" |
| Update decision table | pure `decide()` with an exhaustive 240-input test (`T/src/updater/decision.rs`) | reuse unchanged; keep the channel out of `decide` |
| Pending slot + prompt | `PendingUpdateSlot`, `handle_later` / `handle_update_now` (`T/src/commands/update_prompt.rs`), `Decision::Clear` empties the slot | reuse; clear on a channel change |
| Snooze | per exact version, 24 h (`C/update_schedule.rs:41,81-98`); prerelease and stable snooze independently (test a9) | reuse as is |
| Manual check from Settings | tray `ManualCheck` queue (`T/src/update_menu.rs`, `ManualCheckSender`, `MANUAL_QUEUE`) | reuse if "check on join" is chosen |
| Feed Worker | `packages/release-feed/src/index.ts`: static path → KV key map, 503 on a missing key, no validation | adapt: add the RC route |
| Feed signing | `packages/presto/scripts/sign-release-updater-artifacts.sh` + Rust `core/examples/update-manifest.rs` (`envelope / splice / verify / verify-artifact`) | adapt: schema follows the version |
| Promote / verify / health | `release-presto.yml` `promote` (pre-flight refuses prereleases, `:1296-1304`), `verify-live-feed` (`:1406-1477`), `update-feed-health.yml` | adapt: RC branch |
| Ephemeral smokes | `smoke-updater-unix.yml`, `smoke-updater-windows.yml`, `scripts/ephemeral-updater.sh`, `scripts/updater-smoke.sh`, `scripts/updater-feed-server.ts` (serves only `/releases/latest.json`, `:44`), host impersonation over local TLS | adapt: RC mode |
| Settings UI primitives | `.row`, `.row-sub`, `.toggle`, `.seg`, `.disclosure` (`T/frontend/style.css`), `wireToggle` (`T/frontend-src/bridge.js`) | reuse as is |
| UI tests | Playwright mock `packages/presto/e2e/tauri-mock.js` + `settings.spec.ts`; WebDriver `e2e-webdriver/theme.spec.ts` shape (`waitForHydration`, `readConfig`) | reuse |

## Facts the plan rests on

- The client has no channel concept and no endpoint override. Only `tauri.conf.json`
  `plugins.updater.endpoints = ["https://presto.build/releases/latest.json"]`, pinned by
  `scripts/presto-domain.test.ts:15,46`.
- The plugin's default comparator is `release.version > current` (SemVer), so
  `1.1.4 < 1.2.0-rc.1 < 1.2.0`. Today only feed content keeps RCs from clients.
- `sign-updater-artifacts` (environment `release-signing`) signs payloads and builds `latest.json`
  for every version, prereleases included. Only staging the feed into the release is gated on
  stable (`release-presto.yml:977,984`).
- `promote` (environment `release-feed`) is the only KV writer of `latest.json`. Its pre-flight
  refuses prereleases and requires 17 assets; an RC release has 16.
- `release-signing` and `release-feed` have no required reviewers; they scope secrets to `main`
  (`docs/RELEASE_RUNBOOK.md:18`).
- The landing page reads the stable feed and rejects non-`X.Y.Z` versions
  (`packages/landing/src/feed.ts:15-17`).
- `RELEASE_RUNBOOK.md:70` says RCs must never enter the public feed; `CLOUDFLARE_DEPLOYMENT.md:115`
  says do not seed `latest.json` with a prerelease. Both need a precise rewrite, not deletion.
- `is_dev_mode()` (`T/src/main.rs:31`) is `cfg!(debug_assertions)`; a user setting must not reuse
  that name.
- Update state files (`update-schedule.json`, `updater-state.json`) use `dirs::home_dir()`, not
  `PRESTO_HOME`.
- Settings content measures 637 px of 648 px available (`T/src/windows.rs:189-195`); the body
  already scrolls (`body.scrollable`). Issue #116 tracks windows taller than a short work area.
- The update prompt is 420 × 280 and does not scroll; `e2e/window-fit.spec.ts` covers it.
- Headless (`packages/presto/server`) shares `ConfigStore` with no persist capability and has no
  updater.

## Collision and dedup risks

1. Command-count and set-equality drift guard (`tauri-trust-boundary.test.ts`): every new command
   touches `commands.rs`, `main.rs` `generate_handler!`, `build.rs`, `capabilities/settings.json`,
   the guard's matrix and count, and `e2e/tauri-mock.js`.
2. The endpoint pin test must learn the RC URL without loosening the stable assertion.
3. Putting the channel into `decide()` multiplies its exhaustive table; select the feed in
   `fetch_feed` instead.
4. `updater-feed-server.ts` hardcodes `/releases/latest.json`.
5. `update-feed-health.yml` compares against the latest non-prerelease; an RC probe needs its own
   expected version.

## Open work

- `gh issue list --state open`: none overlaps. #116 (Settings taller than short work areas) is
  adjacent: any added Settings height must stay collapsible.
- `gh issue list --state all --search "rc channel OR prerelease OR beta OR developer mode OR update
  channel"`: no prior issue.

## Search trail for absence claims

- No channel, beta or nightly concept in client code: `rg -i 'channel|nightly|beta'` over `T/src`,
  `C`; hits are prose only.
- No endpoint override: `rg 'endpoints|updater_builder|version_comparator'` over `T/src`, `C`,
  `scripts`; only `tauri.conf.json`.
- No user-facing developer or advanced setting: `rg -i 'developer|advanced|experimental|hidden'`
  over `T/src`, `T/frontend-src`, `T/frontend/*.html`, `C`, `packages/presto/server/src`; hits are
  the debug-build `is_dev_mode()` and HTML `hidden` attributes.
- No HTTP route reads or writes settings beyond approved origins and speed: routes are `/health`,
  `/prove`, `/prove/ultra-honk` (`C/server.rs:402-405`).
- No WebDriver config pre-seeding helper: `rg 'config.json|PRESTO_HOME'` over
  `e2e-webdriver/*.ts`, `_e2e-webdriver.yml`.

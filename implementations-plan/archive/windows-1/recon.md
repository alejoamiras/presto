# windows-1 recon

Base: `main` @ 9ecd90e. One Sonnet Explore sweep plus direct reads of the locked Tauri sources
(`~/.cargo/registry`, tauri 2.11.5, tauri-runtime-wry 2.11.4, tao 0.35.3,
tauri-plugin-webdriver 0.2.1).

## Reuse map

| Capability | Found | Verdict |
|---|---|---|
| Fit a new window to the work area | `WebviewWindowBuilder::prevent_overflow()` / `prevent_overflow_with_margin()` (tauri `webview/webview_window.rs:470-487`); unused in the repo | reuse-as-is |
| One place every window is built | `open_or_focus_window`, `src-tauri/src/windows.rs:113-180` (`.inner_size().resizable(false).center()` at 144-146) | adapt (add one call) |
| Scroll when content outgrows the window | `body.scrollable`, `src-tauri/frontend/style.css:239-253`; on settings, onboarding, renewal | reuse-as-is |
| Monitor / work-area reads | none. Searched `current_monitor\|primary_monitor\|work_area\|scale_factor\|available_monitors\|availHeight\|window\.screen\|outerHeight\|innerHeight\|prevent_overflow` in `packages/`, `scripts/` | not needed (Tauri reads it) |
| Window rect in WebDriver | `browser.getWindowRect()` → plugin `executor.rs:1339-1350`: physical `outer_position()` + `outer_size()` | reuse-as-is |
| WebDriver window helpers | `ensureSettingsWindow()` (`e2e-webdriver/helpers.ts:86`); no spec reads a size or viewport today | reuse helper, build new spec |
| Viewport sizes per window | `e2e/window-sizes.ts` (`WINDOW_SIZES`, `WEBVIEW_CHROME_HEIGHT = 32`, `VIEWPORT_SIZES`) | reuse-as-is |
| Reachability check | Playwright `expectReachable` (`e2e/settings.spec.ts:640-662`) | copy the shape, not the code (different runner) |
| Local WebDriver run | `packages/presto/scripts/run-webdriver-local.sh` (owned Xvfb `:99` at 1280×800, feed, hook env, `setsid` app, whole suite; real `HOME`); pinned by `scripts/webdriver-only-hooks.test.ts` L4 | adapt its sequence, do not edit it |
| Spec list guard | `scripts/webdriver-only-hooks.test.ts` L3: `wdio.conf.ts` must list every spec file, with tray, developer, autostart last | follow |
| Drift guard on sizes | `scripts/tauri-trust-boundary.test.ts:384-410` parses the `WindowConfig` literals only, not the builder chain | untouched |

## Facts

1. **Sizes** (`windows.rs`): settings 500×680 (:194), onboarding 520×592 (:227), renewal 420×320
   (:250), authorize 400×360 (:301), update-prompt 420×280 (:375). Matches the issue.
2. **Locked versions** (`Cargo.lock`): tauri 2.11.5, tauri-runtime 2.11.3, tauri-runtime-wry 2.11.4,
   tao 0.35.3, wry 0.55.1.
3. **What `prevent_overflow` does** (`tauri-runtime-wry/src/lib.rs:4535-4596`): with no position set,
   it takes `event_loop.primary_monitor()`, the same monitor `.center()` uses. `window_size` starts as
   the inner size. Only under `#[cfg(windows)]`, with decorations, it adds `-rect.top` from
   `AdjustWindowRect(WS_OVERLAPPEDWINDOW)` (title bar plus top frame). It then shrinks the inner size
   by any excess over `work_area - margin`. On macOS and Linux it compares the inner size alone.
   When the window fits, nothing changes; the branch is the same one `.center()` already runs.
4. **Centring** (`window/mod.rs:62-72`) centres `window_size` inside the work area, not the monitor.
5. **Work area per OS** (`tauri-runtime-wry/src/monitor/*.rs`): Windows `GetMonitorInfoW().rcWork`;
   macOS `NSScreen.visibleFrame` (no menu bar, no Dock); Linux `gdk_monitor.workarea()`, which is
   `_NET_WORKAREA` on X11 and the whole monitor on Wayland, where GDK cannot see panels.
6. **macOS frame**: tauri-runtime-wry gives every macOS window `TitleBarStyle::Visible` by default
   (`lib.rs:841-849`), which sets `with_fullsize_content_view(true)` (`lib.rs:1202-1205`). tao then
   adds `FullSizeContentView` before `initWithContentRect` (`macos/window.rs:242-249`), so the frame
   is the inner size and the 32 px title bar draws over the webview. That matches the repo's one
   measurement (`inner_size(500, 600)` → `innerHeight` 568, `e2e/window-sizes.ts:28-30`). Presto sets
   no title-bar style. Linux window managers draw their title bar outside the inner size.
6b. **Threads**: `WryHandle::primary_monitor()` reads the monitor on the calling thread
   (`lib.rs:2787-2794`); GDK and AppKit are main-thread only. Tauri's own fit reads it inside window
   creation, on the main thread. The auth popup is built from a server task (`main.rs:829`), the update
   prompt from the update task.
7. **tauri 2.12.2** (also in the registry) has the same `prevent_overflow` logic. A Tauri bump does
   not fix the macOS/Linux gap.
8. **WebDriver CI** (`.github/workflows/_e2e-webdriver.yml`): Linux runs `Xvfb :99 -screen 0
   1280x1024x24` with stalonetray and no window manager; macOS and Windows use runner defaults.
   Callers: `presto.yml` (macOS, Linux, Windows `dev`; Linux `built-debug`) and `release-presto.yml`.
   In webdriver builds only Settings opens at boot (`main.rs:1024`); onboarding and update-prompt are
   compiled out, and renewal is not shown.
9. **Linux WebDriver clicks** go through JS (`helpers.ts:108-118`); the plugin scrolls an element into
   view before a native click (`platform/linux.rs:264`). A shorter Linux screen does not break them.
10. **P5-01 basis**: on `main` (#180, 31ad8a6) `download_failed` names only the failed step and every
    `prove_failed` is fixed text. The other string-bearing `ProveError` variants carry the caller's
    version, origin, field name or a size (`core/src/server.rs:530-735`), never a path. The sentence
    is true.
11. **PRIVACY.md:39-43** is the paragraph that begins "Presto never logs the witness itself". No test
    pins `PRIVACY.md` text.

## Measurements (not reproduced here)

The shots lead ran Settings on a 1280×672 Xvfb screen: outer 701, viewport 680. So on Linux without
a window manager, `outer_size()` is 21 px taller than the inner size, and the window overran the
screen by 29 px. The local host has Xvfb and `ffmpeg` with `x11grab`, but no `import` or `xwd`.

## Collisions

- PR #169 (dependabot, `github-actions` group) may touch `_e2e-webdriver.yml`'s action pins; it
  does not touch the Xvfb line. Lane `deps-1` holds root `package.json` and `bun.lock` only.
- No closed `known-limit` issue covers window size (`gh issue list --state all --label known-limit
  --search window`).

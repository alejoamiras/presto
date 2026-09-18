# Phase 6 — WebDriver desktop e2e

Date: 2026-09-08.

## What landed

- `packages/presto/e2e-webdriver/ultra-honk.spec.ts`, registered in `wdio.conf.ts` between
  `auth-flow` and `autostart`: unknown origin → consent popup → Allow → 200, proof and public inputs
  byte-equal to the WASM reference (`checkOutputs`) AND verified by the shipped sidecar bb
  (`verifyNatively`) as two separate assertions; an unknown `verifier_target` from the approved origin
  → 400 naming `verifier_target`, no new window; a second origin → Deny → 403 with no
  `x-prove-duration-ms` header and nothing persisted.
- The popup helpers (`clickBy`, `closeExtraWindows`, `waitForNewWindow`, `waitForActivePopup(origin)`,
  `removeOriginViaUI(origin)`) moved from `auth-flow.spec.ts` into `helpers.ts`, parameterised by
  origin; `auth-flow` imports them, behaviour unchanged.
- `ultra-honk-smoke.ts` helpers are runtime-neutral: `verifyNatively` uses `node:child_process`
  because wdio runs under Node (`npx @wdio/cli`), where `Bun.spawnSync` does not exist. The spec
  imports `getTargetTriple` from `copy-bb.ts` to find the sidecar; that module only touches `Bun`
  inside `resolveAztecBb`, so importing it under Node is safe as long as that is never called there.
- `desktop_runtime` filter gains `fixtures/noir/**` and the smoke helpers (the spec depends on both).

## Notes

- Without `DISPLAY` in the test shell, wdio 9's local runner wraps every worker in `xvfb-run`, which
  loses the worker's IPC channel (`Error: write EINVAL` from `process.send` in `run.js:18`) and fails
  all seven specs before any test runs. CI exports `DISPLAY=:99` via `GITHUB_ENV`; locally the run
  needs the same (`DISPLAY=:99 bun run test:e2e:webdriver`).
- Local stack mirrors `_e2e-webdriver.yml`: `setsid` Xvfb `:99`, `dbus-launch`, `stalonetray`, then
  the `cargo build --features webdriver` binary; pids recorded and killed by pid (never `pkill -f`).
  Ports 59833 and 4445 claimed in `~/.agents/ports.md` for the run and released after.
- The desktop's first native UltraHonk proof took ~3 s locally with the bb already in the app's
  version cache; the proving test carries `this.timeout(180_000)` for a cold CRS fetch on runners.
- Nothing typechecks `packages/presto/e2e-webdriver` or `packages/presto/scripts` today
  (`tsconfig.scripts.json` covers root `scripts/` only; wdio strips types with tsx). Pre-existing;
  noted for a follow-up, not widened here.

## Gate

`bunx biome check` ✓ · `bun run lint` ✓ · `bun run --cwd packages/presto test:unit` (105) ✓ ·
`bun run test:scripts` (125) ✓ · local `DISPLAY=:99 bun run --cwd packages/presto test:e2e:webdriver`:
25 passing across 7 specs, the three UltraHonk tests in 6.1 s ✓ · `presto.yml` dispatch with the
three-OS WebDriver matrix: see the run link appended below.

# Phase 3: auth-flow hooks (#98)

- `afterEach` closes extra windows, then awaits `pendingProve`. The Deny test uses its own
  `DENY_ORIGIN`, and `before` and `after` remove both origins. `fireProveRequest` takes the origin.
- Local runs (2026-10-25), one fresh app and `HOME` per run, through a scratch copy of
  `scripts/run-webdriver-local.sh` ending in `--spec ./e2e-webdriver/auth-flow.spec.ts`, under
  `dbus-run-session`, with the runner's own Xvfb and a `stalonetray` from an `apt-get download` +
  `dpkg -x` prefix. `TMPDIR` and `HOME` pointed at scratch, and `WEBDRIVER_LOG_DIR` at a gitignored
  `src-tauri/target/` path. `gen/schemas/` was restored after each build.

| Run | Spec | Result | Spec file time |
|---|---|---|---|
| main clean | old | 2 passing (5.1 s) | 6 s |
| (a) | old + `throw` after `waitForActivePopup` in test 1 | test 1 fails, `"after each"` hook fails (`Error: Timeout`), Deny test never runs | 34 s |
| (d) | new, clean | 2 passing (5.4 s) | 6 s |
| (b) | new + the (a) mutant | 1 failing (test 1), Deny test passes, no hook failure | 5 s |
| (e) | new + `throw` after `waitForActivePopup` in the Deny test | 1 failing (Deny test), test 1 passes, no hook failure | 6 s |
| (c) | new + `throw` right after `fireProveRequest` in test 1 | test 1 fails, `"after each"` hook fails (30.3 s): KL2 | 31 s |

- (c) is KL2: the hook's window snapshot runs before the popup exists. In the real spec, the only
  failure before a popup is `waitForNewWindow` giving up after 15 s.
- Gate: `bun run lint`, `bun run test` and `bun run --cwd packages/presto typecheck` (both
  tsconfigs) exit 0.

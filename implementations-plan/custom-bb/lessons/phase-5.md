# Phase 5: end to end, and docs

## T13 (2026-10-16)

- **`e2e-webdriver/custom-bb.spec.ts`** runs in `wdio.conf.ts` after `ultra-honk.spec.ts`, which has
  already fetched the CRS. The tray, developer and autostart specs stay last (L3). In order, it:
  1. turns developer mode on and picks through the `PRESTO_E2E_CUSTOM_BB_PATH` seam;
  2. ticks, test-runs and saves under the label the run suggested;
  3. sends the `square` fixture from an unapproved origin, asserts the popup line, and allows it;
  4. asserts a 200, `x-presto-bb: custom` and the fixture's proof bytes, then stops;
  5. repeats the request and asserts a 200 official proof of the same bytes, with no header.
- **Matching by hash:** the spec finds the staged file by the SHA-256 it computes itself, not by its
  path. Canonical paths differ between OSes (`/private/var` on macOS, letter case and `\\?\` on
  Windows), and the hash is what the pin records anyway.
- **The label is the bundled version**, because the staged file is the sidecar and that is what
  its `--version` suggests. While pinned, the custom route must outrank the bundled shortcut; after
  the stop, the same request is an ordinary bundled proof. An unreleased label, the first draft,
  made the repeat a download attempt that failed differently per host (403 here, 404 in CI), and
  its header-only assertion would also have passed on an error.
- **Shared helpers:** `developerOnDisk`, `waitForHydration`, `reloadSettings` and `setDeveloperMode`
  moved from `developer.spec.ts` to `helpers.ts`, which both specs now import.

## Local run (this host has no display, no stalonetray and no root)

The method is the one in `archive/verified-sites-feed/lessons/phase-9.md`:

- **Tray host:** `apt-get download stalonetray`, then `dpkg -x` into `~/.cache/presto-e2e/prefix`,
  first on `PATH`.
- **Session bus:** `dbus-run-session -- bash packages/presto/scripts/run-webdriver-local.sh`.
- **Isolation:**
  - a fresh `HOME` under `~/.cache/presto-e2e/` on each run, with `RUSTUP_HOME` and `CARGO_HOME`
    set explicitly;
  - `WEBDRIVER_LOG_DIR` points at this plan, and the logs are moved out of the tree afterwards.
- **Sidecar:** the Linux sidecar was the 0-byte placeholder the Windows cross-check needs.
  `bun packages/presto/scripts/copy-bb.ts` put the real bb 6.0.0-rc.6 there first.
- **Schemas:** the `--features webdriver` build rewrote `gen/schemas/acl-manifests.json`. It was
  restored after the run.

## Docs

- **`docs/SECURITY_MODEL.md`:**
  - decision 8, covering one file for one label, the hash pin, the path policy, what the user sees,
    and the five residuals;
  - decision 1 amended twice, at "nothing else" and at the `BB_BINARY_PATH` precedence;
  - one "Not accepted" bullet;
  - "Last reviewed" set to 2026-10-16.
- **App README:**
  - a "Developer mode: custom bb" section;
  - the bb resolution paragraph and the cache-integrity exception;
  - one line in the tray section.
- **Root README:** a bullet in "Presto and Aztec versions", linked to both of the above.
- **`CLAUDE.md`:**
  - a clause in the Presto bullet;
  - test counts corrected: WebDriver 32 in 11 specs (the old 27 in 9 was stale before this arc),
    and Playwright UI 114.

## Gate (2026-10-16, Linux x86_64)

- `run-webdriver-local.sh`: 11 of 11 specs, 32 tests.
  - The suite took 1:17, and the whole script 192 s, build included.
  - `custom-bb.spec.ts` took 11.7 s, against an estimate of 25 s. So the suite ran about 65 s
    before this spec and about 77 s after it.
- `bun run test`: exit 0.
- `bun run lint:actions`: exit 0.
- The macOS and Windows runs of T13 are left to the PR's WebDriver lanes.

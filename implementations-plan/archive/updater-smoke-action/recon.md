# Recon — updater-smoke-action

Base: `origin/main` @ `87a4c8c`. One reuse-sweep agent, findings verified by the driver where marked ✓.

## Reuse map

| Capability | Existing code | Verdict |
|---|---|---|
| Throwaway key → `$GITHUB_ENV` | `smoke-updater-unix.yml:115-129`, `smoke-updater-windows.yml:87-104` (identical: `signer generate`, `::add-mask::`, three env lines, `rm`). Other generators (`presto.yml:370`, `presto.yml:728`, `release-presto.yml:295`) export step-locally or into a config override, never `$GITHUB_ENV` ✓ | **build new** (one copy of the two in-scope blocks); the other three stay — different lifetime, and `presto.yml:728` is pinned by `release-contract.test.ts:47-57` to not mutate `tauri.conf.json` |
| Version + pubkey stamping | Four copies of `sed` on `Cargo.toml` + `bun -e` on `tauri.conf.json` (unix 136-137 and 169-170, windows 110-111 and 193-194) ✓. `release-presto.yml:250-262` patches only `tauri.conf.json.version` | **build new**; release's narrower patch stays |
| Build an end + collect artifacts | Per-OS blocks in both files: macOS `.app` → `hdiutil` DMG (N-1) or `.app.tar.gz`+sig (N); Linux AppImage (+sig for N); Windows NSIS `-setup.exe` (N-1) or `.nsis.zip`+sig (N) ✓ | **build new** (one table, three OSes) |
| Test-hook scan | `packages/presto/scripts/assert-no-test-hooks.sh <binary\|dir\|AppImage>...`, only called from these two files ✓ | **reuse-as-is** |
| Feed build + sign + verify | Identical `jq -n` feed (platform key differs: matrix value vs literal `windows-x86_64`), `sign-smoke-feed.sh <feed> <repo-root>`, `update-manifest -- verify` ✓. No other `jq -n` feed builder (searched `_e2e-updater*.yml`, `release-presto.yml`) | **build new** wrapper; `sign-smoke-feed.sh` and the example **reuse-as-is** |
| Composite action conventions | 7 actions; kebab-case inputs, `shell: bash`, inputs only via `env:`; none writes `$GITHUB_ENV`; `bot-pr`/`bot-push` delegate to a script | **not used**: see plan's Alternatives |
| Input validation | First workflow step, before checkout, pinned by `release-contract.test.ts:157-213` | **out of scope**, stays inline |

## Tests and lint that see this surface

- `packages/presto/scripts/release-contract.test.ts:105-120` reads `smoke-updater-windows.yml`, splits on the step names "Sign and verify the ephemeral smoke feed" / "Updater smoke", and asserts the feed path, the `sign-smoke-feed.sh` call and the `verify` call are between them ✓. **Breaks** when the step body moves; must move to the script.
- Same file, `157-213`, loops over both workflows: step 0 is "Validate inputs" with the mode allowlist; no `inputs` expression outside `env`/`name`; `permissions: {contents: read}`; no `secrets.`; no `upload-artifact` ✓. Unaffected if validation stays first and new steps pass only `env` values.
- `scripts/action-pins.test.ts:35` sweeps `.github/workflows` and `.github/actions` for SHA-pinned `uses:` ✓. No new external action, so unaffected.
- `lint:shell` = `shellcheck packages/*/scripts/*.sh .github/scripts/*.sh` ✓ — a script in `packages/presto/scripts/` is linted; composite-action `run:` blocks are not.
- `actionlint.yml` routes on `.github/workflows/**` and `.github/actions/**`.

## Routing

`.github/filters/presto.yml`: `release_tooling` includes `packages/presto/**` (line 117) ✓, so a new script runs the presto lint/test jobs. `updater_feed` (151-) names `sign-smoke-feed.sh` and `updater-smoke*` explicitly and lists `smoke-updater-windows.yml` (146, 174) but **not** `smoke-updater-unix.yml` ✓ — a pre-existing gap.

## Baseline

Both smokes passed on 2026-10-01 at the code now on `main`: unix 36857605650 / 36857602482, windows 36857608794 ✓.

## Collision risks

- Rewiring the Windows feed step without moving `release-contract.test.ts:105-120` fails the suite.
- Windows used GNU `sed -i`; macOS needs `sed -i.bak`. A shared copy must use the form both accept.
- Windows builds without `--target` (output `target/release`); unix passes `--target` (output `target/<triple>/release`).
- The Windows L8 barrier is appended to `hooks.nsi` between the two builds; it must still apply to N only.

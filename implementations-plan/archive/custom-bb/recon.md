# Recon: developer-mode custom bb

Base: `origin/main` at `a2a3a98`. One Sonnet reuse sweep (15 capabilities) plus the driver's own
reads of `core/src/bb.rs`, `core/src/versions/`, `core/src/server/prove.rs`, `core/src/server.rs`
(`/health`), `core/src/config.rs`, the Settings window, `docs/SECURITY_MODEL.md` and the READMEs.
Paths are relative to `packages/presto/` unless they start with `packages/` or `docs/`.

## Reuse map

| Capability needed | Existing code | Verdict |
|---|---|---|
| Native file picker | none: no `tauri-plugin-dialog`, no `rfd` (searched `plugin-dialog\|rfd\|pick_file\|FileDialog` in `*.rs,*.toml,*.json,*.ts,*.html,*.js`) | **build new**: a Rust-side command opens the picker; the webview never supplies a path. New crate, so the crate-diff lesson applies |
| Streamed SHA-256 of a file | `core/src/versions/cache_layout.rs:122` `sha256_file` (re-exported only under `cfg(test)`) | **adapt**: export it `pub(crate)` for non-test use; no second hash helper |
| Fail-closed "hash matches pin, regular file" check | `cache_layout.rs:207` `verify_bb_entry` (tied to the version marker schema) | **adapt**: same shape (`symlink_metadata` regular-file check, then rehash), pinned digest from config instead of a marker file |
| Run a bb under containment with timeout and capped stderr | `core/src/bb.rs:368` `run_bb`, `containment::spawn_and_register` | **reuse** for proofs; a `--version` probe is **build new** on the same containment |
| `bb --version` probe | nothing runs bb except `prove` (searched `--version` in Rust trees; `scripts/bb-version.ts` only reads bb.js's `package.json`) | **build new** |
| Pick the bb for a request | `core/src/server/prove.rs:53` `resolve_version` → `download_if_needed` → `acquire_prover` → `bb.rs:47` `find_bb` (chonk) and `core/src/bb/ultra_honk.rs:180` (ultra_honk) | **adapt**: one resolution point decides "custom" before the bundled shortcut and the download decision |
| Version label validation | `core/src/versions/version_policy.rs:77` `AztecVersion::parse` and `:294` `check_version_selectable` (canonical semver, no build metadata) | **reuse**: a label must pass the same gate a request does, or no request can ever select it |
| Version leases and eviction | `core/src/versions/leases.rs`, `version_policy.rs:334` `cleanup_old_versions`, `:449` `sweep_cache_on_start` | **reuse by staying out**: they only list `versions/`; a custom bb never lives there |
| Persisted settings | `core/src/config.rs:92` `PrestoConfig`; additive `#[serde(default)]` fields need no `CONFIG_VERSION` bump (`:65`); `save_to` atomic write under a cross-process lock; desktop writes only via Settings IPC `mutate_config` (`src-tauri/src/commands.rs:22`) | **adapt**: one additive optional record |
| Developer-mode flag | none in config. `src-tauri/src/main.rs:31` `is_dev_mode()` is `cfg!(debug_assertions)`, threaded into `tray.rs:85` `menu_layout(dev_mode, …)` | **sibling owns it**; the name `dev_mode` is taken |
| `/health` tiers | `core/src/server.rs:426` `health_is_detailed`, `:451` `health`; additive fields keep `api_version` 1 (`:36`) | **adapt**: a detailed-only field |
| Proof response metadata | only `x-prove-duration-ms` (`prove.rs` `set_duration_header`, `server/ultra_honk.rs:371`); CORS exposes only it (`server.rs:397`) | **adapt** if a header is chosen: add it to the CORS expose list too |
| Error codes and SDK mapping | `ProveError` codes in `core/src/server.rs`; `packages/sdk-core/src/lib/presto-client.ts:519` `#classifyHttpError`: `500 prove_failed` degrades to WASM as `transient`, an **unrecognised 500 code throws** `PrestoHttpError` | **decide**: reuse `prove_failed` (quiet WASM fallback) or a new code (loud with every published SDK) |
| Tray line | `tray.rs:66` `Entry`, `:85` `menu_layout` (pure, unit-tested), version line `v{app} · bb {bundled}` (`:114`); Linux D-Bus fixture `scripts/tray-menu.test.ts` | **adapt**: a disabled label entry; no new icon art (pinned by `scripts/brand-assets.sha256.json`) |
| Settings section, IPC, styles | `src-tauri/frontend/settings.html`, `frontend-src/settings.js`, `bridge.js` (`wireToggle`, 700 ms click guard), `.health-row` warning row, `.btn-danger`, `<details class="disclosure">`; tokens in `style.css:7-64` (three copies: light, dark media, dark attribute) | **adapt** |
| Command registration | four lists in lockstep: `generate_handler!` (`main.rs:1154`), `build.rs` commands, `capabilities/settings.json`, `scripts/tauri-trust-boundary.test.ts` (`WINDOW_MATRIX`, `handlers.length` 20) | **adapt**, all four |
| Owner-only dir, atomic publish | `core/src/versions/downloader.rs:271` `install_version_dir` staging; `:369` `create_owner_only_dir`; `core/src/win_acl.rs` | **reuse** only if the copy design is chosen |
| macOS quarantine and signature | `downloader.rs:74` `finalize_downloaded_binary`: `xattr -cr` then `codesign --force --sign -` for official downloads | **decide**: Presto does this for official bb today; doing it to a user's file is a Gatekeeper bypass |
| Headless override | `BB_BINARY_PATH` at `bb.rs:49`: unversioned, unhashed, `exists()` only, wins over everything including versioned requests (documented in `docs/SECURITY_MODEL.md` decision 1 and the app README). The headless server never persists config (`cap: None`) | **reuse as the headless story**; keep it working (tests and `.github/workflows/_e2e-app.yml:64` use it) |
| Fake bb for tests | `bb.rs:1187` `test_support::install_fake_bb` (Unix shell script, sets `BB_BINARY_PATH`, `#[serial]`); server tests publish verified cache entries (`core/src/server/tests.rs:1250`) | **adapt**: a variant that installs a fake at a pinned path instead of the env var |
| Settings tests | Playwright `e2e/settings.spec.ts` on `e2e/tauri-mock.js`; WebDriver `e2e-webdriver/settings.spec.ts` with real IPC and `readConfig()` | **reuse** |
| Survival across update and uninstall | config lives in `~/.presto`, untouched by update; `src-tauri/src/uninstall.rs` removes trust and certs only | **reuse**: a config record survives update; uninstall keeps config |

## Load-bearing facts

- `find_bb(Some(v))` never falls through to another bb (F-007); `resolve_version` maps a request
  for the bundled version to `None`, so the custom check must run before that normalization.
- A label that is not a published release would make `resolve_version` set `needs_download`
  and fail in `download_bb`, so "custom" must be decided before the download step.
- `/health.bb_available` is `find_bb(None).is_ok()`; wiring the custom bb into the `None` path
  would misreport the bundled one.
- `check_version_selectable` accepts any canonical semver prerelease, so a label such as
  `6.0.0-dev.1` is selectable; `presto-noir` can send it through `bbVersion` with
  `allowUntestedBbVersion`, but `@alejoamiras/presto` always sends its bb.js pin, so only a label
  equal to a real release reaches that SDK's requests.
- `scripts/assert-no-test-hooks.sh` fails a shipped artifact containing `PRESTO_E2E_`.
- `tauri-trust-boundary.test.ts` pins five capability files and 20 handlers.

## Collisions and dedup risks

- Placing a custom bb under `versions/` would make it listed (`/health`, tray Versions menu),
  rehashed against a marker it lacks, and evicted by retention or the 2 GiB cap. Keep it out.
- Adding a picker plugin with its JS API granted would open a path-injection surface from the
  webview; the Settings capability file says "Rust wrappers drive plugins natively".
- Injecting the label into `/health.versions` would present a custom build as an official
  release pair.

## Open work touching this area

`gh issue list` (2026-10-15): #116 (Settings is 680 px tall and can exceed a short work area;
adding a section makes it worse), #102 (a deterministic download failure degrades as a silent
`transient`, same SDK mapping this feature meets). No issue mentions a custom bb or a developer
mode (searched "custom bb", "developer mode").

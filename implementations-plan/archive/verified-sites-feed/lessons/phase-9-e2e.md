# Phase 9 (E2E half): feed, spec, CI wiring and the D22 release scan

The Rust hooks in `e2e_tray.rs` are the other half, done separately; this log covers everything else.

## Shipped

- **D22.** `assert-no-test-hooks.sh` matches the `PRESTO_E2E_` prefix and extracts `.tar.gz` (into a
  fresh directory) and `.deb` (`ar x`, then its one `data.tar.*`); an extraction failure is its own
  `did not extract` error. The AppImage path now renames `squashfs-root` to the same `payload`
  directory, so every archive is scanned the same way. `release-presto.yml`'s `build` job gains one
  hunk, the step "Assert no test hooks in the bundles", between "Build Tauri bundle" and "Upload
  artifacts": macOS `bundle/macos/*.app.tar.gz`, Linux the AppImage and `.deb`, Windows
  `target/<triple>/release/Presto.exe`, and an unknown OS fails. `release-contract.test.ts` runs the
  step's script per OS with `bash` stubbed and pins the calls, its place, no `if`, no
  `continue-on-error`, no `secrets.`, and no scan in `sign-updater-artifacts`.
- **Feed.** `scripts/verified-sites-e2e.ts` (runtime-neutral: constants, `newestRecord`,
  `firstBuiltIn`, `feedLists`, shared with the Node-run spec) and `scripts/verified-sites-e2e-feed.ts`
  (Bun: `envelope`, `feedDocuments`, `startFeed`, CLI `--state <file> [--history <dir>]`).
  - `with` (9 000 000 001): the newest record minus its first entry's first origin, plus
    `https://verified-sites-e2e.example.com` ("Presto E2E").
  - `without` (9 000 000 002): `with` minus the E2E entry; the built-in origin stays dropped.
  - `tampered` (9 000 000 003): the `without` entries at its own version, carrying a valid signature
    over the `without` list, so only the signature check can refuse it.
  - `GET /` serves the mode (404 in `none`, the start mode); `POST /control?serve=` (400 on an unknown
    mode), `GET /control` → `{serve, served}` with per-mode serve counts. State is written to a temp
    file and renamed. No history record → exit 1, no state.
- **Env contract with the Rust hook** (sent to the director): `PRESTO_E2E_VERIFIED_SITES_URL` is
  exactly `http://127.0.0.1:<port>/`; `PRESTO_E2E_VERIFIED_SITES_PUBKEY` is the whole two-line key
  document with its final `\n`, the input of `ListKey::from_document`. Both launchers re-append the
  newline that `$(...)` strips. The spec finds the state file through `VERIFIED_SITES_E2E_FEED_STATE`,
  which the app never reads.
- **Spec** `e2e-webdriver/verified-sites.spec.ts`, after auth-flow and before ultra-honk; `invokeHere`
  moved to `helpers.ts`. Mocha timeout 45 s for the sequence, each poll 5 s at 250 ms.
- **Wiring.** `_e2e-webdriver.yml`: "Start the verified-sites feed" before "Launch app" (state and the
  feed's own PID into `GITHUB_ENV`; that PID is Bun's, a native PID on Windows, so `taskkill` works),
  the two variables exported in Launch app, the feed log in the failure upload, a kill in Cleanup. The
  teeth step, renamed "…carries the test hooks", loops over all three names. The local runner starts
  the feed under `setsid` in its owned groups, keeps state in a per-run temp dir, and exports
  `PRESTO_E2E_TRAY_REPORT`.
- **Guards.** K2 expects both new names (fails until the Rust hook lands); K5 runs the teeth step on
  stand-in binaries, each missing one name; L4 pins both launchers; `updater-feed-server.test.ts`
  pins the 404 for `/releases/verified-sites.json`.

## Gate (2026-10-13)

- `bun test` of the four Phase 9 files: all pass except K2 (two names missing from `e2e_tray.rs`,
  expected before the Rust hook).
- `bun run test`: lint and typecheck green; the presto unit chain fails only on K2, and the suites it
  short-circuits (release-feed, testnet-rpc, root scripts) pass when run directly.
- `bun run lint:actions` clean, also with actionlint pointed at shellcheck v0.9.0 in a container;
  shellcheck v0.9.0 clean on `assert-no-test-hooks.sh` and `run-webdriver-local.sh`.
- Published 1.2.0-rc.1 (`gh release download`, deleted after): the extended scanner passes the
  `.deb`, the Apple Silicon `.app.tar.gz` and the AppImage (the download needs `chmod +x` first; a
  built AppImage already has it). The same `.deb` and `.app.tar.gz`, repacked with
  `PRESTO_E2E_VERIFIED_SITES_URL` / `_PUBKEY` appended to the executable, fail with "contains
  PRESTO_E2E_". A `.deb` without `data.tar.*` and a non-gzip `.tar.gz` fail as "did not extract".
- The launchers' extraction, run against the feed on a temp history: the URL has the contract's shape,
  the exported key equals `core/tests/fixtures/verified_sites/test2.pub` byte for byte, and killing
  the group leaves no feed.

## Mutations

| Mutation | Caught by |
|---|---|
| Drop the `.deb` target from the release step | release-contract: the per-OS calls |
| Move the release step after "Upload artifacts" | release-contract: its place |
| Sign the `tampered` list validly | feed test (`valid: true`); at integration, spec step 3 |
| Append a newline to the signature inside `envelope` | feed test: the committed envelope |
| Drop `PRESTO_E2E_VERIFIED_SITES_PUBKEY` from the teeth loop | K5 |
| Stop exporting `PRESTO_E2E_TRAY_REPORT` in the local runner | L4 |

Not runnable here: "skip the refresh (step 4 fails)" and the spec's own run need the Rust hook.

## Left for integration

- K2 turns green once `e2e_tray.rs` reads both names.
- `history/1` does not exist yet, so the feed (like `build.rs`) refuses to start from the real
  history; the spec, `run-webdriver-local.sh` (every spec), the WebDriver build failing the scanner
  and a release-profile build passing it all wait for it and the Rust hook.
- I7 (refreshing an auth window) is first exercised by this spec.
- Estimated spec runtime 20–30 s per platform (popup 1–3 s, three reloads at about 2 s each, polls
  bounded at 5 s); measure at integration.
- `autostart-test.sh` still copies `verified-sites.json` only; `build.rs` will need `verified-sites/`.

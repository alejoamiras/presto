# Presto

Native prover for Aztec transactions. Bypasses browser WASM throttling by running the `bb` proving binary natively on your machine, exposed via a localhost HTTP server that the SDK auto-detects.

If every dApp in the ecosystem uses `PrestoProver` with accelerated mode, a single install of this app gives users native-speed proving across all of them — no per-app setup, no downside.

[![Presto](https://github.com/alejoamiras/presto/actions/workflows/presto.yml/badge.svg)](https://github.com/alejoamiras/presto/actions/workflows/presto.yml)

> **dApp developer?** You're looking for the [SDK package](../sdk/README.md) — `npm install @alejoamiras/presto` gives your app native proving with zero user-side configuration.

## Installation

Download the latest release from [GitHub Releases](https://github.com/alejoamiras/presto/releases):

| Platform | Format |
|----------|--------|
| macOS (Apple Silicon) | `.dmg` |
| macOS (Intel) | `.dmg` |
| Linux (x86_64) | `.deb`, `.AppImage` |
| Windows (x86_64) | `.exe` |

**Running CI tests?** The release also ships a [headless server tarball](#headless-server-for-ci-test-acceleration) for accelerating end-to-end tests on GitHub-hosted runners.

### First installation

Presto 1.0.0 is a new, separate installation. Quit any other local prover before launching
Presto. It uses fresh state in `~/.presto`, fresh certificates, and fresh OS integrations.
It never migrates or modifies another application's data or installation.
See the [migration guide](../sdk/MIGRATION.md) for the SDK API changes and manual installation.

### macOS Gatekeeper

The app is code-signed and notarized by Apple. It should open without any Gatekeeper warnings. If macOS still blocks it (e.g., a local build), allow it via:

1. Open **System Settings → Privacy & Security**
2. Scroll to the "Security" section
3. Click **Open Anyway** next to the Presto message

### Linux

**Wayland tray icon limitation:** Tauri's system tray does not render on GNOME Wayland ([tauri-apps/tauri#14234](https://github.com/tauri-apps/tauri/issues/14234)). The `.deb` package includes a workaround that forces the X11 GDK backend via the `.desktop` file, so the tray icon appears correctly out of the box.

If you use the `.AppImage` on Wayland and the tray icon is missing, launch with:

```sh
GDK_BACKEND=x11 ./presto.AppImage
```

For a tray-only app with no visible window, X11 mode has zero downsides.

## How It Works

The presto runs as a **menu bar / system tray app** with no window — just a tray icon with a status menu.

When running, it listens on `http://127.0.0.1:59833` for proving requests from the SDK. The flow:

```
Browser (SDK)  →  HTTP POST /prove  →  Presto  →  bb binary  →  proof
                  (localhost:59833)     (Tauri app)     (native)
```

Browser SDK instances probe HTTPS for private proving by default and pin it after success. If HTTPS
cannot connect, the SDK may use HTTP only for a bounded, witness-free health diagnosis; it never
sends an HTTP `/prove` or witness automatically, and proving falls back to WASM. Node/Bun/SSR retain
the dual HTTP/HTTPS behavior needed by the headless CI server.

### Proving Timing

Every `/prove` response includes an `x-prove-duration-ms` header with the actual `bb` proving time in milliseconds. The SDK surfaces this via the `"proved"` phase callback, and the frontend displays it in the step breakdown — making it easy to see how much time is pure proving vs. network/serialization overhead.

### Proving any Noir circuit (`POST /prove/ultra-honk`)

`/prove` is Aztec's client-IVC (`chonk`) path. Since Presto 1.1.0 a second route proves **any compiled Noir circuit** with bb's `ultra_honk` scheme — what `@aztec/bb.js`'s `UltraHonkBackend` does in WASM, run natively. `/health.schemes` lists `["chonk", "ultra_honk"]` when both are served.

Request: `Content-Type: application/json`, a flat object of strings.

| Field | Value |
|---|---|
| `bytecode` | the compiled artifact's `bytecode` string verbatim (the base64 gzipped ACIR nargo writes into `circuit.json`) |
| `witness` | base64 of the gzipped witness (`witness.gz` as written by `nargo execute` / `bb.js`'s `compressWitness`) |
| `verifier_target` | one of bb's `-t` values: `evm`, `evm-no-zk`, `noir-recursive`, `noir-recursive-no-zk`, `noir-rollup`, `noir-rollup-no-zk`, `starknet`, `starknet-no-zk` |
| `vk` | optional, base64 of the verification key for that circuit **and target**. Omitted → bb computes it (`--write_vk`) and the response carries it |

Response `200`: `{ "proof": "<base64>", "public_inputs": "<base64>", "vk": "<base64>" }` — raw bb output bytes, 32-byte fields; `public_inputs` is empty for a circuit without public inputs; `vk` is present only when the server computed it (a client-supplied key is never echoed); `x-prove-duration-ms` as on `/prove`. `x-aztec-version` selects the `bb` exactly like `/prove`. Only the `*-no-zk` targets are byte-reproducible (ZK targets add prover randomness); bb 5.2.0 accepts the two `starknet` targets on the command line but refuses them at prove time, which surfaces as `prove_failed`.

Errors are `text/plain` like `/prove`: `400 invalid_request` (shape, base64, gzip, size), `400 invalid_verifier_target`, `403` on a denied or revoked origin, `429 origin_queue_full` (one origin may have at most 4 UltraHonk jobs in flight; `429 prove_queue_full` is the global cap), `500 prove_failed` (bb exited non-zero — including a key that does not match the circuit, which under bb's default key policy yields a proof that fails verification rather than an up-front rejection).

**Trust boundary.** The route crosses no boundary `/prove` does not already cross: the same loopback `Host` guard, the same origin approval (with a re-check after the queue wait, so an origin removed in Settings while a job was waiting is denied), and the same `bb` child containment (timeout, kill-tree, owner-only 0600 workspace). Inputs reach `bb` only as files, never as arguments; `verifier_target` is parsed into a closed enum at ingress. Decoded inputs are capped (bytecode 16 MiB, witness 32 MiB, key 64 KiB, gzip inflate 256 MiB) and a request that exceeds a cap is rejected before proving starts. A wrong key can only spoil that caller's own proof.

## Configuration

### Port

The default port is `59833`. The SDK reads `PRESTO_PORT` to override the client-side target. The desktop app always binds `127.0.0.1:59833`. The headless server accepts `--port <n>` for parallel instances, but only together with a private `PRESTO_HOME` (see [headless configuration](#configuration-1)) — two instances must never share one config or version cache.

### Automatic Version Management

The presto automatically downloads and caches `bb` binaries on demand. When the SDK sends a prove request for an Aztec version the presto doesn't have yet, it downloads the correct binary from Aztec's GitHub releases, caches it, and uses it immediately.

Cached binaries are stored in `~/.presto/versions/` with a retention policy per network tier:

| Tier | Example | Kept |
|------|---------|------|
| Nightly | `5.0.0-nightly.20260309` | 2 |
| Devnet | `5.0.0-devnet.20260309` | 3 |
| Testnet | `5.0.0-rc.2` | 5 |
| Mainnet | `5.0.0` | all |

Old versions are evicted automatically — no manual cleanup needed.

### Version Model — why an Aztec bump doesn't re-release this app

Because the presto downloads `bb` at runtime (above), it is **decoupled from the Aztec protocol version**. When Aztec ships a new release, only the [SDK](../sdk/README.md) is republished — it carries the `@aztec/*` deps and advertises its version via the `x-aztec-version` header. The **already-installed presto** (desktop *and* headless) fetches and caches the matching `bb` on the next prove request; users do nothing. You cut a new presto release only when the presto's **own** code changes (server, tray, updater, or the `bb` download/verification logic) — never merely to track an `@aztec` version bump.

### bb Binary Resolution

When **no specific version** is requested (or the bundled version is), the presto looks for the `bb` binary in this order:

1. **`BB_BINARY_PATH` env var** — explicit override (CI, testing)
2. **Sidecar** — bundled with the app (`binaries/bb`)
3. **`~/.bb/bb`** — user-installed via the Aztec CLI
4. **`PATH`** — system-wide installation

When a **specific version is requested**, the *only* acceptable source is the marker-verified version cache — the presto never falls back to the sidecar/`~/.bb`/`PATH` for a requested version (that would silently run the wrong or an unverified `bb` over your private witness).

### Cache Integrity (F-007)

Every cached `bb` is verified end-to-end. On download (both the runtime and `bun run bb:download`), the tarball is checked against the GitHub release asset's published SHA-256 digest, decompressed under a cumulative size cap (gzip-bomb defense) into a private, owner-only staging directory (rejecting symlink/hardlink/non-regular/extra members), ad-hoc re-signed on macOS, then published alongside a `bb.sha256.json` **marker** recording the archive + final-binary digests. Publish is fail-closed delete-then-rename (a crash leaves no live entry ⇒ verified re-download next use), not an atomic replacement. Before every prove, the runtime **re-hashes** the cached binary against its marker; a missing, malformed, or mismatched marker fails closed and triggers a fresh verified re-download.

- **Legacy caches** (populated before this change, with no marker) re-download on first use.
- **Offline** machines with an unmarked cache fail closed until an online verified re-download.
- **`BB_BINARY_PATH`** is a trusted, unverified operator override — the one documented exception to "nothing unverified runs" (whoever sets the process environment already controls the process).
- Only releases that expose an asset digest (GitHub added these June 2025) are downloadable; older releases fail closed.

### Windows bb.exe pin provenance (F-008)

Windows has no npm `bb`, so `bb.exe` ships as a sidecar fetched from a GitHub release and pinned by SHA-256 in `scripts/copy-bb.ts` (`WINDOWS_BB_CHECKSUMS`). Pins are **never auto-generated** — auto-downloading and recording the hash is circular ("trust whatever arrived"). Each pin is a structured `{ sha256, provenance, note }`; the resolver only accepts `provenance: "manual-review"` (a human reviewed the release + recorded the hash) and fails closed on anything else. A new bb version with no pin leaves the `@aztec` bump PR **open** (`merge_mode: none`) with a red Windows gate until a human adds a reviewed pin. `manual-review` is a **change-detector**, not cryptographic proof — AztecProtocol does not yet sign/attest bb releases (the same upstream-signing gap as F-007); `attestation` provenance is reserved for when they do. See `implementations-plan/security-hardening/clusters/C7-runbook.md` for how to add a pin + the ruleset-bypass readback the fail-closed guarantee depends on.

## Site Authorization

The presto uses a MetaMask-style approval flow. When a new website calls `/prove`, the user sees a popup asking to allow or deny access. **Localhost origins are prompted once too** (then remembered, like any other origin) — the desktop app no longer silently auto-approves localhost, so a malicious local page can't quietly use the presto. (The headless CI server *does* auto-approve localhost — it's an operator-controlled environment; see the [Headless Server section](#headless-server-for-ci-test-acceleration).)

- **Allow**: the origin is saved to `~/.presto/config.json` and never prompted again. The
  popup says so ("Stays approved until you remove it in Settings") — approving is permanent, and
  Settings → Approved Sites is where you undo it.
- **Deny**: the SDK receives a `403` (nothing is saved) and automatically falls back to WASM proving
- **Timeout** (60s): auto-denied if the user doesn't respond

There is deliberately no "allow once". The option that existed until 1.0.8 persisted *nothing at
all* — not a session, not a TTL — so it re-prompted on the very next proof; see
`implementations-plan/pre-release-polish/decision-allow-once.md` for why it was removed and what
replaced it.

Approved sites can be reviewed and removed from the Settings window.

For the headless server binary (CI/testing), set `ALLOWED_ORIGINS=origin1,origin2` to restrict browser-driven access. See the [Headless Server section](#headless-server-for-ci-test-acceleration) below for the full security model.

## Headless Server for CI Test Acceleration

> **For CI test acceleration only. Not for production. Not for shared or self-hosted CI runners.**
>
> The headless server is a standalone binary — no tray, no window, and (since the core extraction) **no Tauri / WebKit / GTK** in its dependency tree. It exists so external Aztec dApp teams can install the presto on their CI runners and speed up E2E test proving (native `bb` instead of WASM). Built from the GUI-agnostic `presto-core` crate, the Linux tarball has no desktop dependencies — on GitHub-hosted `ubuntu-latest` it runs out of the box.
>
> **Security caveats — read before deploying:**
>
> - The server listens on `127.0.0.1` only, AND (SEC-01a) every request must carry a loopback `Host`/`:authority` (`127.0.0.1` / `localhost` / `[::1]`) on the listener port — this closes the DNS-rebinding vector where a remote web page rebinds its domain to loopback. A forged/non-loopback `Host` is rejected with `403 invalid_host` before any route logic.
> - **Deny-by-default (SEC-01c):** with `ALLOWED_ORIGINS` unset the server now **gates** browser origins and **denies any non-localhost origin** (localhost/`127.0.0.1`/`[::1]` stay auto-approved). Set `ALLOWED_ORIGINS=a,b` to pre-approve specific origins, or pass `--allow-all` / `PRESTO_ALLOW_ALL=1` to opt back into approving every origin (mutually exclusive with `ALLOWED_ORIGINS` → fails loud). Unset no longer means "approve everyone".
> - Non-browser callers on the **same host** (curl, another local process) can still reach `/prove` (loopback `Host`, no `Origin`) — inherent to a localhost service. Acceptable for single-tenant CI but **unsafe for shared/self-hosted runners or any production environment**.
> - The tarball is shipped with a SHA-256 sidecar only, not a cryptographic signature. Verify the checksum before extracting.
> - Do not run this as a service. Do not expose it on a public interface. Do not use on a multi-tenant host.

### Download

Each [GitHub release](https://github.com/alejoamiras/presto/releases) ships four tarballs:

| Platform | Tarball |
|---|---|
| macOS (Apple Silicon) | `presto-server-${VERSION}-macos-arm64.tar.gz` |
| macOS (Intel)         | `presto-server-${VERSION}-macos-x86_64.tar.gz` |
| Linux (x86_64)        | `presto-server-${VERSION}-linux-x86_64.tar.gz` |
| Linux (ARM64)         | `presto-server-${VERSION}-linux-arm64.tar.gz` |

Each has a matching `.sha256` sidecar file.

### Install in GitHub Actions (Linux x86_64 example)

```yaml
- name: Install presto headless server
  env:
    PRESTO_VERSION: "1.0.6"
  run: |
    BASE_URL="https://github.com/alejoamiras/presto/releases/download/presto-v${PRESTO_VERSION}"
    TARBALL="presto-server-${PRESTO_VERSION}-linux-x86_64.tar.gz"
    curl -sSfL "${BASE_URL}/${TARBALL}" -o "${TARBALL}"
    curl -sSfL "${BASE_URL}/${TARBALL}.sha256" -o "${TARBALL}.sha256"
    shasum -a 256 -c "${TARBALL}.sha256"
    tar -xzf "${TARBALL}"
    sudo mv presto-server /usr/local/bin/

- name: Start headless presto
  env:
    ALLOWED_ORIGINS: http://localhost:5173
  run: presto-server > presto.log 2>&1 &
```

The presto will download the matching `bb` binary on the first prove request (from Aztec's GitHub releases) and cache it in `~/.presto/versions/`. Subsequent runs reuse the cache.

### Configuration

| Env var | Effect |
|---|---|
| `ALLOWED_ORIGINS` | Comma-separated browser origins pre-approved for `/prove`. **Unset = deny-by-default** (non-localhost denied; localhost auto-approved). Mutually exclusive with `--allow-all` / `PRESTO_ALLOW_ALL`. |
| `PRESTO_ALLOW_ALL` | `1` or `true` → approve **all** browser origins (the pre-SEC-01 behavior). Opt-in; mutually exclusive with `ALLOWED_ORIGINS`. Prefer `ALLOWED_ORIGINS` for an explicit allowlist. (`--allow-all` CLI flag is equivalent.) |
| `BB_BINARY_PATH` | Path to a pre-installed `bb` binary, bypassing the auto-download. |
| `PRESTO_HOME` | Private state directory (`config.json`, `versions/`, `data/`) instead of the per-user defaults. Required by `--port`, so parallel instances on one host never share state. The bb CRS (`~/.bb-crs`) stays shared. |
| `RUST_LOG` | Standard `tracing-subscriber` filter (e.g. `info`, `debug`). |

CLI flags: `--allow-all` (see above) and `--port <n>` (loopback port other than 59833; refused without `PRESTO_HOME`).

### Verifying it's running

```sh
curl http://127.0.0.1:59833/health
# {"status":"ok","api_version":1,"schemes":["chonk","ultra_honk"],"version":"...","aztec_version":"...","available_versions":[...],"bb_available":true,"versions":[{"aztec_version":"...","bb_version":"..."}]}
```

### Source

The headless server is its own Cargo crate at `packages/presto/server/`, separate from the desktop `src-tauri/` crate so that `tauri build` cannot pick it up and stowaway it into the desktop `.app` bundle (the root cause of the 1.0.1 auto-update breakage). It depends on the GUI-agnostic **`presto-core`** crate (`packages/presto/core/`) via a path dep to reuse the shared `server`, `authorization`, `config`, `bb`, and `versions` modules — with **none** of the Tauri / WebKit dependency tree. That core extraction is what lets the headless build stay desktop-dependency-free.

Build it with:

```sh
cargo build --release --manifest-path packages/presto/server/Cargo.toml
```

The binary lands at `packages/presto/server/target/release/presto-server`. The entry point is `packages/presto/server/src/main.rs` — same logic as the embedded server in the desktop app, just bootstrapped without Tauri's main loop.

## Tray Menu

The tray menu adapts based on the build profile:

**Production** (release builds):
```
Settings
─────────────
v1.1.0 · Aztec 5.0.0-nightly.20260309
GitHub
Quit
```

**Development** (debug builds via `cargo tauri dev`):
```
Status: Idle
▸ Versions
  Show Logs
  Settings
─────────────
v1.1.0 · Aztec 5.0.0-nightly.20260309
GitHub
Quit
```

### Settings Window

Click **Settings** in the tray menu to open the Settings window. From here you can:

- **Approved Sites** — view and remove origins that have been granted access
- **Start on Login** — auto-launch at login (LaunchAgent on macOS, autostart on Linux)
- **Auto-Update** — toggle automatic updates on or off
- **Safari Support** (macOS only) — toggle HTTPS mode for Safari compatibility
- **Proving Speed** — control CPU usage with a 5-level slider (Low / Light / Balanced / High / Full)

Speed changes take effect immediately on the next prove request — no restart needed.

### Auto-Update

The presto checks for updates on launch and every 12 hours. Updates are signed with Ed25519 and verified before installation.

On the first update, you'll see a prompt:
- **Update Now** — downloads, installs, and restarts immediately
- **Remind Me Later** — dismisses the prompt (it returns next launch)
- **Keep me updated automatically** — checkbox that enables silent future updates

With auto-update enabled, new versions are downloaded and installed in the background — the app restarts seamlessly. You can change this anytime in Settings.

### Encrypted Connection (HTTPS)

HTTPS between your browser and the presto is **default-on** on macOS, Linux, and Windows,
consented through the first-run onboarding wizard (you can opt out). Safari *requires* it (it blocks
plain HTTP from an HTTPS page); Chrome/Firefox/Edge also require trusted HTTPS for browser proving by
default. If the secure connection is unavailable, the SDK reports recovery detail to the dApp and
uses WASM without automatically activating HTTP proving (see the SDK README).

Enable/disable anytime via the **Encrypted Connection (HTTPS)** toggle in Settings, or re-run the
wizard from Settings → "Run setup again". When a dApp reports a TLS/trust failure, re-running setup
repairs certificate trust; restart the affected browser where the platform notes below require it.

**Consent per OS** (installing the certificate):
- **macOS** — a password dialog (login Keychain).
- **Windows** — happens when you click Start in the wizard; no separate dialog is guaranteed.
- **Linux** — happens on Start; there is no OS dialog. Installs into your user NSS databases
  (`~/.pki/nssdb` for Chrome/Chromium/Brave/Edge, and each Firefox profile) via `certutil` — no root.
  The `.deb` depends on `libnss3-tools`; restart Firefox after enabling. Sandboxed snap/flatpak
  Chromium keeps a private store the app can't reach (shown as such).

**What it installs:** A local Certificate Authority (`Presto Local CA`), **keyless** (its
signing key is generated in memory, signs one `localhost` leaf, then is discarded — never written to
disk, so the trusted anchor can mint nothing) and Name-Constrained to `127.0.0.1`, `::1`, and
`localhost` only.

**To remove:** Settings → **Remove certificate trust** (all OSes). On Windows the uninstaller also
removes it; on macOS you can alternatively delete it from Keychain Access; on Linux you can run
`Presto --remove-ca-trust`.

**Full uninstall cleanup (non-Windows).** The Windows NSIS uninstaller runs the teardown automatically.
On macOS (`.app`) and Linux (`.deb`/AppImage) there is no uninstall hook, so before deleting the app run:

```bash
Presto --prepare-uninstall
```

It removes the autostart entry, the crash-recovery task, and — only if THIS install owns them — the CA
trust and generated certs (`~/.presto/certs/`). It is ownership-checked: if a second (copied)
install still shares this account's state it leaves everything shared and says so, exiting non-zero only on
a real failure. Your config and approved origins (`~/.presto/config.json`) are never touched.
The `scripts/uninstall.sh` wrapper locates the binary and runs this for you.

**Certificate details:**
- CA: ECDSA P-256, 10-year validity, keyless, Name Constraints (localhost only)
- Leaf: ECDSA P-256, 824-day validity (one day under Apple's inclusive 825-day TLS cap), auto-renewed
  (silently on Linux; via a renewal consent window on macOS/Windows)
- Storage: `~/.presto/certs/`

## Version Compatibility

The presto supports multiple Aztec versions simultaneously. The `/health` endpoint reports the bundled version, all cached versions, the proving schemes the routes serve, and — for approved origins — which `bb` each Aztec version maps to:

```json
{
  "status": "ok",
  "api_version": 1,
  "schemes": ["chonk", "ultra_honk"],
  "version": "1.1.0",
  "aztec_version": "5.0.0-nightly.20260309",
  "available_versions": ["5.0.0-nightly.20260309", "5.0.0-nightly.20260308"],
  "bb_available": true,
  "versions": [{ "aztec_version": "5.0.0-nightly.20260309", "bb_version": "5.0.0-nightly.20260309" }]
}
```

Unapproved origins get the minimal body (`status`, `api_version`, `schemes`). A client selects the version with the `x-aztec-version` header on any prove route; when the SDK requests a version that isn't cached, the presto downloads it automatically. If the download fails, the SDK falls back to WASM proving.

## Troubleshooting

### Logs

The presto writes daily-rotating logs. Open the log directory from the tray menu (**Show Logs**, available in every build) or find them at:

| Platform | Path |
|----------|------|
| macOS | `~/Library/Application Support/presto/logs/` |
| Linux | `~/.local/share/presto/logs/` |
| Windows | `%LOCALAPPDATA%/build.presto.presto/logs/` |

A crash additionally appends a one-line record (timestamp, location, message) to `panic.log` in that same directory — written synchronously so it survives even an immediate abort.

### Port Conflicts

If port 59833 is already in use, the presto will fail to start. Check for conflicts:

```sh
lsof -i :59833
```

### bb Binary Not Found

If no `bb` binary is found, the `/health` endpoint returns `"bb_available": false` and `/prove` requests return a 500 error. The presto will attempt to download the binary automatically when a versioned prove request arrives. To install manually:

```sh
curl -s https://install.aztec.network | bash
aztec install
```

## Development

```sh
# Prerequisites: Rust toolchain, CMake, Tauri CLI
cargo install tauri-cli

# Copy bb binary for sidecar (reads version from @aztec/bb.js)
bun run --filter presto prebuild

# Run in development mode (debug build — the menu additionally shows the Versions submenu + status item)
cd packages/presto/src-tauri
cargo tauri dev

# Run Rust tests (~90 tests)
cargo test

# Build release bundle (.dmg / .deb / .AppImage)
cargo tauri build

# Quick-run the production menu locally (release build, no bundling)
cargo run --release
```

## Testing

### Rust tests (~445 across `core`, `server`, `src-tauri`)
```bash
cargo test --locked --manifest-path packages/presto/core/Cargo.toml
cargo test --locked --manifest-path packages/presto/server/Cargo.toml
cargo test --locked --manifest-path packages/presto/src-tauri/Cargo.toml
# real bb over the committed Noir fixtures (needs a bb and the CRS; CI's ultra-honk-real-bb lane)
BB_BINARY_PATH=... cargo test --locked --manifest-path packages/presto/core/Cargo.toml --test ultra_honk_real_bb -- --ignored
```

### Playwright UI mock tests (28)
Tests the Settings, Authorization, and Update Prompt windows with mocked Tauri IPC:
```bash
bun run --cwd packages/presto test:e2e:ui
```

### WebDriver E2E tests
Real end-to-end tests that launch the actual Tauri app via `tauri-plugin-webdriver` and drive it with WebdriverIO. Covers smoke (app health), settings (speed persistence), theme, the trust boundary, auth flow (Allow persists, Deny does not), and UltraHonk proving (consent popup → native proof of the committed Noir fixture, byte-equal to the bb.js WASM reference and verified by the sidecar `bb`).

```bash
# Terminal 1: launch app with WebDriver
cargo tauri dev --features webdriver

# Terminal 2: run tests (DISPLAY must be set on Linux, or wdio wraps its workers in xvfb-run and breaks their IPC)
bun run --cwd packages/presto test:e2e:webdriver
```

These run on macOS, Linux, and Windows in CI as a PR gate (`presto.yml`) and pre-release gate (`release-presto.yml`).

### Automated release acceptance

The packaged Linux/macOS browser lanes exercise the native HTTPS proving path; the desktop
WebDriver and updater matrices cover the supported OSes. The full-stack browser consent test
must pass against the candidate and packaged app before stable promotion. Do not substitute
a manual HTTPS/LNA/settings matrix for these gates. See the [release runbook](../../docs/RELEASE_RUNBOOK.md).

### Cross-version download test
Tests the full bb binary download pipeline (HTTP → SHA-256 → extract → cache). Gated behind `PRESTO_DOWNLOAD_TEST=1`:
```bash
PRESTO_DOWNLOAD_TEST=1 cargo test download_and_verify -- --nocapture
```

## Release Pipeline

Releases are triggered via `gh workflow run release-presto.yml -f version=X.Y.Z`.

```
validate → build (4 desktop + 4 headless) → isolated updater signing → platform/updater smokes → draft release → packaged E2E → tag → publish
```

- **E2E gate**: builds with `--features webdriver` and runs the real desktop WebDriver suite.
- **Build**: Tauri bundles for macOS arm64/x86_64, Linux x86_64, and Windows x86_64, plus headless `presto-server` for macOS arm64/x86_64 and Linux x86_64/arm64. Build jobs use throwaway updater keys.
- **Updater signing**: one `release-signing` environment job receives the production updater key only after tooling and the verifier are prepared. It signs exact updater payload bytes, builds signed feeds, verifies them, and does not build, install, or launch apps.
- **Release gates**: notarization/launch checks, blocking N-1→N updater smokes on macOS/Linux/Windows (including tamper rejection controls), then packaged E2E against the draft's own assets. The baseline resolver includes prereleases, selects the greatest complete published same-key release below the candidate, and fails closed if none exists. Any future updater-key rotation requires a deliberately reviewed migration change; it is not an evergreen dispatch option.
- **Release**: publishes the verified draft after pushing the reviewed commit tag. Stable releases include signed `latest.json`; prereleases do not alter the live updater feed.
- **Promote**: a separate `promote-only` dispatch verifies the 17-asset stable release and flips the live feed. With `bump_source=true`, it then opens the next-version PR.

The Windows installer is intentionally not Authenticode-signed, so SmartScreen reports an unknown publisher on first install. Updater payloads are still Ed25519-signed and verified before application.

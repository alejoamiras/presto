---
name: presto
description: Integrates the Presto SDK into an Aztec dApp. Covers PrestoProver setup, EmbeddedWallet wiring, phase callbacks for UI, Safari HTTPS compatibility, and WASM fallback patterns. Use when adding native-speed proving to an Aztec application.
argument-hint: "[setup | phases | embedded-wallet | troubleshoot]"
---

# Presto SDK Integration

You are helping a developer integrate `@alejoamiras/presto` into their Aztec dApp. The SDK provides **PrestoProver** — a drop-in prover that routes private kernel proving to a native desktop presto, with automatic WASM fallback.

## Key facts

- Package: `@alejoamiras/presto`
- Ships its `@aztec/*` as exact-pinned dependencies (installs standalone; dedupes with a host on the same exact version)
- Presto ports: HTTP `127.0.0.1:59833`, HTTPS `127.0.0.1:59834`
- Zero config by default — just `new PrestoProver()`
- Browser page/Worker default: HTTPS-only private proving; Node/Bun/SSR default: HTTP-compatible
- Transparent fallback: if presto is offline, proves via WASM silently (no errors thrown)
- An HTTPS connection failure may cause one witness-free HTTP `GET /health` diagnostic, never HTTP `/prove`

## Step-by-step integration

### 1. Install

```bash
npm install @alejoamiras/presto
```

### 2. Create the prover

```typescript
import { PrestoProver } from "@alejoamiras/presto";

const prover = new PrestoProver();
```

That's the minimal setup. The prover auto-detects the presto and falls back to WASM.

### 3. Wire into EmbeddedWallet (browser dApps)

This is the recommended pattern for browser-based Aztec applications. Pass the prover via the unified `pxe` option and let `EmbeddedWallet.create()` handle PXE setup, IndexedDB stores, and account contract loading:

```typescript
import { PrestoProver } from "@alejoamiras/presto";
import { EmbeddedWallet } from "@aztec/wallets/embedded";

const wallet = await EmbeddedWallet.create(aztecNodeUrl, {
  pxe: {
    proverEnabled: true,
    proverOrOptions: new PrestoProver(), // <-- inject here
  },
});
```

Every transaction through this wallet automatically uses native proving when available. For local sandbox development, set `proverEnabled: false` to skip proof generation.

### 4. Wire into AccountManager (simpler setup)

```typescript
import { getSchnorrAccount } from "@aztec/accounts/schnorr";

const account = getSchnorrAccount(pxe, secretKey, signingKey, Fr.ZERO, prover);
const wallet = await account.getWallet();
```

### 5. Phase callbacks (UI feedback)

Register a callback to show proving progress:

```typescript
import type { PrestoPhase, PrestoPhaseData } from "@alejoamiras/presto";

const prover = new PrestoProver({
  onPhase: (phase: PrestoPhase, data?: PrestoPhaseData) => {
    updateUI(phase, data?.durationMs);
  },
});
```

**Phase sequence:**

| Phase | Meaning | `data.durationMs` |
|-------|---------|-------------------|
| `detect` | Probing presto health | - |
| `secure-connection-unavailable` | HTTPS could not connect; immediately precedes WASM fallback | - |
| `downloading` | Presto downloading bb binary for this Aztec version | - |
| `serialize` | Serializing execution steps to msgpack | - |
| `transmit` | Sending proof request | - |
| `proving` | Native (or WASM) proving in progress | - |
| `proved` | Proof complete | Server-reported proving time |
| `fallback` | Presto unavailable, falling back to WASM | - |
| `receive` | Deserializing proof response | - |
| `denied` | User denied this site access (403) — falling back to WASM | - |

Use `setOnPhase(callback)` to change the callback later, or `setOnPhase(null)` to remove it.

### 6. Health check for status UI

`checkPrestoStatus()` returns a **discriminated union on `available`** — narrow before reading
state-specific fields (see `MIGRATION.md`):

```typescript
const status = await prover.checkPrestoStatus();
if (status.available) {
  // status.needsDownload      — presto needs to download bb for this version
  // status.protocol           — "http" or "https" (which succeeded)
  // status.nativeAztecVersion — also available here
} else {
  // status.reason — "offline" | "permission-blocked" |
  //   "secure-connection-unavailable" | "error" | "version-mismatch"
  // `permission-blocked` has no protocol: neither endpoint answered.
  // Secure-connection status also has status.diagnosis:
  // "https-disabled" | "tls-or-trust-failure" |
  // "presto-reachable" | "unconfirmed"
}
```

After a user changes Chrome's local-network setting, retry immediately with
`prover.checkPrestoStatus({ forceRefresh: true })`. This bypasses only the settled ten-second
cache and still joins an existing same-generation probe.

### 7. Force WASM mode (testing/benchmarking)

```typescript
prover.setForceLocal(true);   // bypass presto, use WASM
prover.setForceLocal(false);  // re-enable presto
```

### 8. Custom ports

```typescript
const prover = new PrestoProver({
  presto: { port: 51337, httpsPort: 51338 },
});

// Or reconfigure later (clears cached protocol)
prover.setPrestoConfig({ port: 51337 });
```

Environment variables also work: `PRESTO_PORT`, `PRESTO_HTTPS_PORT`.

## HTTPS-by-default browser behavior

In browser pages and Web Workers, `httpsOnly` defaults to `true`. The SDK probes HTTPS with its
bounded startup retry. If the connection cannot be established, it performs at most one bounded,
witness-free HTTP `GET /health` diagnostic and returns:

- `https-disabled` for detailed health without `https_port`
- `tls-or-trust-failure` for detailed health advertising `https_port`
- `presto-reachable` for privacy-limited recognized health
- `unconfirmed` when the diagnostic fails, is blocked, or is not recognized

That diagnostic sends no witness, never POSTs to HTTP, never pins HTTP, and cannot make HTTP eligible
for proving. Show Presto tray → Settings → **Encrypted Connection** guidance and, for a trust
failure, ask the user to run certificate setup again. Safari may block the diagnostic itself, in
which case the result is `unconfirmed`.

Keep this recovery distinct from `permission-blocked`. If the dApp offers an HTTP escape hatch,
require a confirmation that plaintext can expose private proving data to another local user or
process, then update only the current prover instance:

```typescript
prover.setPrestoConfig({
  httpsOnly: false,
  allowInsecureDowngrade: true,
});
await prover.checkPrestoStatus({ forceRefresh: true });
```

Never persist this consent in local storage, cookies, URL parameters, or desktop configuration, and
do not add a production `?httpsOnly=false` switch. Reload/new prover must restore HTTPS-only. Node,
Bun, and SSR stay `httpsOnly: false` by default for the headless CI server. The explicit option wins
over `PRESTO_HTTPS_ONLY`, which wins over the runtime default.

## Browser Local Network Access (Chrome 142+, Firefox 153+)

Current Chrome and Firefox gate requests from public sites to loopback behind a permission prompt (Chrome 145+ and Firefox 153+ expose the dedicated `loopback-network` permission). An explicit denial returns `reason: "permission-blocked"`; under the browser HTTPS-only default, a prompt/dismissal, unsupported Permissions API, or query error normally appears as `secure-connection-unavailable` with `diagnosis: "unconfirmed"`. Show site-permission guidance and a forced Retry, but do not claim the presto is installed or healthy. Browser settings are the usual recovery, not a guarantee: managed policy may require an administrator, and an iframe may require top-level access or Permissions Policy delegation. The SDK's `targetAddressSpace: "loopback"` annotation declares intent but does not bypass permission, and HTTPS is not an escape hatch because the gate follows the destination address space. Pages served from `localhost` (local dev) are same-address-space and unaffected.

## Error handling

The SDK is designed to be fail-safe:

- **Presto offline**: automatically falls back to WASM (no error thrown)
- **Browser loopback permission denied**: `checkPrestoStatus()` returns `permission-blocked`; proving still falls back to WASM
- **Browser HTTPS unavailable**: status includes `secure-connection-unavailable` plus a diagnosis;
  the phase is emitted before `fallback`, and proving continues through WASM without enabling HTTP
- **Presto returns a RECOGNISED error**: falls back to WASM — a denial (`denied` phase), a version
  refusal (`version-mismatch` phase), an authorization cooldown, and capacity/transient errors (408, 413,
  429, 503, `500 download_failed`/`prove_failed`)
- **Version mismatch**: modern prestos auto-download the right bb version

The cases that THROW are: corrupted execution steps, simulator unavailability, and — new in the typed
error surface — a caller **misconfiguration** (`400 invalid_version`/`invalid_origin`), a `500` with an
**unrecognised** code, or any other unexpected HTTP status, surfaced as a typed `PrestoHttpError`
(`.status`, `.code`) rather than masked as WASM. The degrade set is matched by status: **every** `403`
(denial/version/cooldown) and **every** `408`/`413`/`429`/`503` falls back regardless of its `code`, so an
unknown `403`/`503` code degrades — it does not throw.

## Vite configuration (browser bundling)

Aztec packages need Node.js polyfills in the browser. Use `vite-plugin-node-polyfills`:

```typescript
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig({
  plugins: [
    nodePolyfills({ include: ["buffer", "path"], globals: { Buffer: true } }),
  ],
  optimizeDeps: {
    exclude: ["@aztec/noir-acvm_js", "@aztec/noir-noirc_abi"],
  },
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless",
    },
  },
  build: { target: "esnext" },
});
```

COOP/COEP headers are required for `SharedArrayBuffer` (used by WASM proving).

## Checklist

- [ ] `npm install @alejoamiras/presto`
- [ ] Create `new PrestoProver()` and pass to PXE or wallet
- [ ] Register `onPhase` callback for UI progress (optional)
- [ ] Use `checkPrestoStatus()` for status indicators (optional)
- [ ] Handle `secure-connection-unavailable` separately from `permission-blocked`
- [ ] If offering HTTP, require confirmation, keep it instance-only, and set both policy flags
- [ ] Test with presto offline to verify WASM fallback works
- [ ] Configure Vite with `nodePolyfills` and COOP/COEP headers (browser apps)

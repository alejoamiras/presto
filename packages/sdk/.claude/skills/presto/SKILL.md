---
name: presto
description: Integrates the Presto SDK into an Aztec dApp. Covers asking the visitor before the first request to Presto (browsers show a Local Network Access permission prompt), PrestoProver setup, EmbeddedWallet wiring, phase callbacks for UI, Safari HTTPS compatibility, and WASM fallback patterns. Use when adding native-speed proving to an Aztec application.
argument-hint: "[setup | phases | embedded-wallet | troubleshoot]"
---

# Presto SDK Integration

You are helping a developer integrate `@alejoamiras/presto` into their Aztec dApp. The SDK provides **PrestoProver** — a drop-in prover that routes private kernel proving to a native desktop presto, with automatic WASM fallback.

## Key facts

- Package: `@alejoamiras/presto`
- Ships its `@aztec/*` as exact-pinned dependencies (installs standalone; dedupes with a host on the same exact version)
- Presto ports: HTTP `127.0.0.1:59833`, HTTPS `127.0.0.1:59834`
- Zero config by default — just `new PrestoProver()`; constructing it sends nothing
- **Never contact Presto on page load in a browser.** The first status check or proof makes Chrome
  142+ and Firefox 153+ ask the visitor to let the site reach apps on their device. Keep the prover
  local until the visitor clicks Connect (see "Ask before you probe")
- Browser page/Worker default: HTTPS-only private proving; Node/Bun/SSR default: HTTP-compatible
- Transparent fallback: if presto is offline, proves via WASM silently (no errors thrown)
- An HTTPS connection failure may cause one witness-free HTTP `GET /health` diagnostic, never HTTP `/prove`

## Ask before you probe (browser dApps)

A site that asks to reach the visitor's computer the moment it opens looks hostile, and careful users
block it. So the integration must:

1. Call `prover.setForceLocal(true)` right after constructing the prover: proofs run in WASM and send
   nothing to Presto. `setForceLocal` does **not** gate `checkPrestoStatus()`, which always sends.
2. On load, read `loopbackPermission()` (never prompts, never contacts Presto). Only `"granted"` may
   connect without a click. `"prompt"` and `"unsupported"` get a Connect button; `"denied"` gets
   instructions to allow it again in site settings (Chrome: **Apps on device**).
3. Explain the browser's question before it appears, then connect from the click. Suggested copy:
   > **Connect Presto?** Presto proves on your computer, much faster than this tab can. To reach it,
   > your browser will ask for permission to connect to apps on this device. This site only uses that
   > permission to talk to Presto, and you can turn it off in your browser's site settings.
4. Watch the decision with `watchLoopbackPermission()`; on `"denied"`, or `"prompt"` after a grant
   (a reset), force local again and ignore any check still in flight. Re-read `loopbackPermission()`
   before each proof where the browser cannot report changes.

**Do not** write `const status = await prover.checkPrestoStatus()` at startup, and do not pass a
prover that is not force-local to a wallet before the visitor connects. Both prompt on load.

Use this module as is (the SDK's tests run it; it is `packages/sdk/examples/consent.ts` in the
repository):

```typescript
import {
  type LoopbackPermissionState,
  loopbackPermission,
  type PrestoProver,
  type PrestoStatus,
  watchLoopbackPermission,
} from "@alejoamiras/presto";

/** "ask": offer Connect. "blocked": explain how to allow this site again. Otherwise a status check. */
export type PrestoView = "ask" | "blocked" | PrestoStatus;

/**
 * Keeps `prover` away from Presto until the visitor opts in, and reports what to show. Call
 * `connect()` only from a click that first says the browser may ask to let this site reach apps on
 * this device, and `beforeProving()` before each proof.
 */
export async function askBeforeConnecting(prover: PrestoProver, show: (view: PrestoView) => void) {
  let consented = false; // the visitor clicked Connect, or the browser reports "granted"
  let granted = false; // "granted" seen since then, so a later "prompt" means it was reset
  let epoch = 0; // bumped on revocation: a check that started earlier is never shown

  /** Follows the browser's decision. Returns true for a grant not seen before, which needs a check. */
  function apply(state: LoopbackPermissionState): boolean {
    const newGrant = state === "granted" && !granted;
    if (state === "granted") consented = granted = true;
    else if (state === "denied" || (state === "prompt" && granted)) {
      if (consented) epoch++;
      consented = granted = false;
    }
    prover.setForceLocal(!consented);
    if (!consented) show(state === "denied" ? "blocked" : "ask");
    return newGrant;
  }

  async function check() {
    const started = epoch;
    const status = await prover.checkPrestoStatus({ forceRefresh: true }); // the browser may ask now
    apply(await loopbackPermission()); // records the answer given at the prompt
    if (epoch === started && consented) show(status);
  }

  async function sync(state: LoopbackPermissionState) {
    if (apply(state)) await check(); // allowed earlier, in site settings, or in another tab
  }

  async function connect() {
    const state = await loopbackPermission(); // never prompts, never contacts Presto
    if (state === "denied") return void apply(state);
    consented = true;
    granted = state === "granted";
    await check();
  }

  /** Catches a reset or a grant in browsers that report no changes. */
  const beforeProving = async () => sync(await loopbackPermission());

  const stop = await watchLoopbackPermission((state) => void sync(state));
  await sync(await loopbackPermission());
  return { connect, beforeProving, stop };
}
```

```typescript
const prover = new PrestoProver(); // the same instance the wallet gets
const presto = await askBeforeConnecting(prover, (view) => {
  if (view === "ask") showConnectButton(); // with the explanation above
  else if (view === "blocked") showSiteSettingsHelp();
  else renderPrestoStatus(view); // a PrestoStatus
});
connectButton.addEventListener("click", () => presto.connect());
await presto.beforeProving(); // before sending each transaction
```

`@alejoamiras/presto-banners` renders the ask for you: `banner.state = "connect"` for `"ask"`,
`"permission-blocked"` for `"blocked"`, `banner.status = view` otherwise, and call
`presto.connect()` on `presto-banner:connect`.

## Step-by-step integration

### 1. Install

```bash
npm install @alejoamiras/presto
```

### 2. Create the prover

```typescript
import { PrestoProver } from "@alejoamiras/presto";

const prover = new PrestoProver();
prover.setForceLocal(true); // WASM only until the visitor connects Presto
```

That's the minimal setup. Once the visitor connects (`setForceLocal(false)` from the explained
click, as above), the prover detects the presto and falls back to WASM when it is unavailable.

### 3. Wire into EmbeddedWallet (browser dApps)

This is the recommended pattern for browser-based Aztec applications. Pass the prover via the unified `pxe` option and let `EmbeddedWallet.create()` handle PXE setup, IndexedDB stores, and account contract loading:

```typescript
import { PrestoProver } from "@alejoamiras/presto";
import { EmbeddedWallet } from "@aztec/wallets/embedded";

const prover = new PrestoProver();
prover.setForceLocal(true); // until the visitor connects; keep this instance for askBeforeConnecting

const wallet = await EmbeddedWallet.create(aztecNodeUrl, {
  pxe: {
    proverEnabled: true,
    proverOrOptions: prover, // <-- inject here
  },
});
```

After the visitor connects, every transaction through this wallet uses native proving when available. For local sandbox development, set `proverEnabled: false` to skip proof generation.

### 4. Wire into AccountManager (simpler setup)

```typescript
import { PrestoProver } from "@alejoamiras/presto";
import { getSchnorrAccount } from "@aztec/accounts/schnorr";

const prover = new PrestoProver();
prover.setForceLocal(true); // until the visitor connects
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
prover.setForceLocal(true); // until the visitor connects
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

`checkPrestoStatus()` sends a request, so call it only after the visitor connects (or when
`loopbackPermission()` is already `"granted"`). It returns a **discriminated union on `available`**
— narrow before reading state-specific fields (see `MIGRATION.md`):

```typescript
const status = await prover.checkPrestoStatus(); // after the user connects
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

### 7. Force WASM mode (consent gate, testing)

```typescript
prover.setForceLocal(true);   // prove in WASM, send nothing to Presto
prover.setForceLocal(false);  // allow Presto again (from the visitor's Connect click)
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
await prover.checkPrestoStatus({ forceRefresh: true }); // after the user connects
```

Never persist this consent in local storage, cookies, URL parameters, or desktop configuration, and
do not add a production `?httpsOnly=false` switch. Reload/new prover must restore HTTPS-only. Node,
Bun, and SSR stay `httpsOnly: false` by default for the headless CI server. The explicit option wins
over `PRESTO_HTTPS_ONLY`, which wins over the runtime default.

## Browser Local Network Access (Chrome 142+, Firefox 153+)

Current Chrome and Firefox gate requests from public sites to loopback behind a permission prompt (Chrome 145+ and Firefox 153+ expose the dedicated `loopback-network` permission). An explicit denial returns `reason: "permission-blocked"`; under the browser HTTPS-only default, a prompt/dismissal, unsupported Permissions API, or query error normally appears as `secure-connection-unavailable` with `diagnosis: "unconfirmed"`. Show site-permission guidance and a forced Retry, but do not claim the presto is installed or healthy. Browser settings are the usual recovery, not a guarantee: managed policy may require an administrator, and an iframe may require top-level access or Permissions Policy delegation. The SDK's `targetAddressSpace: "loopback"` annotation declares intent but does not bypass permission, and HTTPS is not an escape hatch because the gate follows the destination address space. Pages served from `localhost` (local dev) are same-address-space and unaffected, so test the consent flow on a deployed preview, not only on localhost.

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
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  build: { target: "esnext" },
});
```

COOP/COEP headers are required for `SharedArrayBuffer` (used by WASM proving). Send the same pair
from your production host. Use `require-corp`: Safari and other WebKit-based browsers ignore
`credentialless`, so the page is not cross-origin isolated there and WASM proving runs on one
thread (about 3x slower in our Playwright WebKit benchmark). `require-corp` blocks a cross-origin
subresource unless it loads in CORS mode or its `Cross-Origin-Resource-Policy` permits your
origin. Fall back to `credentialless` only for `no-cors` subresources you cannot change that load
fine without credentials, and accept single-threaded proving in WebKit. Neither value lets you
embed an ordinary cross-origin iframe whose document does not send its own COEP;
`<iframe credentialless>` is a separate mechanism that not every browser supports.

## Checklist

- [ ] `npm install @alejoamiras/presto`
- [ ] Create one `new PrestoProver()`, call `setForceLocal(true)`, and pass that instance to PXE or wallet
- [ ] Nothing contacts Presto on page load: no `checkPrestoStatus()` before consent unless `loopbackPermission()` is `"granted"`
- [ ] A Connect button explains the browser's permission question before it appears, then connects
- [ ] `watchLoopbackPermission()` forces local on a reset; `loopbackPermission()` re-read before each proof
- [ ] `denied` shows how to allow the site again in site settings
- [ ] Register `onPhase` callback for UI progress (optional)
- [ ] Use `checkPrestoStatus()` for status indicators after the visitor connects (optional)
- [ ] Handle `secure-connection-unavailable` separately from `permission-blocked`
- [ ] If offering HTTP, require confirmation, keep it instance-only, and set both policy flags
- [ ] Test with presto offline to verify WASM fallback works
- [ ] Configure Vite with `nodePolyfills` and COOP/COEP headers (browser apps)

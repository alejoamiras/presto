# Migration guide

## Aztec Accelerator → Presto

Presto is a separate installation and npm package. Install Presto manually, quit Aztec
Accelerator before starting it, and approve sites and certificate setup again. Both apps use
loopback ports 59833/59834; only one can run at a time. Presto never imports, edits, removes,
or uninstalls Aztec Accelerator data, certificates, settings, caches, or binaries.

Replace `@alejoamiras/aztec-accelerator` with `@alejoamiras/presto` in dependencies and
imports. The first Presto SDK release is 5.2.0; the first stable native app is 1.0.0.
The SDK has no deprecated aliases:

| Previous API | Presto API |
| --- | --- |
| `AcceleratorProver` | `PrestoProver` |
| `AcceleratorConfig` | `PrestoConfig` |
| `AcceleratorProverOptions` | `PrestoProverOptions` |
| `AcceleratorStatus` | `PrestoStatus` |
| `AcceleratorStatusCheckOptions` | `PrestoStatusCheckOptions` |
| `AcceleratorPhase` / `AcceleratorPhaseData` | `PrestoPhase` / `PrestoPhaseData` |
| `AcceleratorProtocol` / `AcceleratorHttpError` | `PrestoProtocol` / `PrestoHttpError` |
| `ACCELERATOR_API_VERSION` | `PRESTO_API_VERSION` (wire value still 1) |
| `setAcceleratorConfig()` | `setPrestoConfig()` |
| `checkAcceleratorStatus()` | `checkPrestoStatus()` |
| Constructor option `accelerator` | `presto` |
| Status field `acceleratorVersion` | `nativeAztecVersion` |
| Diagnosis literal `accelerator-reachable` | `presto-reachable` |

`nativeAztecVersion` describes the native Aztec/bb version; `appVersion` describes the
application version. Rename product-specific `AZTEC_ACCELERATOR_*` environment variables
to `PRESTO_*`. Keep ecosystem names such as `AZTEC_NODE_URL`, `@aztec/*`,
`x-aztec-version`, and `sdkAztecVersion` unchanged.

The health/prove wire protocol remains compatible in both directions. Switching SDKs does
not require switching native apps at the same moment. HTTPS defaults, explicit per-tab HTTP
consent, witness transport, diagnostics, phases, and WASM fallback retain their behavior.

Presto lives at https://presto.build. Production downloads will be announced after release
verification gates are finalized. Do not treat a Worker preview as a stable release.

## Browsers are HTTPS-only by default

`new PrestoProver()` now resolves `httpsOnly` from the explicit option first, then
`PRESTO_HTTPS_ONLY`, then the runtime default: `true` in browser pages and Web Workers,
and `false` in Node, Bun, and SSR. Server-side clients therefore retain compatibility with the
TLS-free headless CI server.

Browser HTTPS connection failures no longer activate HTTP proving. The prover still preserves its
native-first/WASM-fallback reliability contract, but now exposes an actionable unavailable state:

```ts
type SecureConnectionDiagnosis =
  | "https-disabled"
  | "tls-or-trust-failure"
  | "presto-reachable"
  | "unconfirmed";

type PrestoStatus =
  | /* existing arms */
  | {
      available: false;
      reason: "secure-connection-unavailable";
      diagnosis: SecureConnectionDiagnosis;
      sdkAztecVersion?: string;
    };
```

This additive arm is source-breaking for exhaustive TypeScript switches. Handle it separately from
`permission-blocked`: Local Network Access denial needs browser site-permission recovery, while a
secure-connection failure needs Presto tray → Settings → **Encrypted Connection** and, for
trust failures, certificate setup again.

When HTTPS cannot connect, the SDK may issue one bounded, witness-free HTTP `GET /health` to improve
the diagnosis. It never serializes or transmits a witness, never POSTs to HTTP, never pins HTTP, and
never makes the diagnostic endpoint eligible for proving. Accordingly, `httpsOnly` now means that
no private proving payload and no `/prove` request is sent over HTTP; it does not prohibit this
witness-free diagnostic.

`onPhase` may emit `"secure-connection-unavailable"` immediately before `"fallback"`. Normal proving
does not throw for this condition and continues through WASM.

If a browser dApp deliberately offers plaintext proving, require an informed confirmation and apply
both flags only to the current prover instance:

```ts
prover.setPrestoConfig({
  httpsOnly: false,
  allowInsecureDowngrade: true,
});
await prover.checkPrestoStatus({ forceRefresh: true });
```

Do not persist this consent in local storage, cookies, URL parameters, or desktop configuration. A
reload/new prover restores the HTTPS-only browser default. In particular, do not add a production
`?httpsOnly=false` switch.

## `PrestoStatus` adds `permission-blocked`

`checkPrestoStatus` can now distinguish an explicit browser loopback-network permission denial:

```ts
type PrestoStatus =
  | /* existing available/error/version arms */
  | { available: false; reason: "offline"; sdkAztecVersion?: string }
  | { available: false; reason: "permission-blocked"; sdkAztecVersion?: string };
```

This additive union arm is **source-breaking for exhaustive TypeScript switches**. Add the new case;
it intentionally has no `protocol`, because neither loopback endpoint answered:

```ts
const status = await prover.checkPrestoStatus();
if (!status.available) {
  switch (status.reason) {
    case "permission-blocked":
      showBrowserSitePermissionHelp();
      break;
    case "secure-connection-unavailable":
      showSecureConnectionRecovery(status.diagnosis);
      break;
    case "offline":
    case "error":
    case "version-mismatch":
      break;
  }
}

// After the user changes the permission, bypass the settled 10-second status cache.
await prover.checkPrestoStatus({ forceRefresh: true });
```

Only an explicit `denied` state is distinguishable. Under the browser HTTPS-only default, a
pending/dismissed prompt, unsupported Permissions API, or query error normally becomes
`secure-connection-unavailable` with `diagnosis: "unconfirmed"`; HTTP-permitted server runtimes can
still report `offline`. `forceRefresh` does not reset configuration,
protocol pins, HTTPS history, or an already-running same-generation probe.

## `PrestoStatus` is now a discriminated union (Q12)

`PrestoStatus` (returned by `PrestoProver.checkPrestoStatus()`) changed from a flat
interface — where every field was optional and illegal combinations typechecked — to a **discriminated
union on `available`**. The HTTP wire contract is unchanged; this is a TypeScript-only break.

### Before

```ts
interface PrestoStatus {
  available: boolean;
  needsDownload: boolean;
  nativeAztecVersion?: string;
  availableVersions?: string[];
  sdkAztecVersion?: string;
  protocol?: "http" | "https";
}
```

### After

```ts
type PrestoStatus =
  | {
      available: true;
      needsDownload: boolean;
      nativeAztecVersion?: string;
      availableVersions?: string[];
      sdkAztecVersion?: string;
      protocol: PrestoProtocol;            // "http" | "https"
    }
  | { available: false; reason: "offline"; sdkAztecVersion?: string }
  | { available: false; reason: "permission-blocked"; sdkAztecVersion?: string }
  | {
      available: false;
      reason: "secure-connection-unavailable";
      diagnosis: SecureConnectionDiagnosis;
      sdkAztecVersion?: string;
    }
  | { available: false; reason: "error"; protocol: PrestoProtocol; sdkAztecVersion?: string }
  | {
      available: false;
      reason: "version-mismatch";
      nativeAztecVersion: string;
      protocol: PrestoProtocol;
      sdkAztecVersion?: string;
    };
```

### What to change

**Narrow on `available` before reading state-specific fields.** Accessing `needsDownload`,
`availableVersions`, or `nativeAztecVersion` without narrowing is now a type error — which is the point:
those fields were never meaningful on an unavailable result.

```ts
// Before — fields read without narrowing
const status = await prover.checkPrestoStatus();
if (status.available && !status.needsDownload) {
  /* ... */
}

// After — narrow first; the compiler then exposes exactly the valid fields
const status = await prover.checkPrestoStatus();
if (status.available) {
  // status.needsDownload, status.availableVersions, status.protocol available here
  if (!status.needsDownload) {
    /* ... */
  }
} else {
  // status.reason: "offline" | "permission-blocked" | "secure-connection-unavailable" |
  //                "error" | "version-mismatch"
  switch (status.reason) {
    case "version-mismatch":
      console.warn(`presto is on ${status.nativeAztecVersion}, SDK wants ${status.sdkAztecVersion}`);
      break;
    case "permission-blocked":
      // Show browser site-permission guidance and an immediate forced Retry.
      break;
    case "secure-connection-unavailable":
      // Show HTTPS/certificate recovery and an immediate forced Retry.
      break;
    case "offline":
    case "error":
      // fall back to WASM
      break;
  }
}
```

Most callers that already wrote `if (status.available) { … }` need **no change** — the narrowing they
already do is exactly what the union requires. Only code that read `needsDownload`/version fields
*without* first checking `available` must add the narrowing.

The new `PrestoProtocol` type (`"http" | "https"`) is exported for convenience.

## New: typed `PrestoHttpError` + surfaced health fields (B7)

### Prove errors now degrade to WASM or throw a TYPED error — never a raw `ky` error

The presto is an optimisation, so `createChonkProof` **falls back to WASM** for every recognised
transient/denial/capacity/version condition. The degrade set is matched by status, not exhaustively by
code: **every** `403` (a denial, `version_not_allowed`, or `authorization_cooldown`) and **every** `408` /
`413` / `429` / `503` falls back regardless of its `code`, plus `500` with `download_failed`/`prove_failed`.
What used to leak a raw `ky` `HTTPError` to your dApp — a caller **misconfiguration**
(`400 invalid_version` / `invalid_origin`), a `500` with an **unrecognised** code, or any other unexpected
status — now throws a typed [`PrestoHttpError`] (exported from the barrel) with `.status` and `.code`,
so a real integration bug is surfaced instead of masked as "slow but working":

```ts
import { PrestoHttpError } from "@alejoamiras/presto";

try {
  await prover.createChonkProof(steps);
} catch (e) {
  if (e instanceof PrestoHttpError) {
    // misconfiguration — e.status (e.g. 400), e.code (e.g. "invalid_version")
  }
}
```

**Behaviour change (was: always degrade).** Previously EVERY `/prove` HTTP error — including the HTTP
downgrade-retry path — fell back to WASM. Now a `400` (`invalid_version`/`invalid_origin`), a `500` with an
unrecognised code, or any other unexpected status throws `PrestoHttpError` on BOTH the primary and the
retry path. (Every `403` and every `408`/`413`/`429`/`503` still degrades regardless of code — the throw
set is only misconfiguration + genuinely unexpected responses.) A dApp that relied on the old always-degrade
behaviour to swallow a misconfiguration (e.g. with `allowInsecureDowngrade`) will now see the error
surface — intentionally, so a real integration bug isn't hidden. Wrap `createChonkProof` if you prefer to
force-degrade regardless.

### New `"version-mismatch"` phase

`onPhase` may now emit `"version-mismatch"` (distinct from `"denied"`) when the presto refuses this
SDK's Aztec version (`403 version_not_allowed`). The proof still degrades to WASM.

### `PrestoStatus` gains `appVersion` / `apiVersion`

The `available: true` status now also carries the presto app's own `appVersion` (the desktop/headless
build) and the negotiated `apiVersion`. `apiVersion` is present whenever the presto is available (a
recognised `/health` must carry it). `appVersion` is optional — the origin-tiered MINIMAL `/health` served
to an unapproved cross-origin withholds it. Additive; no break.

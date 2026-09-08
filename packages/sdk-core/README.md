# @alejoamiras/presto-core

The transport and policy layer every Presto SDK adapter shares: how to find the local
[Presto](../presto/README.md) native prover on loopback, which protocol to trust, when a proof may go
native and when it must fall back, and the status a UI can show. It has no `@aztec/*` dependency, so
adapters for different proof systems can build on it without pulling in each other's toolchains.

You normally do not install this package directly:

- Aztec transactions: [`@alejoamiras/presto`](../sdk/README.md) (`PrestoProver`).
- Any Noir circuit: `@alejoamiras/presto-noir` (`PrestoUltraHonkBackend`).

Both depend on this package at an exact version.

## Installation

```bash
npm install @alejoamiras/presto-core
```

## `PrestoClient`

```ts
import { PrestoClient, PRESTO_SCHEME_ULTRA_HONK } from "@alejoamiras/presto-core";

const client = new PrestoClient({
  aztecVersion: "5.2.0", // sent as x-aztec-version; drives needsDownload / version-mismatch
  presto: { httpsOnly: true }, // PrestoConfig — same knobs as @alejoamiras/presto
  onPhase: (phase) => console.log(phase),
});

const status = await client.checkStatus(); // PrestoStatus, cached 10 s, single-flight
const outcome = await client.prove({
  path: "/prove/ultra-honk",
  contentType: "application/json",
  scheme: PRESTO_SCHEME_ULTRA_HONK, // degrade before sending if /health.schemes lacks it
  body: () => new TextEncoder().encode(JSON.stringify(job)), // built after the `serialize` phase
  responseCap: 8 * 1024 * 1024, // byte cap on the success body
});
if (outcome.kind === "native") {
  outcome.body; // the JSON body, parsed under responseCap
  outcome.durationMs; // x-prove-duration-ms, else the round trip
} else {
  outcome.reason; // FallbackReason — run the local prover
}
```

`prove` runs one request under the transport rules every adapter inherits: HTTPS-only by default in
browsers (pages and Workers), a working HTTPS endpoint is never downgraded to plaintext, and a
witness is never sent to an endpoint that was not itself probed. Every condition the presto signals
comes back as `{ kind: "fallback", reason }` — offline, denied, cooldown, version mismatch, an app
that predates the route (`404`), capacity (`408`/`413`/`429`/`503`), a body over the cap. Only a
caller misconfiguration (`400`, an unrecognised `500`, an unexpected status) throws
`PrestoHttpError`.

Phases: `detect` → (`downloading`) → `serialize` → `transmit` → `proving` → `proved` → `receive`.
A fallback outcome may have emitted `secure-connection-unavailable`, `denied`, or
`version-mismatch` first (reported as `outcome.phase`); the adapter emits `fallback` and its own
local-proving phases.

`configure(config)` moves the endpoint or changes policy and invalidates the cached status;
`setOnPhase(cb)` replaces the callback.

## Also exported

- `PRESTO_SCHEME_CHONK`, `PRESTO_SCHEME_ULTRA_HONK` — the proving schemes a Presto advertises in
  `/health.schemes`; an adapter passes the one its route needs as `scheme`.
- `PRESTO_API_VERSION` — the `/health.api_version` this client speaks (`1`).
- `toBase64` / `fromBase64` — standard padded base64 for the JSON routes (strict decoding).
- Types: `PrestoConfig`, `PrestoStatus`, `PrestoStatusCheckOptions`, `PrestoPhase`,
  `PrestoPhaseData`, `PrestoProtocol`, `SecureConnectionDiagnosis`, `PrestoVersionPair`,
  `PrestoClientOptions`, `ProveRequest`, `ProveOutcome`, `FallbackReason`, `PrestoScheme`.

`PrestoStatus` is documented in the [`@alejoamiras/presto` README](../sdk/README.md#prestostatus);
an available status also carries `schemes` and `versions` (`{ aztecVersion, bbVersion }[]`) when
the presto reports them.

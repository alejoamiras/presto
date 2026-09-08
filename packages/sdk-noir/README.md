# @alejoamiras/presto-noir

Native UltraHonk proving for **any Noir circuit** through the local [Presto](../presto/README.md)
app. `PrestoUltraHonkBackend` is a drop-in for `@aztec/bb.js`'s `UltraHonkBackend`: same
constructor shape, the same public methods, same `ProofData`. `generateProof` runs on the machine's
native `bb` when Presto is installed and approved, and on the WASM backend otherwise. (bb.js's class
has private fields, so code typed to the class itself should type against its methods — e.g.
`Pick<UltraHonkBackend, "generateProof" | "verifyProof">` — to accept either.)

[![SDK Noir](https://github.com/alejoamiras/presto/actions/workflows/sdk-noir.yml/badge.svg)](https://github.com/alejoamiras/presto/actions/workflows/sdk-noir.yml)
[![npm version](https://img.shields.io/npm/v/@alejoamiras/presto-noir)](https://www.npmjs.com/package/@alejoamiras/presto-noir)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](../../LICENSE)

```ts
import { Barretenberg } from "@aztec/bb.js";
import { PrestoUltraHonkBackend } from "@alejoamiras/presto-noir";
import circuit from "./target/circuit.json";

const backend = new PrestoUltraHonkBackend(circuit.bytecode, () => Barretenberg.new());
const { proof, publicInputs } = await backend.generateProof(witness, {
  verifierTarget: "noir-recursive-no-zk",
});
const ok = await backend.verifyProof({ proof, publicInputs }, { verifierTarget: "noir-recursive-no-zk" });
```

## Installation

```bash
npm install @alejoamiras/presto-noir @aztec/bb.js@5.2.0
```

`@aztec/bb.js` is a peer dependency pinned **exactly** to the release this adapter is tested against
(`TESTED_BB_VERSION`, see [Compatibility](#compatibility)); a project already on that bb.js keeps
its single copy. The transport comes from [`@alejoamiras/presto-core`](../sdk-core/README.md), an
exact-pinned dependency. Native proving needs Presto **1.1.0** or newer; an older app does not
advertise `ultra_honk` in `/health.schemes`, so nothing is sent and the backend proves in WASM
(`scheme-unsupported`).

Browser bundling is whatever bb.js already needs (cross-origin isolation for its worker threads, its
worker files served); the adapter adds no asset of its own. The
[playground](../playground/vite.config.ts) shows the Vite setup and dedupes `@aztec/bb.js` so the
adapter and the page share one WASM runtime.

## Constructor

`new PrestoUltraHonkBackend(acirBytecode, api, options?)`

- `acirBytecode` — the compiled artifact's `bytecode` string, exactly what `UltraHonkBackend` takes.
- `api` — a `Barretenberg` instance, or a factory `() => Promise<Barretenberg>`. A factory is called
  only when WASM is needed (a fallback, `verifyProof`, a cold `getVerificationKey`), so a dApp with a
  running Presto never pays WASM + CRS initialisation; an instance is yours and is never destroyed.
- `options.bbVersion` — the bb release Presto proves with; defaults to `TESTED_BB_VERSION` (`5.2.0`).
  Another value is refused unless `allowUntestedBbVersion: true`.
- `options.presto` — connection config (`port`, `host`, `httpsOnly`, `allowInsecureDowngrade`), as in
  `@alejoamiras/presto`.
- `options.verificationKey` — `{ bytes, verifierTarget }` for this circuit; sent with native proofs of
  that target and returned by `getVerificationKey` for it.
- `options.fallback` — `"wasm"` (default) or `"none"`: with `"none"`, `generateProof` throws
  `PrestoUnavailableError` (with the client's `reason`) instead of proving in WASM. Only
  `generateProof` is affected; `verifyProof` and a cold `getVerificationKey` always run locally.
- `options.onPhase` — phases: `detect` → (`downloading`) → `serialize` → `transmit` → `proving` →
  `proved` → `receive`; a fallback emits `fallback` then the local `proving`/`proved`/`receive`;
  `secure-connection-unavailable`, `denied`, or `version-mismatch` may precede a fallback.

Also: `checkPrestoStatus(options?)`, `setForceLocal(bool)`, `setOnPhase(cb)`, `destroy()`.

## What runs where

| Method | Presto available | Otherwise |
|---|---|---|
| `generateProof` | native `bb` via `POST /prove/ultra-honk` | WASM (or `PrestoUnavailableError` with `fallback: "none"`) |
| `verifyProof` | WASM, circuit-bound like bb.js (never a Presto-computed key) | WASM |
| `getVerificationKey` | the seeded key for its target, else WASM | same |
| `getSolidityVerifier`, `generateRecursiveProofArtifacts` | WASM | WASM |

A `verifierTarget` (or the deprecated `keccak` / `keccakZK` / `starknet` / `starknetZK` flags)
resolves exactly as in bb.js, for every method. Only the `*-no-zk` targets produce byte-identical
proofs natively and in WASM; ZK targets add prover randomness and verify either way. bb 5.2.0
refuses the `starknet` targets at prove time.

Proofs from a miner-style loop should be submitted one at a time per worker: Presto admits at most
four UltraHonk jobs per origin and answers `429` beyond that, which `fallback: "none"` surfaces as
`PrestoUnavailableError` (`reason: "transient"`).

## Fallback semantics

`generateProof` proves natively only after the presto answered `/health` on the trusted protocol
**and** listed `ultra_honk` in `schemes`. Everything the presto or the network signals degrades —
to WASM by default, to `PrestoUnavailableError` with `fallback: "none"`. Only a caller
misconfiguration throws `PrestoHttpError` in both modes.

| `reason` | What happened | Presto answer |
|---|---|---|
| `unavailable` | offline, blocked by the browser's local-network permission, misbehaving, or too old to speak the protocol | no usable `/health` |
| `secure-connection-unavailable` | browser policy forbids plaintext and HTTPS could not connect | — |
| `scheme-unsupported` | the app does not serve `ultra_honk` — every Presto before 1.1.0, or one built without the route | `/health.schemes` without it (or no `schemes` at all) |
| `route-missing` | the app advertised the scheme but has no route | `404` |
| `denied` / `cooldown` | the user denied this origin / a recent denial is cooling down | `403` |
| `version-mismatch` | the presto refuses the requested `bbVersion` | `403 version_not_allowed` |
| `transient` | capacity or a transient failure: the global queue, the per-origin cap of four jobs, timeouts, `prove_failed` | `408` / `413` / `429` / `503`, known `500`s |
| `network` | the request got no HTTP response (refused, TLS failure, timeout) | — |
| `endpoint-changed` | the core client's endpoint was reconfigured mid-proof (core reserves it; this backend has no such call) | — |
| `malformed-response` | a `200` whose body was over the cap, not JSON, or not a proof (empty, misaligned, oversized key) | — |

The phase trail tells the two paths apart: a native proof emits `detect` → `serialize` →
`transmit` → `proving` → `proved` → `receive`; a fallback emits `fallback` (after
`secure-connection-unavailable`, `denied`, or `version-mismatch` when one applies) and then the local
`proving` → `proved` → `receive`. A native `*-no-zk` proof is byte-identical to the WASM one, so a
UI can verify a native result against a known reference as the playground does.

`PrestoHttpError` (`.status`, `.code`) means the request itself was wrong — `400 invalid_request`
or `invalid_verifier_target`, a `500` with an unknown code, an unexpected status — and is thrown
from either mode rather than masked as a slow WASM proof.

## Compatibility

| Runtime | Native path | Notes |
|---|---|---|
| Chrome, Firefox | HTTPS to the presto's loopback listener | Local Network Access permission prompt applies (see the [`@alejoamiras/presto` README](../sdk/README.md#browser-local-network-access-chrome-142-firefox-153)) |
| Safari | HTTPS only | needs Presto's **Encrypted Connection** |
| Node, Bun, SSR | HTTP or HTTPS (`httpsOnly` defaults to `false`) | bb.js itself already prefers a native `bb` on macOS/Linux when one is installed; Presto's value there is the shared version cache and Windows, where bb.js ships no native binary |

Tested pairs — the wire contract, the CLI flags, and the byte identity of native and WASM proofs are
verified per pair in CI (`sdk-noir.yml`: bb.js WASM must reproduce the committed fixtures, and the
adapter must prove natively against a headless presto built with the real `bb`):

| `@alejoamiras/presto-noir` | `@aztec/bb.js` (peer, exact) | `bbVersion` (default) | Presto |
|---|---|---|---|
| 1.0.0 | 5.2.0 | 5.2.0 | ≥ 1.1.0 |

`TESTED_BB_VERSIONS` is exported; a `bbVersion` outside it is refused unless
`allowUntestedBbVersion: true`, because native and WASM proofs would otherwise come from different
bb releases.

## Also exported

`PrestoUnavailableError`, `PrestoHttpError`, `resolveVerifierTarget` / `VERIFIER_TARGETS` (the
option → target resolution bb.js applies), `TESTED_BB_VERSION` / `TESTED_BB_VERSIONS`, and the
types `BarretenbergSource`, `PrestoUltraHonkBackendOptions`, `PrestoConfig`, `PrestoStatus`,
`PrestoPhase`, `PrestoPhaseData`, `FallbackReason`, plus bb.js's `ProofData`,
`UltraHonkBackendOptions`, `VerifierTarget`.

## Development

```bash
bun run --cwd packages/sdk-noir build           # Build
bun run --cwd packages/sdk-noir test:unit       # Unit tests (bb.js mocked)
bun run --cwd packages/sdk-noir test:lint       # Typecheck (src and e2e)
bun run --cwd packages/sdk-noir test:identity   # bb.js WASM reproduces fixtures/noir/* byte for byte
PRESTO_URL=http://127.0.0.1:59833 bun run --cwd packages/sdk-noir test:e2e  # live presto, fallback: "none"
```

`test:e2e` requires a presto: an unset `PRESTO_URL` fails the suite unless `PRESTO_NOIR_SKIP_LIVE=1`
opts out explicitly. `PRESTO_NOIR_W_FIXTURE_DIR=<dir>` adds a cross-check against any directory with
the fixture layout (`circuit.json`, `manifest.json`, `witness.gz`, `vk`, `proof`, `public_inputs`).
Fixtures are regenerated with `bun scripts/noir-fixture.ts --regenerate` from the repository root
(without the flag the script only verifies them).

## License

[AGPL-3.0](../../LICENSE)

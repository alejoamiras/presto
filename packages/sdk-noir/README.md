# @alejoamiras/presto-noir

Native UltraHonk proving for **any Noir circuit** through the local [Presto](../presto/README.md)
app. `PrestoUltraHonkBackend` is a drop-in for `@aztec/bb.js`'s `UltraHonkBackend`: same
constructor shape, the same public methods, same `ProofData`. `generateProof` runs on the machine's
native `bb` when Presto is installed and approved, and on the WASM backend otherwise. (bb.js's class
has private fields, so code typed to the class itself should type against its methods — e.g.
`Pick<UltraHonkBackend, "generateProof" | "verifyProof">` — to accept either.)

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

`@aztec/bb.js` is a peer dependency pinned to the release this adapter is tested against
(`TESTED_BB_VERSION`).

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

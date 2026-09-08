# Phase 14 — `presto-noir` adapter and workflow scaffold

Date: 2026-09-08. Branch `presto-noir/sdk-noir` (arc 4, stacked on `presto-noir/sdk-core`).

## What landed

- `packages/sdk-noir`: `@alejoamiras/presto-noir` 1.0.0, deps `@alejoamiras/presto-core`
  (`workspace:*`) + `@logtape/logtape`; `@aztec/bb.js` is an exact **peer** (`5.2.0`) and a dev
  dependency at the same version; no `@aztec/*` runtime dependency.
- `PrestoUltraHonkBackend(acirBytecode, api | () => Promise<api>, options)` implementing the five
  public methods of bb.js's `UltraHonkBackend` (compile-checked through `implements Pick<…>`, and a
  runtime test walks bb.js's prototype). `generateProof` → `PrestoClient.prove({ path:
  "/prove/ultra-honk", contentType: "application/json", scheme: "ultra_honk", body })` → decoded
  `{proof, public_inputs, vk?}` → `ProofData` with bb.js's `0x` + 64-hex public inputs; a fallback
  outcome (or an undecodable 200) runs the real WASM `UltraHonkBackend`, or throws
  `PrestoUnavailableError(reason, phase)` under `fallback: "none"` — `generateProof` only.
  `verifyProof`, `getSolidityVerifier`, `generateRecursiveProofArtifacts` delegate to WASM;
  `getVerificationKey` returns the seeded key for its target, else WASM. bb.js is `import()`ed on
  first WASM use; a factory `api` is called then and destroyed by `destroy()`, an instance never.
- VK handling: a seeded `{bytes, verifierTarget}` is sent as `vk` for that target only; a
  presto-computed key is cached per target and only ever sent back as `vk` — never returned by
  `getVerificationKey`, never used by `verifyProof`.
- `resolveVerifierTarget` mirrors bb.js's `getProofSettingsFromOptions` as a target (explicit
  target, the conflict error text verbatim, deprecated-flag precedence keccak > starknet, ZK kept
  for the ZK spellings, default `noir-recursive`) and is used by every method.
- `resolveBbVersion`: default `TESTED_BB_VERSION` (`5.2.0`), other values refused unless
  `allowUntestedBbVersion`; the value is the client's `aztecVersion` (`x-aztec-version`).
- Tests (35): the wire job against the `square` fixture, the phase trail, no WASM on the native
  path and no factory call; server-key and seeded-key rows; six fallback rows (offline, no
  `ultra_honk` scheme → `version-mismatch`, 404, 403, 429, malformed body) each proving WASM ran
  with the caller's options AND that `fallback: "none"` throws with the reason and no WASM;
  typed `PrestoHttpError` passthrough; `setForceLocal`; the WASM delegates offline; `destroy`
  ownership; bbVersion rows; status; `resolveVerifierTarget` table; `ProofData` conversion for
  both fixtures against bb.js's `deflattenFields`; public contract (barrel, README, manifest peer).
- Descriptor entry `presto-noir` + consumer profile (`host-dependencies.json` installs the bb.js
  peer); `sdk-noir.yml` thin caller; `sdk.yml` dispatch choice; root workspaces and test chains;
  `release-plan.test.ts` uses the real entry (no injection left).

## Notes

- The consumer host manifest is now `type: module`. A CommonJS host resolved the bb.js peer's
  `require` types while the packed ESM dist resolved its `import` types — two declarations of
  `Barretenberg`, so `() => Promise<Barretenberg>` was "not assignable" to `BarretenbergSource`.
  ESM is what a consumer of these ESM-only packages is anyway; all three profiles pass.
- Spying on `bbJs.UltraHonkBackend.prototype` works across the adapter's dynamic `import()`: same
  module instance. The fixture's real bytecode is used so bb.js's constructor (base64 + gunzip)
  runs unmocked.

## Gate

`bun run --cwd packages/sdk-noir test:unit` 35 ✓ · `test:lint` ✓ · `build` ✓ · `bun run test` exit 0
· `bun run lint:actions` ✓ · consumer profiles locally: `presto-noir` (bootstrap, packed core, peer
bb.js), `presto`, `presto-core` all OK. `sdk.yml package=presto-noir`: dispatched after the commit
(run id in `arc-4-review.md`).

All source has been read. Here is the full package map.

# `packages/sdk-noir` (`@alejoamiras/presto-noir`)

Native UltraHonk proving for any Noir circuit through the local Presto app; a drop-in for `@aztec/bb.js`'s `UltraHonkBackend` that falls back to WASM. TypeScript, Bun, `type: "module"`, exports raw `./src/index.ts` (no built `dist` on the resolve path — `dist` exists only for publishing per `package.json:13-16`).

## 1. Module inventory

| File | LOC | Purpose |
|---|---|---|
| `packages/sdk-noir/src/index.ts` | 18 | Public barrel: re-exports types from `@alejoamiras/presto-core`, `@aztec/bb.js`, and this package's own runtime/types. |
| `packages/sdk-noir/src/lib/presto-ultra-honk-backend.ts` | 282 | The adapter itself — `PrestoUltraHonkBackend` class, its options, and the lazy bb.js peer loader (`loadUltraHonkBackend`). |
| `packages/sdk-noir/src/lib/proof-data.ts` | 59 | Decodes the `/prove/ultra-honk` JSON body (`decodeUltraHonkResponse`) and converts it to bb.js's `ProofData` (`fieldsToHex`, `toProofData`). |
| `packages/sdk-noir/src/lib/verifier-target.ts` | 39 | `VERIFIER_TARGETS` list (bb's 8 `-t` values) and `resolveVerifierTarget`, reimplementing bb.js's `getProofSettingsFromOptions` precedence. |
| `packages/sdk-noir/src/lib/tested-versions.ts` | 26 | `TESTED_BB_VERSIONS`/`TESTED_BB_VERSION` and `resolveBbVersion` (semver-shape + tested-pairing enforcement). |
| `packages/sdk-noir/src/lib/errors.ts` | 19 | `PrestoUnavailableError` (thrown by `generateProof` under `fallback: "none"`). |
| `packages/sdk-noir/src/lib/logger.ts` | 3 | `logger = getLogger(["presto", "noir"])` from `@logtape/logtape`. |
| `packages/sdk-noir/src/lib/presto-ultra-honk-backend.test.ts` | 340 | Unit tests for the adapter (see §6). |
| `packages/sdk-noir/src/lib/proof-data.test.ts` | 73 | Unit tests for response decoding/conversion. |
| `packages/sdk-noir/src/lib/verifier-target.test.ts` | 38 | Unit tests for target resolution / bb.js flag precedence. |
| `packages/sdk-noir/src/lib/peer.test.ts` | 26 | Unit test: missing/unexpected `@aztec/bb.js` peer produces one actionable error. |
| `packages/sdk-noir/src/lib/public-contract.test.ts` | 49 | Doc-sync guard: barrel exports, README content, `package.json` manifest all agree. |
| `packages/sdk-noir/e2e/e2e-setup.ts` | 48 | Preload: configures `@logtape/logtape` console sink, `loadFixture`/`fixtureDir` helpers, `FIXTURE_NAMES`. |
| `packages/sdk-noir/e2e/native.test.ts` | 140 | Live-presto e2e (native proving, key caching, fallback absence, misc.). |
| `packages/sdk-noir/e2e/wasm-identity.test.ts` | 55 | bb.js WASM reproduces committed fixtures byte-for-byte; adapter's forced-local path matches. |

Plus `package.json` (38), `README.md` (161), `tsconfig.json`, `tsconfig.e2e.json` — no framework config.

## 2. Entrypoints / public exports

`packages/sdk-noir/src/index.ts:1-18` exports:

- **Types re-exported from `@alejoamiras/presto-core`**: `FallbackReason`, `PrestoConfig`, `PrestoPhase`, `PrestoPhaseData`, `PrestoStatus`, `PrestoStatusCheckOptions`.
- **Runtime re-exported from `@alejoamiras/presto-core`**: `PrestoHttpError`.
- **Types re-exported from `@aztec/bb.js`**: `ProofData`, `UltraHonkBackendOptions`, `VerifierTarget`.
- **Own runtime/types**: `PrestoUnavailableError` (`./lib/errors.js`); `BarretenbergSource`, `PrestoUltraHonkBackendOptions` (types); `PrestoUltraHonkBackend` (class); `TESTED_BB_VERSION`, `TESTED_BB_VERSIONS`; `resolveVerifierTarget`, `VERIFIER_TARGETS`.

### `PrestoUltraHonkBackend` full public surface (`presto-ultra-honk-backend.ts:86-261`)

**Constructor** — `new PrestoUltraHonkBackend(acirBytecode: string, api: BarretenbergSource, options?: PrestoUltraHonkBackendOptions)` (`:101-117`):
- `acirBytecode` — the compiled artifact's `bytecode` string.
- `api: BarretenbergSource` — a `Barretenberg` instance, or a factory `() => Promise<Barretenberg>` (`:32`), called only when WASM is actually needed.
- `options`:
  - `bbVersion?: string` — resolved via `resolveBbVersion`; defaults to `TESTED_BB_VERSION`; a non-tested value throws unless `allowUntestedBbVersion: true`.
  - `allowUntestedBbVersion?: boolean`.
  - `presto?: PrestoConfig` — passed straight to `PrestoClient`.
  - `verificationKey?: { bytes: Uint8Array; verifierTarget: VerifierTarget }` — the caller-seeded key (`#seed`).
  - `fallback?: "wasm" | "none"` — default `"wasm"`.
  - `onPhase?: OnPhase` — `(phase: PrestoPhase, data?: PrestoPhaseData) => void`.

**Methods**:
- `generateProof(compressedWitness, options?) => Promise<ProofData>` (`:119-144`) — resolves the target, and unless `setForceLocal(true)` was called, calls `PrestoClient.prove({ path: "/prove/ultra-honk", contentType: "application/json", scheme: PRESTO_SCHEME_ULTRA_HONK, body: () => #encodeJob(...) })`. On a `"fallback"` outcome, degrades per `#fallback`/throws. On a `"native"` outcome, decodes via `decodeUltraHonkResponse`; a decode failure logs a warning and is treated as `"malformed-response"` fallback. If the response carried a `vk`, caches it in `#serverKeys` keyed by target. Returns `toProofData(decoded)`.
- `verifyProof(proofData, options?) => Promise<boolean>` (`:147-149`) — always delegates to the WASM backend (`#wasmBackend()`); circuit-bound like bb.js.
- `getVerificationKey(options?) => Promise<Uint8Array>` (`:152-156`) — returns the seeded key if its `verifierTarget` matches; otherwise delegates to WASM. **A presto-computed key is never returned.**
- `getSolidityVerifier(vk, options?) => Promise<string>` (`:158-160`) — WASM only.
- `generateRecursiveProofArtifacts(proof, numOfPublicInputs, options?) => Promise<{proofAsFields, vkAsFields, vkHash}>` (`:162-169`) — WASM only.
- `checkPrestoStatus(options?: PrestoStatusCheckOptions) => Promise<PrestoStatus>` (`:172-174`) — probes the local presto's `/health` via `PrestoClient.checkStatus`.
- `setForceLocal(force: boolean): void` (`:177-179`) — forces WASM proving, bypassing presto detection entirely.
- `setOnPhase(callback: OnPhase | null): void` (`:182-184`) — replace the phase callback.
- `destroy(): Promise<void>` (`:187-199`) — releases the WASM backend/API this instance created from a factory (never a caller-provided instance); waits for an in-flight peer import + factory call before releasing, so nothing is leaked or double-destroyed.

## 3. Trust boundaries

**Untrusted data entering — the presto's `/prove/ultra-honk` response** (`proof-data.ts:21-42`, invoked from `presto-ultra-honk-backend.ts:135-141`):
- Shape checked structurally, not just typed: `record.proof` and `record.public_inputs` must be strings, `record.vk` if present must be a string — else `"lacks string ..."` / `"non-string vk"`.
- `proof` (via `fromBase64`) must be non-empty and a whole multiple of 32 bytes (`FIELD_BYTES = 32`) — else `"proof is N bytes, not whole 32-byte fields"`.
- `public_inputs` must be a whole multiple of 32 bytes (may be empty) — else similar error.
- `vk`, if present, must be 1..`MAX_VK_BYTES` (65536, i.e. `64 * 1024`) bytes — else `"vk is N bytes; expected 1 to 65536"`.
- Any decode failure inside `generateProof` is caught, logged (`logger.warn`), and treated as a `"malformed-response"` fallback rather than surfaced as a proof — explicitly documented as *not verification*: "a well-formed bad proof is the WASM verifier's to reject" (`proof-data.ts:15-20`).
- `fromBase64` itself (`sdk-core/src/lib/base64.ts:25-36`) fails closed on non-alphabet characters or bad padding length rather than silently truncating.

**Untrusted data one layer up — `PrestoClient.prove`/`#readOutcome`** (`sdk-core/src/lib/presto-client.ts`): the body is read once under a byte cap (`responseCap`, default 8 MiB) via `#transport.readJsonBody`; an unreadable/over-cap/non-JSON body becomes `fallback("malformed-response")` before this package ever sees it (`:365-375`). `/health` bodies are similarly narrowed field-by-field in `#classifyHealth` (`:236-245` — e.g. `data.version` only trusted if `typeof === "string"`).

**Caller-supplied trust inputs**:
- `options.verificationKey` (`#seed`) — trusted as-is (no shape validation beyond the `{bytes, verifierTarget}` type); it's the caller's own circuit's key. Sent on native proofs of the matching target and returned verbatim from `getVerificationKey` for that target; comment: "a key for another circuit only spoils this backend's own proofs" (`:46-50`).
- `bbVersion` / `allowUntestedBbVersion` — `resolveBbVersion` (`tested-versions.ts:14-26`) enforces a semver-shape regex, then refuses anything outside `TESTED_BB_VERSIONS` (`["5.2.0"]`) unless `allowUntestedBbVersion: true`, because native (presto/bb) and WASM (bb.js) proofs must come from the same bb release.
- `@aztec/bb.js` peer — loaded via **dynamic `import()`** only at first WASM use (`loadUltraHonkBackend`, `:267-282`), never eagerly, so a native-only path never pulls WASM in. Both an import failure and an import that lacks `UltraHonkBackend` as a function produce the same actionable `missing()` error: `` `@alejoamiras/presto-noir needs its peer dependency @aztec/bb.js@${TESTED_BB_VERSION} for WASM proving and verification: install it beside this package.` `` — checked *before* the caller's factory runs, so a factory that itself imports bb.js can't pre-empt this message.

**What leaves the process — the request body** (`#encodeJob`, `presto-ultra-honk-backend.ts:201-211`):
```
{
  bytecode: this.#bytecode,          // the constructor's acirBytecode, as-is
  witness: toBase64(witness),        // the caller's compressedWitness
  verifier_target: target,           // resolveVerifierTarget(options)
  vk: toBase64(key)                  // present only if seeded key or a previously cached server key matches this target
}
```
Serialized as UTF-8 JSON bytes. Sent through `PrestoClient.prove` (`@alejoamiras/presto-core`) at `generateProof` (`:126-131`): `path: "/prove/ultra-honk"`, `contentType: "application/json"`, `scheme: PRESTO_SCHEME_ULTRA_HONK`. The core client owns the actual transport policy (loopback endpoint validation, HTTPS-by-default, `x-aztec-version` header set to `#bbVersion`, no witness sent to an unprobed/reconfigured endpoint — see `presto-client.ts:#proveRemote`/`#recoverFromNetworkFailure`/`#retryOverHttp`).

**Presto-computed key caching**: `#serverKeys: Map<VerifierTarget, Uint8Array>` (`:93`), populated only from `decoded.vk` on a successful native response (`:142`), keyed by `resolveVerifierTarget(options)`. Reused only inside `#encodeJob` to attach `vk` on a later proof of the *same* target (`:207-209`) — "saves the presto a key computation." It is never surfaced to the caller: `getVerificationKey` explicitly ignores `#serverKeys` and falls to the seed or WASM (`:152-156`, and comment `:92` "only ever sent back as `vk` on this backend's own proofs").

## 4. Dependency graph

**Internal imports** (within `src/`):
- `index.ts` → `./lib/errors.js`, `./lib/presto-ultra-honk-backend.js`, `./lib/tested-versions.js`, `./lib/verifier-target.js`.
- `presto-ultra-honk-backend.ts` → `./errors.js`, `./logger.js`, `./proof-data.js`, `./tested-versions.js`, `./verifier-target.js`.
- `proof-data.ts`, `verifier-target.ts`, `tested-versions.ts`, `errors.ts`, `logger.ts` → no internal imports (leaves).

**External deps** (`package.json:25-34`):
- `@alejoamiras/presto-core` (`workspace:*`, `dependencies`) — supplies `PrestoClient`, `PRESTO_SCHEME_ULTRA_HONK`, `toBase64`/`fromBase64`, `PrestoHttpError`, and the `Fallback*`/`Presto*` types. Used in `presto-ultra-honk-backend.ts` and `proof-data.ts`.
- `@logtape/logtape` (`^2.3.2`, `dependencies`) — `getLogger` in `logger.ts`.
- `@aztec/bb.js` (`5.2.0` pinned exactly, both `devDependencies` and `peerDependencies`) — the WASM prover/verifier, dynamically imported in `presto-ultra-honk-backend.ts`; types (`Barretenberg`, `ProofData`, `UltraHonkBackend`, `UltraHonkBackendOptions`, `VerifierTarget`) imported statically (type-only) throughout.

No other runtime dependencies; `publishConfig.access: "public"`, `files: ["src", "dist"]`.

## 5. Frameworks in use

None — plain TypeScript/Bun library, no web/UI framework. bb.js APIs consumed:
- `UltraHonkBackend` — dynamically imported class, instantiated as `new Backend(this.#bytecode, api)` for the WASM path (`:255-257`); its public methods (`generateProof`, `verifyProof`, `getVerificationKey`, `getSolidityVerifier`, `generateRecursiveProofArtifacts`) are the `UltraHonkSurface` this class implements (`:65-72`).
- `Barretenberg` — type only (`BarretenbergSource`); an instance or factory is caller-supplied, never constructed here directly. `destroy()` on an instance is called only if it was created from a caller factory (`#ownsApi`).
- `deflattenFields` — **not called by src** (only by tests/e2e to build expectations); `proof-data.ts` reimplements the same 32-byte-field → `0x`+64-hex-digit conversion itself as `fieldsToHex` (comment at `:44` explicitly notes it mirrors bb.js's `deflattenFields`).
- `getProofSettingsFromOptions` — **not called**; `verifier-target.ts`'s `resolveVerifierTarget` reimplements its precedence logic (explicit target vs. deprecated `keccak`/`keccakZK`/`starknet`/`starknetZK` flags) as a standalone function, verified against bb.js's real behavior only in tests.

## 6. Test surfaces

**Unit tests** (`bun test --parallel src/`, bb.js's real `UltraHonkBackend` methods spied/mocked, `fetch` mocked):
- `presto-ultra-honk-backend.test.ts` — the decision table: native proving (wire job shape, `ProofData`, phase trail `["detect","serialize","transmit","proving","proved","receive"]`, no WASM call); presto-computed key sent only for later proofs of the same target and never returned by `getVerificationKey`; a seeded key sent for its target only and returned by `getVerificationKey` for it; every `FallbackReason` case (`unavailable`, `scheme-unsupported`, `route-missing`, `denied`, `transient`, `malformed-response`) falls back to WASM by default or throws `PrestoUnavailableError` with the right `reason`/`phase` under `fallback: "none"`; a `400`/misconfiguration surfaces `PrestoHttpError` untouched; `setForceLocal` skips the network; `verifyProof`/`getSolidityVerifier`/`generateRecursiveProofArtifacts` always go to WASM offline; `destroy()` only releases a factory-owned API, including mid-initialisation; `bbVersion` default/refusal/opt-in; `checkPrestoStatus`; and a runtime surface-completeness check against `bbJs.UltraHonkBackend.prototype`.
- `proof-data.test.ts` — fixture-based round trip (`square`, `nopub`) matching bb.js's own conversion; `fieldsToHex` byte layout; every malformed-shape rejection path (missing/non-string fields, misaligned lengths, empty proof, empty/oversized vk, bad base64).
- `verifier-target.test.ts` — every `VERIFIER_TARGETS` entry (8 total) round-trips; the deprecated-flag precedence table (`keccak`/`keccakZK`/`starknet`/`starknetZK` combinations); target+deprecated-flag conflict error; unknown target error.
- `peer.test.ts` — `mock.module("@aztec/bb.js", () => ({}))` simulates a missing/broken peer; asserts one clear error at first WASM use (`generateProof` and `verifyProof`), and that the peer check runs *before* the caller's factory.
- `public-contract.test.ts` — doc-sync guard: barrel runtime+type exports present; README contains key terms (`@alejoamiras/presto-noir`, `PrestoUltraHonkBackend`, `fallback: "none"`, `PrestoUnavailableError`, `TESTED_BB_VERSION`, `@aztec/bb.js@5.2.0`, `verifyProof`); `package.json` pins peer/dev `@aztec/bb.js` to `TESTED_BB_VERSION`, depends on `@alejoamiras/presto-core` as `workspace:*`, has no other `@aztec/*` dependency, correct `publishConfig`/`files`.

**`e2e/wasm-identity.test.ts`** (`bun run test:identity`) — no live presto needed, only the real `@aztec/bb.js` WASM backend. Confirms bb.js WASM reproduces the committed `fixtures/noir/{square,nopub}` reference bytes (key, proof, public inputs) exactly, and that the adapter's `setForceLocal(true)` path produces that same WASM proof and verifies. No env vars required.

**`e2e/native.test.ts`** (`bun run test:e2e`) — against a **live** presto, `fallback: "none"` throughout so a silent WASM fallback fails the suite rather than passing it. Env vars:
- `PRESTO_URL` — required; an unset value throws immediately at module load unless `PRESTO_NOIR_SKIP_LIVE=1`. Parsed into `{host, port, httpsOnly: false}` for `PrestoConfig`.
- `PRESTO_NOIR_SKIP_LIVE` — set to `"1"` to skip the live suite (e.g. local dev without a running presto).
- `PRESTO_NOIR_W_FIXTURE_DIR` — optional; a directory with the same fixture layout (`circuit.json`, `manifest.json`, `witness.gz`, `vk`, `proof`, `public_inputs`) for an additional cross-check ("yacana W cross-check"); the suite is skipped if unset or the path doesn't exist.
Covers: presto advertises `ultra_honk`; native proof for each fixture matches the reference bytes and verifies in WASM (including a byte-tamper-must-not-verify check); the second proof of the same target reuses the cached key and still matches; the raw `/prove/ultra-honk` endpoint returns `vk` only when none was supplied; the default ZK target proves natively and WASM-verifies (no byte comparison, since ZK proofs are randomized).

## 7. Generated / vendored / fixture code

`fixtures/noir/{square,nopub}/` (repo root, referenced via `../../../../fixtures/noir/...` from `src/lib/*.test.ts` and via `fixtureDir`/`loadFixture` in `e2e/e2e-setup.ts:47-48` from `e2e/*.test.ts`). Each fixture directory contains `circuit.json` (compiled Noir artifact, `.bytecode` used), `manifest.json` (`.verifierTarget`), `Nargo.toml`/`Prover.toml`/`src`/`target` (Noir project sources, not read by sdk-noir code — only `circuit.json` and `manifest.json` are), `witness.gz`, `vk`, `proof`, `public_inputs` (raw reference binary bytes). Per README: regenerated with `bun scripts/noir-fixture.ts --regenerate` from the repo root; without the flag, that script only verifies them. No generated/vendored code lives inside `packages/sdk-noir` itself; `dist/` (present on disk) is a build artifact excluded from source control's active resolve path (`exports: "./src/index.ts"`).

## Fallback semantics — exact quotes

From `presto-ultra-honk-backend.ts:52-56`:
> What `generateProof` does when the presto cannot prove: `"wasm"` (default) proves locally like bb.js; `"none"` throws {@link PrestoUnavailableError} so a caller can apply backpressure.
> `verifyProof` and a cold `getVerificationKey` always run locally.

From `README.md:58-60`:
> `options.fallback` — `"wasm"` (default) or `"none"`: with `"none"`, `generateProof` throws `PrestoUnavailableError` (with the client's `reason`) instead of proving in WASM. Only `generateProof` is affected; `verifyProof` and a cold `getVerificationKey` always run locally.

## `PrestoUnavailableError` — exact quote

`packages/sdk-noir/src/lib/errors.ts:9-19`:
```ts
export class PrestoUnavailableError extends Error {
  readonly reason: FallbackReason;
  readonly phase?: PrestoPhase;

  constructor(reason: FallbackReason, phase?: PrestoPhase) {
    super(`Presto could not prove natively (${reason}) and WASM fallback is disabled`);
    this.name = "PrestoUnavailableError";
    this.reason = reason;
    this.phase = phase;
  }
}
```
Doc comment above it:
> Thrown by `generateProof` when the backend was constructed with `fallback: "none"` and the presto could not prove natively: the caller asked for backpressure instead of a silent WASM proof. `reason` is the client's fallback reason (`unavailable`, `denied`, `route-missing`, …) or `malformed-response` for a native answer that could not be decoded.

## `onPhase` phases — every value emitted, and where

`PrestoPhase` union (`packages/sdk-core/src/lib/types.ts:10-24`): `"detect" | "secure-connection-unavailable" | "serialize" | "transmit" | "proving" | "proved" | "receive" | "fallback" | "downloading" | "denied" | "version-mismatch"`.

Emission sites, by layer:

- **`@alejoamiras/presto-core`'s `PrestoClient.prove`** (`sdk-core/src/lib/presto-client.ts`), invoked from `PrestoUltraHonkBackend`'s constructor as the client's own `onPhase` forwarder (`presto-ultra-honk-backend.ts:115`):
  - `"detect"` — start of `prove`, before probing (`:291`).
  - `"secure-connection-unavailable"` — HTTPS unreachable and policy forbids HTTP, either at detect time (`:301`) or after a network failure during proving (`:462`).
  - `"downloading"` — presto needs to fetch `bb` for this Aztec version, right before proving (`:315`).
  - `"version-mismatch"` — presto lacks the requested scheme (`:308`) or refused this client's `bbVersion` (`403 version_not_allowed`, `:433`).
  - `"serialize"` — right before calling `request.body()` (`:349`).
  - `"transmit"` — right after building the payload, before POST (`:351`).
  - `"proving"` — immediately after `"transmit"`, i.e. request in flight (`:352`).
  - `"denied"` — presto returned `403` (an origin denial, not a cooldown) (`:439`).
  - `"proved"` — after the response headers are read, with `{durationMs}` (server's `x-prove-duration-ms` or client round-trip) (`:379`).
  - `"receive"` — after the JSON body is successfully read under the response cap (`:387`).
- **`PrestoUltraHonkBackend` itself** (`presto-ultra-honk-backend.ts`):
  - `"fallback"` — entering `#fallbackFrom` before local WASM proving starts (`:220`).
  - `"proving"` — start of `#proveLocally` (local WASM proof), for both the fallback path and `setForceLocal(true)` (`:227`).
  - `"proved"` — end of `#proveLocally`, with `{durationMs}` measured locally (`:232`).
  - `"receive"` — right after `"proved"` in `#fallbackFrom`, closing out the fallback trail (`:222`).

Documented trails (README `:61-63`, `:105-109`):
> `options.onPhase` — phases: `detect` → (`downloading`) → `serialize` → `transmit` → `proving` → `proved` → `receive`; a fallback emits `fallback` then the local `proving`/`proved`/`receive`; `secure-connection-unavailable`, `denied`, or `version-mismatch` may precede a fallback.

Confirmed by the unit test's native trail: `["detect", "serialize", "transmit", "proving", "proved", "receive"]` (`presto-ultra-honk-backend.test.ts:123`) and the fallback trail's fixed tail `["proving", "proved", "receive"]` preceded by `"fallback"` and an optional diagnostic phase (`:209-211`).

# Security audit — cluster `noir-adapter` (`@alejoamiras/presto-noir`, `packages/sdk-noir/src`)

Scope read in full: `presto-ultra-honk-backend.ts`, `proof-data.ts`, `verifier-target.ts`,
`tested-versions.ts`, `errors.ts`, `index.ts`, `README.md`, `e2e/native.test.ts` (wire contract
only). Handoff edges followed one level: `PrestoClient.prove`/`#classifyHttpError`
(`packages/sdk-core/src/lib/presto-client.ts`), `PrestoHttpError`/`parseServerError`
(`packages/sdk-core/src/lib/errors.ts`), `fromBase64`/`toBase64`
(`packages/sdk-core/src/lib/base64.ts`), and bb.js's real `UltraHonkBackend`
(`node_modules/.bun/@aztec+bb.js@5.2.0/.../dest/node/barretenberg/backend.js`) to verify
`verifyProof`/`getVerificationKey` recompute the key from the constructor's own bytecode rather than
trusting any externally supplied key.

## Findings

None. Every attacker-controlled-presto scenario in the brief's threat model traces to a concrete,
already-present control that closes it; no new source→sink path was found that a malicious or
squatted local presto can use to violate confidentiality, integrity, authorization, or availability
beyond the accepted trust boundaries this cluster is explicitly scoped against. See below for the
per-scenario trace and why each does not qualify.

## Non-findings considered

- **Malicious presto returns a "proof" that isn't a valid proof for the circuit.** `verifyProof`
  (`presto-ultra-honk-backend.ts:147-149`) always delegates to the WASM backend, which recomputes the
  verification key from `this.#bytecode` (the constructor's own artifact) via `circuitComputeVk` and
  never accepts a caller/presto-supplied key (confirmed in bb.js's real
  `UltraHonkBackend.verifyProof`, `backend.js:128-148`) — circuit-bound exactly as documented. A
  presto that fabricates proof bytes produces a proof that fails this recompute-and-check; the
  adapter never treats an unverified `generateProof` result as authoritative on its own (matches
  bb.js's own contract, where `generateProof` also returns unverified data).
- **A presto-supplied `vk` "belonging to another circuit."** `decoded.vk` is cached in
  `#serverKeys` keyed only by `verifierTarget` (`presto-ultra-honk-backend.ts:93,142`), but is (a)
  never returned by `getVerificationKey`, which checks only the caller's own seed
  (`:152-156`), (b) never consulted by `verifyProof` (WASM-only, above), and (c) only ever re-sent
  as `vk` in a later `#encodeJob` (`:207-209`) to the *same* untrusted presto that supplied it — this
  is the accepted "a key for another circuit only spoils this backend's own proofs" boundary, and the
  same reasoning covers the server-cached case symmetrically with the documented client-seeded case.
- **Oversized/malformed response fields.** `decodeUltraHonkResponse` (`proof-data.ts:21-42`) rejects
  non-string fields, non-32-byte-aligned `proof`/`public_inputs`, an empty `proof`, and a `vk` outside
  `1..65536` bytes, all before anything is cached or returned; any decode failure is caught in
  `generateProof` (`presto-ultra-honk-backend.ts:135-141`) and degrades to `"malformed-response"`
  rather than being returned as a proof. `fromBase64` (`sdk-core/src/lib/base64.ts:25-36`) fails
  closed on non-alphabet characters or bad padding (linear-time regex, no ReDoS). The overall response
  is additionally bounded by the pre-existing 8 MiB `responseCap` one layer up
  (`presto-client.ts:493`, `types.ts:196-197`), which this adapter does not override.
- **A `vk` returned when the request already supplied one.** Even if a malicious presto ignores that
  server-side contract and returns a `vk` anyway, `generateProof` unconditionally overwrites
  `#serverKeys[target]` with it (`:142`); but since a matching `#seed` always takes priority in
  `#encodeJob` (`:207-208`) and neither `getVerificationKey` nor `verifyProof` ever reads
  `#serverKeys`, the injected value has no reachable effect beyond being echoed back to the same
  untrusted party on a future request for that target.
- **`#serverKeys` as an unbounded/poisonable cache.** `VerifierTarget` is a closed 8-value enum
  enforced by `resolveVerifierTarget` (`verifier-target.ts:20-39`, throws on any value outside
  `VERIFIER_TARGETS`), so the map can hold at most 8 entries per instance — no memory-growth or
  cache-poisoning-across-targets vector.
- **`onPhase` as an information channel.** `PrestoPhaseData` is a closed shape,
  `{ durationMs: number }` (`sdk-core/src/lib/types.ts:26-29`); the only presto-influenced value
  reaching it is the numeric `x-prove-duration-ms` header, parsed with `Number(...)` and validated
  `Number.isFinite(...) && > 0` before use (`presto-client.ts:485-489`). No string/object from the
  presto response reaches `onPhase`; no injection or unbounded-content sink exists on this path.
- **`bbVersion` used to build the `x-aztec-version` request header.** `resolveBbVersion`
  (`tested-versions.ts:14-26`) enforces `^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$` before the value is ever
  used, which excludes CR/LF and any header-delimiter character — no header-injection vector via
  `bbVersion`.
- **Dynamically imported `@aztec/bb.js` peer being a different version than pinned.**
  `loadUltraHonkBackend` (`presto-ultra-honk-backend.ts:267-282`) only checks that
  `UltraHonkBackend` is a function, not that the resolved package's version matches
  `TESTED_BB_VERSION`. This is a real gap in version-pairing *enforcement* on the WASM path, but it
  is not a distinct vulnerability of this cluster: any consumer that imports `@aztec/bb.js` directly
  carries the identical supply-chain trust dependency (whatever is resolved under that specifier is
  fully trusted, since `verifyProof`/`getVerificationKey`/`getSolidityVerifier` delegate to it
  entirely) — the adapter neither widens this trust nor removes an existing guard. No concrete,
  adapter-specific exploit path.
- **`PrestoHttpError`'s `serverMessage` (`sdk-core/src/lib/errors.ts:16-26`, populated from
  `parseServerError`'s `message` field, `errors.ts:37-53`) carries attacker-controlled text from a
  malicious presto's `400`/unrecognized-`500` body into a thrown `Error.message` the adapter's caller
  receives unmodified.** No sink for this string exists inside the `noir-adapter` cluster itself
  (no DOM write, no `eval`, no template interpolation, no re-logging with elevated privilege) — the
  adapter only `throw`s it in `generateProof`'s caller-facing exception path. A concrete XSS/log-
  injection finding would require showing an unsafe sink in the *consuming application*, which is
  outside this cluster; marking as non-finding per the "cannot provide a concrete trace" rule.
- **Byte-identity assumption between native and WASM `*-no-zk` proofs.** This is exercised only in
  `e2e/native.test.ts` and `e2e/wasm-identity.test.ts` as a test oracle; no production code path in
  `presto-ultra-honk-backend.ts`/`proof-data.ts` uses byte-identity as a trust or validation
  mechanism at runtime, so a target/ZK-mode mismatch from a malicious presto is caught (or not) purely
  by the same `verifyProof` recompute described above, not by any identity comparison in the shipped
  adapter.
- **Verifier-target confusion (client believes target T, presto silently proves target T′).**
  `resolveVerifierTarget` (`verifier-target.ts:20-39`) is pure, local, and derives only from the
  caller's own `options` — it cannot be influenced by the presto's response, and the response body
  carries no `verifier_target` echo for the adapter to trust either way. A presto that swaps targets
  produces a proof whose settings-bound recompute in `verifyProof` (see above) will not match,
  surfacing as a failed verification rather than a silent trust decision.
- **Witness/bytecode confidentiality in transit.** Both are handed to `PrestoClient.prove` unmodified
  (`presto-ultra-honk-backend.ts:126-131`); the transport-security policy (HTTPS default, loopback
  endpoint validation, origin approval) is enforced entirely inside `sdk-core`'s `PrestoClient`/
  `PrestoTransport`, one handoff edge beyond this cluster's boundary and covered by a separate
  cluster — no adapter-level code widens or bypasses that policy.
- **Prototype pollution via the JSON response.** `decodeUltraHonkResponse` only reads named
  properties (`record.proof`, `record.public_inputs`, `record.vk`) off the parsed body; nothing is
  spread or merged into a live object, and `JSON.parse` itself does not trigger the `__proto__`
  accessor (own-property `[[DefineOwnProperty]]` semantics). No pollution vector.

## Out of cluster

- `PrestoHttpError.message` carrying unsanitized presto-controlled text to the adapter's caller
  (see non-finding above) is worth a one-line check in whatever cluster/audit covers `sdk-core`'s
  `errors.ts`/`presto-client.ts` plus any first-party consumer (playground) that might render error
  messages directly — no sink exists in `sdk-noir` itself.
- The `@aztec/bb.js` peer's WASM path is fully trusted with no runtime version assertion
  against `TESTED_BB_VERSION` (`presto-ultra-honk-backend.ts:267-282`); this is a correctness/
  version-pairing gap rather than a cluster-specific vulnerability, but if a supply-chain audit of
  `package.json`/lockfile pinning is in scope elsewhere, the observation belongs there.

## Cross-rebuttal

**(1) What the other reviewer missed.** Nothing. Codex's ten non-findings cover the same attack
surface I traced (server-key caching/precedence, structural-vs-cryptographic decoding, malformed/
oversized fields, `fallback: "none"` backpressure, verifier-target confusion, byte-identity, the
untested-bb.js-version gap, `onPhase`, and response-property injection) and reach the same
conclusions I did. I re-checked every file:line citation in their report against source and all are
accurate: `presto-ultra-honk-backend.ts:147,219,124,142,207,152,115,276,201`,
`proof-data.ts:19,21,23,29,38,45`, `verifier-target.ts:20`, `tested-versions.ts:14`,
`presto-client.ts:485` (confirmed `onPhase("proved")` at line 491 fires before `readJsonBody` at
line 493, i.e. before decoding — their claim holds), `presto-client.ts:541` (the `503|408|413|429|
500-recognized` block that returns `fallback("transient")`, off by a few lines from the literal
`429` check at line 545 but in the right block), and `presto-transport.ts:49`
(`PROVE_BODY_MAX_BYTES = 8 * 1024 * 1024`, confirmed) and `:1009` (`readJsonBody`'s signature, which
applies the 60 s `PROVE_BODY_TIMEOUT_MS` defined at line 48 — accurate in substance). No gap in their
coverage produces a concrete trace I can complete into a finding.

**(2) Non-findings I consider wrongly dismissed.** None. Their strongest claim —
"`verifyProof` is circuit-bound because the WASM backend recomputes the key from the constructor's
bytecode" (`backend.js:134`) — is the same load-bearing control my own report leans on, and I
independently verified `circuitComputeVk` is called with `this.acirUncompressedBytecode` (the
adapter's own bytecode) rather than any presto-supplied key, at `backend.js:128-148`. Their
"cached-key poisoning — contained" reasoning (`:142`/`:207`/`:152`) matches my analysis byte-for-byte:
a seed always outranks a cached server key in `#encodeJob`, and `getVerificationKey` never reads
`#serverKeys` at all. Their `onPhase` non-finding ("UI progress notifications... no external
telemetry sink") is narrower than mine (I additionally confirmed the payload type is a closed
`{durationMs: number}` shape, `types.ts:26-29`, so no string/object channel exists even if a sink
appeared later) — complementary, not contradictory.

**(3) Revisions to my own report.** None to the Findings or Non-findings sections — both reports
independently reach zero findings via matching traces, which is corroborating evidence rather than a
reason to soften or harden either conclusion. One addition worth noting for the coordinator: Codex's
non-finding on "malformed fields and oversized responses" cites `presto-transport.ts:49`
(`PROVE_BODY_MAX_BYTES`) and `:1009` (the 60 s deadline) for the upstream response-size/time bound
that my own report only cited indirectly (via the repo map's "responseCap, default 8 MiB" claim,
`sdk-core.md`). I verified those two source lines directly in this rebuttal pass; they hold, so my
"Malformed fields" non-finding above is now confirmed against source rather than the map. My
out-of-cluster notes (`PrestoHttpError.message` unsanitized text with no in-cluster sink; the
untested-bb.js-version gap) stand unchanged and are consistent with Codex's independent treatment of
the same two items.

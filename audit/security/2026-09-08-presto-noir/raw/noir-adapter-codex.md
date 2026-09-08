## Findings

No reportable security vulnerabilities identified in the `noir-adapter` cluster.

**Confidence: moderate.** This was a static, bounded audit of the requested source and handoff edges. No files were changed, builds executed, or network requests made.

## Non-findings considered

- **Server-supplied key accepted as verification authority — rejected.** `verifyProof` delegates to the local backend at `packages/sdk-noir/src/lib/presto-ultra-honk-backend.ts:147`; that backend derives its key from the constructor’s circuit bytecode before verification at `node_modules/.bun/@aztec+bb.js@5.2.0/node_modules/@aztec/bb.js/dest/node/barretenberg/backend.js:134`. Neither the response key nor an extra key property on `ProofData` replaces that key.

- **Cached-key poisoning and unsolicited `vk` — contained.** Responses can populate the per-instance, per-target cache at `packages/sdk-noir/src/lib/presto-ultra-honk-backend.ts:142`, including when a key was supplied. However, the caller’s seed takes precedence when constructing subsequent requests at `packages/sdk-noir/src/lib/presto-ultra-honk-backend.ts:207`; `getVerificationKey` returns the seed or derives a local key at `packages/sdk-noir/src/lib/presto-ultra-honk-backend.ts:152`. Poisoning can spoil subsequent native proofs for that instance, but cannot substitute verification authority or cross into another backend’s cache.

- **Structurally valid garbage returned as `ProofData` — no verification bypass established.** A nonempty, aligned byte array can pass decoding at `packages/sdk-noir/src/lib/proof-data.ts:29` and reach the caller at `packages/sdk-noir/src/lib/presto-ultra-honk-backend.ts:143`. Structural decoding explicitly does not promise cryptographic verification at `packages/sdk-noir/src/lib/proof-data.ts:19`; the documented example separately verifies at `packages/sdk-noir/README.md:23`. No in-cluster authorization decision treats successful generation as successful verification.

- **Malformed fields and oversized responses — bounded and rejected where specified.** String types, base64 decoding, field alignment, and the 64 KiB key limit are checked at `packages/sdk-noir/src/lib/proof-data.ts:23`, `packages/sdk-noir/src/lib/proof-data.ts:29`, and `packages/sdk-noir/src/lib/proof-data.ts:38`. Decode failures enter fallback at `packages/sdk-noir/src/lib/presto-ultra-honk-backend.ts:138`. The inherited response reader applies an 8 MiB body cap and 60-second body deadline at `packages/sdk-core/src/lib/presto-transport.ts:49` and `packages/sdk-core/src/lib/presto-transport.ts:1009`; field-to-hex conversion is linear at `packages/sdk-noir/src/lib/proof-data.ts:47`. No concrete resource-exhaustion bypass was established.

- **Backpressure silently triggering WASM under `fallback: "none"` — rejected.** HTTP `429` becomes `transient` at `packages/sdk-core/src/lib/presto-client.ts:541`; the adapter throws before invoking local proving at `packages/sdk-noir/src/lib/presto-ultra-honk-backend.ts:219`. Explicit `setForceLocal(true)` intentionally selects local proving at `packages/sdk-noir/src/lib/presto-ultra-honk-backend.ts:124`.

- **Verifier-target confusion or accidental ZK downgrade — rejected for supported options.** Explicit targets, conflicting legacy options, and legacy flag precedence are handled at `packages/sdk-noir/src/lib/verifier-target.ts:20`, matching the installed peer’s settings logic at `node_modules/.bun/@aztec+bb.js@5.2.0/node_modules/@aztec/bb.js/dest/node/barretenberg/backend.js:10`. The default remains `noir-recursive`, and the response cannot choose the target. Unknown explicit targets are rejected more strictly by the adapter.

- **Field ordering and byte-identity assumptions — no security-relevant discrepancy found.** Conversion preserves successive 32-byte fields and their byte order at `packages/sdk-noir/src/lib/proof-data.ts:45`, matching `deflattenFields` at `node_modules/.bun/@aztec+bb.js@5.2.0/node_modules/@aztec/bb.js/dest/node/proof/index.js:16`. Documentation limits native/WASM byte identity to `*-no-zk` targets at `packages/sdk-noir/README.md:76`; the ZK integration contract uses verification instead of byte equality at `packages/sdk-noir/e2e/native.test.ts:110`.

- **Different installed bb.js version bypassing the version gate — compatibility limitation without a concrete exploit.** The gate validates the requested native version at `packages/sdk-noir/src/lib/tested-versions.ts:14`; the dynamic loader checks export presence, not the installed version, at `packages/sdk-noir/src/lib/presto-ultra-honk-backend.ts:276`. The peer is exactly pinned at `packages/sdk-noir/package.json:32`. A mismatched installation can break compatibility, but no attacker-controlled response path selects a different module or produces a demonstrated false verification result.

- **`onPhase` as a confidentiality or authorization channel — no concrete violation found.** Core emits a server-influenced finite positive duration and emits `proved` before decoding completes at `packages/sdk-core/src/lib/presto-client.ts:485`. The adapter forwards these events at `packages/sdk-noir/src/lib/presto-ultra-honk-backend.ts:115`. They are UI progress notifications, not verification results; no in-cluster authorization or external telemetry sink consumes them. Witnesses, keys, and proof bytes are not passed directly to the callback.

- **Injection or prototype pollution through response fields — no reachable sink.** The decoder reads selected properties into fresh binary values at `packages/sdk-noir/src/lib/proof-data.ts:21`; request construction serializes a fresh object at `packages/sdk-noir/src/lib/presto-ultra-honk-backend.ts:201`. These paths do not evaluate response text, merge response properties into application objects, or use them as module paths.

## Out of cluster

- No new serious out-of-cluster issue identified; the supplied exclusions and already-tracked items were not re-reported.
## Cross-rebuttal (Codex, after reading the Claude report)

## Cross-rebuttal

### 1. What the other reviewer missed

**Nothing that establishes a new security finding.** Their report does omit explicit backpressure analysis: `429` becomes `transient` at `packages/sdk-core/src/lib/presto-client.ts:545`, and `fallback: "none"` throws before local proving at `packages/sdk-noir/src/lib/presto-ultra-honk-backend.ts:219`. That omission does not conceal a vulnerability.

### 2. What looks overconfident in their claims

They reported no findings requiring individual classification. The following supporting claims warrant qualification:

- **VERIFIED — server keys cannot replace verification authority.** The adapter delegates verification at `packages/sdk-noir/src/lib/presto-ultra-honk-backend.ts:147`; bb.js computes the verification key from its circuit bytecode at `node_modules/.bun/@aztec+bb.js@5.2.0/node_modules/@aztec/bb.js/dest/node/barretenberg/backend.js:134`. `getVerificationKey` bypasses the server-key cache at `packages/sdk-noir/src/lib/presto-ultra-honk-backend.ts:152`. **Confidence: high.**

- **DISPUTED — “every attacker-controlled-presto scenario” is closed by a control.** This overstates the result. Structurally valid garbage still returns successfully at `packages/sdk-noir/src/lib/presto-ultra-honk-backend.ts:143`; verification is a separate caller action at `packages/sdk-noir/src/lib/presto-ultra-honk-backend.ts:147`. The defensible conclusion is that no security-sensitive acceptance sink was identified, not that generation necessarily rejects malicious output. **Confidence: high.**

- **DISPUTED — cached keys necessarily return to the “same untrusted party.”** The cache is associated with the adapter and target, not an authenticated service identity: `packages/sdk-noir/src/lib/presto-ultra-honk-backend.ts:93`, `packages/sdk-noir/src/lib/presto-ultra-honk-backend.ts:142`, and `packages/sdk-noir/src/lib/presto-ultra-honk-backend.ts:207`. A replacement listener can receive an earlier listener’s cached key. This remains a non-finding under the accepted discovery boundary; key isolation from verification, rather than continuity of server identity, supports that conclusion. **Confidence: high.**

- **DISPUTED — numeric validation closes the information-channel question.** `Number.isFinite` and positivity constrain representation, not information content, at `packages/sdk-core/src/lib/presto-client.ts:485`. The attacker-influenced number is logged and forwarded at `packages/sdk-core/src/lib/presto-client.ts:490`. Additionally, `proved` precedes body validation at `packages/sdk-core/src/lib/presto-client.ts:491`. No concrete unauthorized recipient or security-sensitive callback consumer was established, so this remains a non-finding. **Confidence: high.**

- **DISPUTED — byte-identity checking exists only in tests.** That is correct for the adapter’s production implementation, but not repository-wide: the playground compares against its fixture at `packages/playground/src/noir.ts:153` and reports the result at `packages/playground/src/noir.ts:154`. This is a scope correction, not an exploit. **Confidence: high.**

- **SPECULATIVE — every substituted verifier target necessarily causes rejection.** The wrapper supplies caller-selected settings to bb.js, but establishing rejection across every target pairing requires underlying cryptographic evidence beyond this bounded trace. The locally selected target is verified at `packages/sdk-noir/src/lib/verifier-target.ts:20`; universal cross-target rejection is not established by that selection alone. No concrete bypass was demonstrated.

### 3. Revisions to my own findings

**No findings added, withdrawn, or downgraded.** Reinspection strengthens the server-key isolation conclusion to **high confidence**.

My overall assessment remains **moderate confidence: no reportable vulnerability identified within the bounded audit**. Successful generation remains distinct from verification, and phase notifications remain untrusted progress information. The other reviewer’s broader assurance is not justified by the available evidence.
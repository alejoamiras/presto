Audited `f331a78` using source review and in-memory Fetch mocks. No files were changed and no network requests were made.

## Findings

### F-1: Concurrent proof can bypass HTTP endpoint validation

1. **Title:** Concurrent proof can bypass HTTP endpoint validation.

2. **Impact factors:** Confidentiality loss: a private witness can reach a foreign HTTP listener that never passed discovery. Blast radius is concurrent proofs sharing one client. Attack vector: local loopback listener, including another OS account; no elevated privileges required. Complexity is high: the exploit requires HTTP downgrade consent, an HTTPS request failure, and a specific asynchronous interleaving. Browser execution additionally requires applicable network/CORS permissions.

3. **Evidence confidence:** **High.** Reproduced against the actual client with in-memory Fetch mocks. The HTTP listener always returned foreign health JSON; nevertheless, the second proof POST reached it before its pending health check completed. Control runs with downgrade disabled or HTTPS-only enabled sent only HTTPS POSTs.

4. **OWASP / CWE mapping:** OWASP Top 10: Insecure Design. CWE-362, race condition; CWE-200, sensitive information exposure.

5. **Trace:**
   - Proof B obtains the previously cached, healthy HTTPS status through `packages/sdk-core/src/lib/presto-client.ts:128` and awaits it at `packages/sdk-core/src/lib/presto-client.ts:323`.
   - Meanwhile, proof A’s HTTPS failure enters HTTP recovery at `packages/sdk-core/src/lib/presto-client.ts:450`. `packages/sdk-core/src/lib/presto-transport.ts:650` clears the shared protocol pin without changing the configuration generation.
   - A awaits HTTP validation at `packages/sdk-core/src/lib/presto-client.ts:453`.
   - B resumes with its earlier available status. The generation check at `packages/sdk-core/src/lib/presto-client.ts:333` passes.
   - B constructs its URL from the **current shared pin**, rather than the protocol in its checked status, at `packages/sdk-core/src/lib/presto-client.ts:364`. The cleared pin selects HTTP at `packages/sdk-core/src/lib/presto-transport.ts:692`.
   - The witness reaches that URL through `packages/sdk-core/src/lib/presto-client.ts:401` and `packages/sdk-core/src/lib/presto-transport.ts:958`.

6. **Missing control:** Proof eligibility and the selected destination are not one consistent snapshot. Bind the attempt to the protocol that passed its health check; clearing another attempt’s pin must not independently authorize HTTP.

7. **Exploit story:**
   - Configure `{ httpsOnly: false, allowInsecureDowngrade: true }`.
   - HTTPS discovery succeeds; HTTP discovery returns `{"hello":"not presto"}`.
   - A’s HTTPS proof request fails.
   - B obtains cached HTTPS availability immediately before A clears the pin.
   - A starts an HTTP health check, which the foreign listener delays.
   - B resumes and sends its witness directly over HTTP. A subsequently rejects the foreign health response and falls back, after B’s disclosure has occurred.

8. **Preconditions:** One shared client, overlapping proof operations, explicit downgrade permission, an HTTPS failure, and the described scheduling window. HTTPS-only configurations are unaffected.

9. **Why mitigations fail:** Single-flight health probing does not serialize proof recovery. Configuration-generation checks cannot detect protocol-pin changes. The HTTP validation at `packages/sdk-core/src/lib/presto-client.ts:453` protects A’s retry, while B bypasses that retry path entirely. This is a new discovery bypass: the listener need not forge an accepted health shape.

10. **Instances:** Shared-state mutation: `packages/sdk-core/src/lib/presto-client.ts:450`, `packages/sdk-core/src/lib/presto-transport.ts:650`. Stale eligibility/current destination combination: `packages/sdk-core/src/lib/presto-client.ts:323`, `packages/sdk-core/src/lib/presto-client.ts:364`, `packages/sdk-core/src/lib/presto-transport.ts:692`. Both production adapters reach this code: `packages/sdk/src/lib/presto-prover.ts:162` and `packages/sdk-noir/src/lib/presto-ultra-honk-backend.ts:126`.

### F-2: Payload iterator can bypass a newly enabled HTTPS-only policy

1. **Title:** Payload iterator can bypass a newly enabled HTTPS-only policy.

2. **Impact factors:** Confidentiality-policy violation: a witness is transmitted over HTTP after `configure({ httpsOnly: true })` has completed. Blast radius is one direct `PrestoClient.prove()` operation. This requires caller-controlled executable input—a custom payload iterator with access to configuration—not merely a malicious server response. No OS privilege is required; complexity is high and the configuration transition is essential.

3. **Evidence confidence:** **High.** An in-memory reproduction using a real `Uint8Array` with an overridden iterator sent an HTTP POST after enabling HTTPS-only. Performing the same configuration change in `onPhase("transmit")` correctly produced `endpoint-changed` without any POST.

4. **OWASP / CWE mapping:** OWASP Top 10: Broken Access Control. CWE-863, incorrect authorization; CWE-200, sensitive information exposure.

5. **Trace:**
   - Caller-controlled `body()` enters through `packages/sdk-core/src/lib/types.ts:190` and returns the payload at `packages/sdk-core/src/lib/presto-client.ts:377`.
   - The HTTP destination was already captured at `packages/sdk-core/src/lib/presto-client.ts:364`.
   - The final configuration-generation check runs at `packages/sdk-core/src/lib/presto-client.ts:385`.
   - **After that check**, `Uint8Array.from(payload)` invokes the payload’s custom iterator at `packages/sdk-core/src/lib/presto-client.ts:396`.
   - That iterator calls `configure({ httpsOnly: true })`, updating policy and generation at `packages/sdk-core/src/lib/presto-transport.ts:582` and `packages/sdk-core/src/lib/presto-transport.ts:591`.
   - No further check occurs before `packages/sdk-core/src/lib/presto-client.ts:401`; `packages/sdk-core/src/lib/presto-transport.ts:958` sends to the captured HTTP URL.

6. **Missing control:** Caller-controlled payload conversion occurs after the last policy check. Complete that conversion before checking generation, and enforce the selected protocol’s eligibility immediately before dispatch.

7. **Exploit story:** Start with an eligible HTTP endpoint. Return a `Uint8Array` whose `[Symbol.iterator]` enables HTTPS-only before yielding the witness bytes. The copy completes and the client sends those bytes to its previously captured HTTP URL, despite the completed policy change.

8. **Preconditions:** Direct use of the exported core API; initially permitted HTTP proving; a custom payload iterator that re-enters configuration. The stock adapters construct ordinary arrays at `packages/sdk/src/lib/presto-prover.ts:166` and `packages/sdk-noir/src/lib/presto-ultra-honk-backend.ts:210`, so this exact input is not supplied by those adapters.

9. **Why mitigations fail:** Freezing the request at `packages/sdk-core/src/lib/presto-client.ts:308` does not freeze the subsequently returned payload or prevent iterator execution. The check at `packages/sdk-core/src/lib/presto-client.ts:385` precedes that execution. Snapshotting the destination preserves its old protocol even after policy changes.

10. **Instances:** Post-check caller execution at `packages/sdk-core/src/lib/presto-client.ts:396`; unchecked dispatch at `packages/sdk-core/src/lib/presto-client.ts:401`; explicit-URL acceptance at `packages/sdk-core/src/lib/presto-transport.ts:958`.

## Non-findings considered

- **Deliberate health impersonation:** Excluded as the accepted discovery boundary documented at `packages/sdk/README.md:386`; F-1 does not require successful impersonation.
- **Non-loopback URL injection:** Host normalization, numeric port validation, and route validation constrain the destination at `packages/sdk-core/src/lib/presto-transport.ts:92`, `packages/sdk-core/src/lib/presto-transport.ts:73`, and `packages/sdk-core/src/lib/presto-client.ts:56`.
- **Redirect-based witness forwarding:** All four Fetch paths specify redirect refusal at `packages/sdk-core/src/lib/presto-transport.ts:746`, `packages/sdk-core/src/lib/presto-transport.ts:801`, `packages/sdk-core/src/lib/presto-transport.ts:923`, and `packages/sdk-core/src/lib/presto-transport.ts:964`.
- **Ordinary callback reconfiguration:** Generation checks reject endpoint and policy changes before dispatch at `packages/sdk-core/src/lib/presto-client.ts:333` and `packages/sdk-core/src/lib/presto-client.ts:385`; F-2 identifies execution occurring afterward.
- **Server-controlled oversized/stalled bodies:** Normal streamed reads enforce byte and elapsed-time limits at `packages/sdk-core/src/lib/presto-transport.ts:404` and `packages/sdk-core/src/lib/presto-transport.ts:440`. Error-body failures preserve HTTP classification at `packages/sdk-core/src/lib/presto-transport.ts:992`.
- **Unlimited caller-selected response cap:** `Infinity` removes the bound, but the caller explicitly controls that policy at `packages/sdk-core/src/lib/types.ts:197`; neither stock adapter overrides it.
- **Uncancelled non-success health responses:** Early returns at `packages/sdk-core/src/lib/presto-transport.ts:804` and `packages/sdk-core/src/lib/presto-transport.ts:926` skip body cleanup. Runtime connection exhaustion was not established under the no-network constraint; not reported as a vulnerability.
- **Logging/XSS:** Server error strings reach logging at `packages/sdk-core/src/lib/presto-client.ts:531`, but no concrete witness disclosure or executable rendering chain was established.
- **Proof forgery / verification-key confusion:** Transport returns unverified JSON by contract at `packages/sdk-core/src/lib/types.ts:230`; the Noir adapter’s verification remains delegated to its circuit-bound backend at `packages/sdk-noir/src/lib/presto-ultra-honk-backend.ts:147`.

## Out of cluster

- None identified within the permitted handoff inspection.
## Cross-rebuttal (Codex, after reading the Claude report)

## Cross-rebuttal

### 1. What the other reviewer missed

**F-1 remains a concrete finding: concurrent proof recovery can bypass HTTP health validation. Confidence: high.**

With `{ httpsOnly: false, allowInsecureDowngrade: true }`, proof B obtains cached HTTPS availability at `packages/sdk-core/src/lib/presto-client.ts:323`. Before B resumes, failing proof A clears the shared protocol pin at `packages/sdk-core/src/lib/presto-transport.ts:650` and awaits HTTP validation at `packages/sdk-core/src/lib/presto-client.ts:453`.

B then constructs its destination from the changed shared pin at `packages/sdk-core/src/lib/presto-client.ts:364`. That selects HTTP at `packages/sdk-core/src/lib/presto-transport.ts:692`; the witness is dispatched at `packages/sdk-core/src/lib/presto-transport.ts:958`.

The earlier in-memory reproduction demonstrated an HTTP POST while HTTP validation was pending; that validation subsequently failed. Configuration generation does not change during pin demotion, so `packages/sdk-core/src/lib/presto-client.ts:333` cannot detect this interleaving.

This differs from replacing a listener **after successful validation**: the receiving HTTP endpoint never passed validation.

**F-2’s narrow reentrancy path was also omitted. Confidence: high for the demonstrated behavior.**

The generation check at `packages/sdk-core/src/lib/presto-client.ts:385` precedes `Uint8Array.from(payload)` at `packages/sdk-core/src/lib/presto-client.ts:396`. A caller-supplied payload iterator can therefore enable HTTPS-only at `packages/sdk-core/src/lib/presto-transport.ts:582`, increment generation at `packages/sdk-core/src/lib/presto-transport.ts:591`, and still have the captured HTTP URL dispatched at `packages/sdk-core/src/lib/presto-transport.ts:958`.

This requires direct core usage and a custom iterator with configuration access. It is not a server-response-only exploit.

### 2. What looks overconfident in their claims

The other reviewer reported **no findings**, so there are no individual findings to classify. These supporting conclusions need qualification:

- **DISPUTED — all relevant races reduce to accepted unauthenticated discovery.** F-1 bypasses the existing discovery requirement rather than exploiting its lack of authentication. The premature shared-state change occurs at `packages/sdk-core/src/lib/presto-client.ts:450`; validation follows at `packages/sdk-core/src/lib/presto-client.ts:453`. Another proof can use that changed state independently.

- **DISPUTED — HTTP cannot be queried again after HTTPS succeeds.** That is conditional on downgrade policy. `packages/sdk-core/src/lib/presto-transport.ts:634` permits downgrade when `allowInsecureDowngrade` is true; `packages/sdk-core/src/lib/presto-transport.ts:606` incorporates that exception. Their statement omits a supported configuration essential to F-1.

- **DISPUTED — hostile caller inputs can categorically be excluded as same-user malware.** The supplied threat model explicitly includes hostile configuration/request values and reconfiguring callbacks. Nevertheless, executable payload suppliers require substantially more capability than plain configuration data; F-2 must retain that distinction. Its relevant execution point is `packages/sdk-core/src/lib/presto-client.ts:396`.

- **VERIFIED, with a coverage limitation — bounded readers protect bodies they consume.** Non-success diagnostic and retry-health responses return before consuming or cancelling their bodies at `packages/sdk-core/src/lib/presto-transport.ts:804` and `packages/sdk-core/src/lib/presto-transport.ts:926`. This prevents claiming universal body-lifecycle coverage, but I still lack a demonstrated resource-exhaustion exploit and do not promote it to a finding.

### 3. Revisions to my own findings

- **F-1: retain and strengthen the distinction from accepted discovery risk.** Confidence remains **high** for the source trace and mocked interleaving. Real-browser exploit timing remains untested. HTTPS-only and downgrade-disabled control runs did not disclose a witness over HTTP. Eligibility should remain bound to the checked protocol, rather than being reconstructed from mutable shared state at `packages/sdk-core/src/lib/presto-client.ts:364`.

- **F-2: retain, with narrowly stated security significance.** The reproduction proves a policy change can be missed; it does not establish an external attacker gaining new execution privileges. Ordinary adapter payloads do not supply the required iterator: `packages/sdk/src/lib/presto-prover.ts:166` and `packages/sdk-noir/src/lib/presto-ultra-honk-backend.ts:210`. No broader adapter vulnerability or default HTTPS-only bypass is claimed.
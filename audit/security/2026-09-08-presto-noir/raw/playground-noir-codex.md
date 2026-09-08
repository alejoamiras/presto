## Findings

No reportable security vulnerability established in the `playground-noir` cluster.

**Confidence: moderate.** Reviewed the requested source, dependency maps, relevant tests, and existing production bundle. No builds, tests, servers, network calls, or file modifications were performed.

## Non-findings considered

- **Plaintext Noir witnesses:** HTTP consent changes only the Aztec prover (`packages/playground/src/main.ts:73`, `packages/playground/src/aztec.ts:124`). Noir constructs an independent client without disabling HTTPS (`packages/playground/src/noir.ts:122`); core defaults browser clients to HTTPS-only (`packages/sdk-core/src/lib/config.ts:28`, `packages/sdk-core/src/lib/config.ts:33`). The consent flow does not downgrade Noir.

- **Hostile query parameters:** `httpsOnly` only enables an explicit secure policy; `httpsOnly=false` supplies no override (`packages/playground/src/noir.ts:115`, `packages/playground/src/noir.ts:124`). `forceProofs` only enables Aztec proving and cannot supply a circuit, witness, endpoint, or script (`packages/playground/src/aztec.ts:224`).

- **Production stub activation:** `noirStub=true` requires `import.meta.env.DEV` (`packages/playground/src/noir.ts:119`). The inspected production JavaScript contains no `noirStub` string. The production smoke test explicitly exercises this parameter while requiring real WASM traffic (`packages/playground/e2e/noir.production-smoke.spec.ts:24`, `packages/playground/e2e/noir.production-smoke.spec.ts:36`); that test was inspected, not executed.

- **DOM XSS through malicious Presto responses:** Proof exceptions enter `appendLog` at `packages/playground/src/main.ts:192` and reach `textContent` at `packages/playground/src/ui.ts:55`. Result labels are application-selected literals (`packages/playground/src/main.ts:189`) rendered through `textContent` (`packages/playground/src/results.ts:151`). No attacker-controlled HTML sink was found.

- **Unsafe links:** `appendLog` can assign an optional URL to `href` (`packages/playground/src/ui.ts:48`), but the Noir call sites never supply that argument (`packages/playground/src/noir.ts:142`, `packages/playground/src/noir.ts:154`, `packages/playground/src/main.ts:192`). No reachable `javascript:` URL injection was established.

- **Tampered or replayed native proofs:** Returned proof bytes and public inputs are compared with the committed reference (`packages/playground/src/noir.ts:75`); differences receive an explicit error label (`packages/playground/src/main.ts:189`, `packages/playground/src/results.ts:157`). Replaying the public reference can misrepresent benchmark freshness, but this panel makes no authorization decision or transaction submission from that result.

- **Witness exposure and verifier-target confusion:** The production-wired witness, key, and reference proof are intentionally committed fixture data (`packages/playground/vite.config.ts:137`). The backend receives the fixture’s key and target (`packages/playground/src/noir.ts:123`, `packages/playground/src/noir.ts:149`), with no URL-controlled replacement path.

- **Fixture-plugin traversal or code injection:** The plugin accepts one exact virtual-module identifier, reads fixed filenames from a fixed directory, and serializes the module using `JSON.stringify` (`packages/playground/vite.config.ts:117`, `packages/playground/vite.config.ts:124`, `packages/playground/vite.config.ts:145`). No request-controlled filesystem path or executable interpolation was found.

- **Worker-path manipulation and prototype pollution:** Request-derived basenames must match an own property of the fixed worker mapping; the rewritten path comes from that mapping (`packages/playground/vite.config.ts:63`, `packages/playground/vite.config.ts:68`, `packages/playground/vite.config.ts:70`). Arbitrary basenames cannot select arbitrary files. bb.js imports are deduplicated (`packages/playground/vite.config.ts:247`).

- **Cross-origin reuse and framing:** The headers lack framing restrictions (`packages/playground/public/_headers:1`, `packages/playground/vite.config.ts:151`). However, no cross-origin message interface or attacker-selected Noir job was found; the reachable action proves the fixed fixture after a click (`packages/playground/src/main.ts:165`, `packages/playground/src/noir.ts:149`). A concrete confidentiality, integrity, or availability exploit through framing was not established. The verified badge itself grants no approval (`packages/presto/VERIFIED_SITES.md:10`, `packages/presto/core/src/server/auth.rs:100`).

- **Third-party assets and missing CSP:** HTML loads Google Fonts CSS and the local application module (`packages/playground/index.html:27`, `packages/playground/index.html:293`). WASM initialization uses the packaged bb.js import (`packages/playground/src/noir.ts:85`). No concrete script-injection or private-witness exfiltration path through fonts, workers, or CRS was established; missing CSP alone is insufficient for a finding.

- **Concurrent proving and diagnostic leakage:** The click handler sets its busy guard before awaiting and disables action buttons (`packages/playground/src/main.ts:166`). Worker diagnostics retain message sizes rather than payloads (`packages/playground/src/diagnostics.ts:86`), and Noir logging contains timing and comparison outcomes (`packages/playground/src/noir.ts:154`). No new attacker-driven resource-exhaustion or witness-logging path was established.

## Out of cluster

None established.
## Cross-rebuttal (Codex, after reading the Claude report)

## Cross-rebuttal

### 1. What the other reviewer missed

Nothing that I can substantiate as a real finding. The omissions below warrant narrower conclusions, but do not establish an additional exploit.

### 2. What looks overconfident in their claims

They reported no findings requiring individual verdicts. These verdicts concern their non-finding rationales:

- **DISPUTED — Dev-server filesystem justification. Confidence: high.** Vite detects this workspace through `package.json:4`, not the presence of `bun.lock`: the installed implementation checks workspace declarations and two named configuration files (`packages/playground/node_modules/vite/dist/node/chunks/config.js:25356`, `packages/playground/node_modules/vite/dist/node/chunks/config.js:25385`). Also, HTTP file-serving permissions are not required for the configuration’s direct `readFileSync` calls (`packages/playground/vite.config.ts:136`). The conclusion remains a non-finding: the explicit allowed root matches the detected workspace root; no unauthorized file-read trace was established.

- **DISPUTED — Categorical exclusion of approval piggybacking. Confidence: high concerning the missing restriction.** Absence of injection or messaging interfaces does not settle UI redressing. Neither production headers nor dev/preview headers prohibit framing (`packages/playground/public/_headers:1`, `packages/playground/vite.config.ts:151`). The Noir action has no top-level-document check (`packages/playground/src/main.ts:165`). Nevertheless, browser permission behavior and meaningful downstream harm were not demonstrated; the action submits only the committed fixture (`packages/playground/src/noir.ts:149`). This remains a non-finding, with framing unresolved.

- **DISPUTED — “Safe `href` construction” as a general protection. Confidence: high.** Assigning `link.href = url` performs no scheme allowlisting (`packages/playground/src/ui.ts:48`); `textContent` and `noopener noreferrer` do not supply that validation. The actual reason this is a non-finding is the absence of attacker-controlled URLs reaching this argument from Noir (`packages/playground/src/noir.ts:142`, `packages/playground/src/main.ts:192`).

- **DISPUTED — “No cache-key or CORS misconfiguration surface exists.” Confidence: high.** Static hosting does not eliminate those surfaces: SPA fallback and cache headers are configured here (`packages/playground/wrangler.jsonc:10`, `packages/playground/public/_headers:7`). The audited development configuration also includes an HTTP proxy (`packages/playground/vite.config.ts:209`). The supported conclusion is that no concrete cache-poisoning or CORS exploit was found.

- **VERIFIED — HTTP consent isolation, with stronger supporting evidence. Confidence: high.** The consent action reconfigures only the Aztec prover (`packages/playground/src/aztec.ts:124`). Noir creates its own backend (`packages/playground/src/noir.ts:122`). Core resolves browser clients to HTTPS-only by default (`packages/sdk-core/src/lib/config.ts:28`, `packages/sdk-core/src/lib/config.ts:33`), and the playground’s explicit environment substitution exposes no `PRESTO_HTTPS_ONLY` override (`packages/playground/vite.config.ts:249`).

- **VERIFIED, narrowly — Concurrent-click protection. Confidence: high.** The synchronous guard prevents overlapping button actions in one document (`packages/playground/src/main.ts:166`). Its state is module-local (`packages/playground/src/main.ts:34`), so it establishes no cross-tab limit. Likewise, the log’s 500-entry bound limits element count, not total text bytes (`packages/playground/src/ui.ts:59`). Neither limitation supplies a demonstrated exhaustion exploit.

### 3. Revisions to my own findings

No findings to withdraw, downgrade, or strengthen; my report also contained none.

I retain the non-findings on plaintext Noir witnesses, response-driven XSS, and production stub activation. I clarify that the busy guard protects one document and that framing remains unverified—not proven harmless. Overall confidence remains **moderate**, reflecting static inspection without browser exploit testing.
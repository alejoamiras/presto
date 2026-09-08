## Findings

No new, concrete security vulnerability established in `route-ingress` at `f331a7877a36d4704436023dce204ee92786a319`.

**Confidence: moderate.** This was a static review of the specified files, relevant tests, maps, and permitted handoffs. No files were changed, builds or tests executed, or network calls made.

## Non-findings considered

- **Origin omission / DNS rebinding:** non-browser access without `Origin` is explicitly accepted at `packages/presto/core/src/server/auth.rs:80`; the outer Host guard rejects attacker-controlled domains and conflicting authorities at `packages/presto/core/src/server/host.rs:69` and `packages/presto/core/src/server/host.rs:79`. No browser bypass established.

- **Origin aliasing:** canonicalization rejects trailing-dot hosts, userinfo, unsupported schemes, and malformed extension IDs at `packages/presto/core/src/authorization.rs:25`, `packages/presto/core/src/authorization.rs:41`, and `packages/presto/core/src/authorization.rs:62`. No attacker-controlled browser origin shown to inherit another origin’s approval.

- **Popup approval forgery / cross-popup disclosure:** decisions and pending-origin reads require the caller’s request-specific native window label at `packages/presto/src-tauri/src/commands.rs:475` and `packages/presto/src-tauri/src/commands.rs:526`; only the active request can resolve at `packages/presto/core/src/authorization.rs:533`.

- **Authorization backlog exhaustion:** pending origins and piggyback senders are bounded at `packages/presto/core/src/authorization.rs:451` and `packages/presto/core/src/authorization.rs:459`; cooldown insertion and request registration share the manager lock at `packages/presto/core/src/authorization.rs:439`. No unbounded retained-request path established.

- **Delayed approval restoring revoked access:** approval reads, revocations, and persistence are serialized at `packages/presto/core/src/server/auth.rs:47`, `packages/presto/core/src/authorization.rs:500`, and `packages/presto/core/src/authorization.rs:510`. Forgotten revocations fail closed through the generation floor at `packages/presto/core/src/authorization.rs:317`.

- **Queued proof surviving revocation:** checks occur after permit acquisition, decoding, and workspace creation at `packages/presto/core/src/server/ultra_honk.rs:334`, `packages/presto/core/src/server/ultra_honk.rs:339`, and `packages/presto/core/src/server/ultra_honk.rs:352`. Downloads precede the first check at `packages/presto/core/src/server/prove.rs:312`; this matches the documented ordering at `implementations-plan/presto-noir/plan.md:135`. No queued-bb execution bypass established.

- **Single-origin admission monopolization:** gated requests take their origin slot before the global slot and body buffering at `packages/presto/core/src/server/prove.rs:257`. The no-Origin and `--allow-all` exemptions are explicitly documented at `implementations-plan/presto-noir/plan.md:100`; excluded as accepted behavior.

- **Oversized / stalled bodies:** all declared Content-Length values are checked at `packages/presto/core/src/server/prove.rs:139`; actual buffering independently enforces a size limit and absolute timeout at `packages/presto/core/src/server/prove.rs:185`. Authorization and admission precede buffering at `packages/presto/core/src/server/prove.rs:254`.

- **Base64 / gzip bombs and abandoned decoding:** encoded and decoded lengths are checked at `packages/presto/core/src/server/ultra_honk.rs:175` and `packages/presto/core/src/server/ultra_honk.rs:196`; concatenated gzip output is counted against the inflate cap at `packages/presto/core/src/server/ultra_honk.rs:225`. Blocking workers retain admission and prover guards at `packages/presto/core/src/server/ultra_honk.rs:296`.

- **JSON ambiguity / command injection:** repeated recognized fields are rejected at `packages/presto/core/src/server/ultra_honk.rs:140`; verifier targets become a closed enum at `packages/presto/core/src/bb/ultra_honk.rs:92`. Commands use separate arguments, fixed flags, and server-created filenames at `packages/presto/core/src/bb/ultra_honk.rs:251`.

- **Witness paths / cross-request files:** workspaces use fixed filenames at `packages/presto/core/src/bb/ultra_honk.rs:211`; Unix directories and files receive private permissions at creation, with exclusive file creation, at `packages/presto/core/src/bb.rs:233` and `packages/presto/core/src/bb.rs:277`. No client-controlled filesystem path established.

- **Health disclosure / CORS:** unapproved origins receive the minimal health body at `packages/presto/core/src/server.rs:445`; responses vary by Origin at `packages/presto/core/src/server.rs:389`. Wildcard CORS does not bypass the handler’s origin authorization.

- **Raw stderr disclosure:** bb failures return exit status rather than stderr at `packages/presto/core/src/bb.rs:477`; output-read errors identify fixed basenames at `packages/presto/core/src/bb/ultra_honk.rs:315`. No concrete cross-origin sensitive-data disclosure established.

- **Known exclusions:** premature admission release during bb termination was not re-reported (`packages/presto/core/src/bb.rs:359`). Client-key integrity and unsupported Starknet targets remain the documented cases at `packages/presto/README.md:84`.

## Out of cluster

None established within the permitted handoffs.
## Cross-rebuttal (Codex, after reading the Claude report)

## Cross-rebuttal

### 1. What the other reviewer missed

Nothing that I can establish as a new security finding with a concrete exploit trace.

### 2. What looks overconfident in their claims

**F-1 — SPECULATIVE as a security finding; the synchronous parsing path is VERIFIED.**

**Confidence: high** that parsing runs synchronously before the prove permit: `packages/presto/core/src/server/ultra_honk.rs:330` calls `serde_json::from_slice` at `packages/presto/core/src/server/ultra_honk.rs:169`, while permit acquisition follows at `packages/presto/core/src/server/ultra_honk.rs:333`. A malformed verifier target therefore causes parsing work without acquiring that permit.

**Confidence: moderate** in withholding security-finding status. The report establishes runtime-thread occupancy, but does not establish the claimed denial of service affecting unrelated requests:

- Existing controls still apply: authorization at `packages/presto/core/src/server/prove.rs:254`, per-origin admission at `packages/presto/core/src/server/prove.rs:257`, global admission at `packages/presto/core/src/server/prove.rs:265`, and actual body-size enforcement at `packages/presto/core/src/server/prove.rs:185`. These do not guarantee responsiveness, but they contradict an implication of unrestricted parsing.
- No pathological complexity, measured parse duration, or demonstrated starvation of another request is supplied. The headless entrypoint uses `#[tokio::main]` at `packages/presto/server/src/main.rs:27`; the report does not establish the deployed worker count needed for its saturation scenario. “A single crafted POST” causing instance-wide availability loss remains unsupported.
- The literal example filling **both** fields to their encoded caps exceeds the body limit: the caps produce approximately **21.33 MiB + 42.67 MiB**, totaling more than 64 MiB before JSON overhead (`packages/presto/core/src/server/ultra_honk.rs:35`, `packages/presto/core/src/server/ultra_honk.rs:162`). That request is rejected against the 50 MiB limit at `packages/presto/core/src/server/prove.rs:273`. A smaller example remains reachable, so this corrects the proposed input rather than disproving the parsing concern.
- Conversely, the report understates one detail: field-length checks occur **after** parsing and target validation (`packages/presto/core/src/server/ultra_honk.rs:169`, `packages/presto/core/src/server/ultra_honk.rs:175`). They cannot bound allocations before rejection; the enclosing body limit does.

The ordering is also explicitly selected at `implementations-plan/presto-noir/plan.md:100`. That documentation does not prove safety, but synchronous parsing alone does not establish a security-policy bypass. A concrete starvation demonstration would justify revisiting the classification.

### 3. Revisions to my own findings

No findings to withdraw, downgrade, or strengthen; my original report contained none.

I would clarify my resource-control non-finding: body and admission limits establish bounded input and concurrency, **not a guarantee of async-runtime responsiveness**. Synchronous parsing at `packages/presto/core/src/server/ultra_honk.rs:330` remains an unverified availability concern. My overall confidence remains **moderate**.
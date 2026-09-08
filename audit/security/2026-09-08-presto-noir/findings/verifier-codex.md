Verified against `f331a7877a36d4704436023dce204ee92786a319`, offline and read-only. Each independent conclusion was recorded before reading that finding’s full claim. Bun reproductions used unchanged SDK source with mocked fetch; no builds ran.

### F-001 — CONFIRMED

1. **Verdict:** CONFIRMED. Registry-resolved code can alter the pending publish artifact and access the publish job’s privileges.

2. **Independent conclusion vs claim:** Both identify the same exploit: fresh dependency execution occurs between packing and publishing, with access to the writable tarball. The claim’s statement that subsequent checks “all pass” needs qualification: an attacker must preserve the checked identity and metadata. Arbitrary code changes can satisfy those checks.

3. **Strengthened trace:** Range-controlled dependency, e.g. `packages/sdk-core/package.json:24` → range preserved by `scripts/prepare-sdk-publish.ts:60–62` → consumer manifest references the candidate at `scripts/tarball-consumer/host-manifest.ts:28` → fresh installation and execution at `scripts/sdk-tarball-consumer.sh:79,93,96` → writable artifact path exported at `.github/workflows/_publish-npm.yml:158` → substituted bytes published with provenance at `:167`.

   The job grants OIDC and repository-write permissions at `:43–45`; the later fresh install additionally inherits `GH_TOKEN` at `:227,245`. Module execution remains reachable with lifecycle scripts disabled: `packages/sdk-core/src/lib/logger.ts:1` imports the range-resolved logger.

   **Preconditions:** attacker controls a selected dependency release or compiler version; a legitimate release runs; malicious code preserves enough behavior for publication to proceed. Controls include main-branch dispatch enforcement (`release-sdk.yml:53–58`), frozen Bun installation, and version/provenance checks. None isolates the subsequent fresh npm execution.

4. **Fix check:** **The proposed job split is insufficient as written.** Packing, executing consumer dependencies, then uploading the tarball and digest lets malicious code alter both before upload. A same-job checksum is likewise mutable.

   Preserve the candidate in a separate pack job **before fresh consumer execution**; test a copy in an unprivileged job; publish the original artifact selected by immutable identity and digest. Move post-publication consumer installation out of the privileged job. Mirror `_ts-package-ci.yml:30–31,121–159` for consumer permissions and `presto-previews.yml:29–58` for artifact handoff. `--ignore-scripts` already appears in `scripts/verify-sdk-package-signatures.ts:51`, but does not neutralize runtime imports.

   Regression risk: publishing different bytes from those tested, or breaking dependency publication order. Preserve both relationships explicitly.

5. **Final confidence:** **high**. **High (7.0–8.9), unchanged**: upstream compromise must coincide with release, but the consequence is a trusted malicious publication.

### F-002 — CONFIRMED

1. **Verdict:** CONFIRMED under the stated non-default policy.

2. **Independent conclusion vs claim:** Agreement. An offline reproduction using the actual `PrestoClient` sent proof B’s payload to HTTP although that responder’s health body was always invalid; proof A subsequently fell back. This confirms the scheduling mechanism without modifying client internals. Real-browser exploit timing remains untested.

3. **Strengthened trace:** B receives cached HTTPS eligibility through `packages/sdk-core/src/lib/presto-client.ts:128–129,323` → A’s network failure enters retry at `:426,439` → demotion at `:450` clears pin/cache without changing generation in `presto-transport.ts:648–652` → B passes its generation check at `presto-client.ts:333` → its live URL lookup at `:364` selects HTTP through `presto-transport.ts:688–692` → payload reaches `presto-client.ts:401,410` → fetch at `presto-transport.ts:957–967`.

   **Preconditions:** one shared client, previously healthy HTTPS, `httpsOnly:false`, `allowInsecureDowngrade:true`, overlapping proofs, an HTTPS network failure, and the identified microtask interleaving. Confidentiality impact additionally requires an unintended HTTP recipient; a different local account can supply one without invoking excluded same-user malware.

   **Controls:** browser HTTPS defaults (`config.ts:28,32–39`), remembered HTTPS health (`presto-transport.ts:632–634`), and redirect rejection (`:964`) restrict exposure. A’s HTTP health check protects A, not B.

4. **Fix check:** Bind dispatch to **`status.protocol` from the successful check**, using the existing explicit-protocol `urlFor()` pattern (`presto-transport.ts:935–938`). Reading the live transport protocol after the await would retain the race.

   Incrementing the existing generation during demotion requires care: A’s own subsequent comparison at `presto-client.ts:454` would then reject every legitimate downgrade retry. A separate transition generation or explicit retry handling is necessary if that approach is chosen. Protocol binding is the smaller repair.

   Mirror endpoint snapshots and checks at `presto-client.ts:364–385`; add the reproduced interleaving as the focused regression case.

5. **Final confidence:** **high**. **Medium (4.0–6.9), unchanged**: witness disclosure is concrete, but requires explicit downgrade permission and a race.

### F-003 — CONFIRMED

1. **Verdict:** CONFIRMED for repeated download amplification and persistent cache-cap overshoot. Practical disk exhaustion is not established.

2. **Independent conclusion vs claim:** Agreement on both mechanisms. Two corrections: the archive is **download traffic into the user’s machine**, not 64 MiB of its egress; 64 MiB bounds archive content, not total process memory. The quoted GitHub hourly threshold was not verified offline and is unnecessary to establish the failure path.

3. **Strengthened trace:** Authorization and bounded admission at `packages/presto/core/src/server/prove.rs:254–273` → attacker-selected header at `:374–378` → Noir shape/target/encoded-length checks at `server/ultra_honk.rs:168–187,330` → version acquisition at `:333` → cache verification/download at `server/prove.rs:82,311–312` → archive download at `versions/downloader.rs:38` **before** metadata verification at `:44,163` → non-success metadata becomes unavailable at `versions/release_metadata.rs:96–102` → download fails without installation at `downloader.rs:175–178`. Another request repeats the transfer.

   For retention: cached verification hashes the binary and refreshes activity (`cache_layout.rs:220,239–249,271–274`) → cleanup skips recently active entries (`version_policy.rs:414–416`) → the deferred pass ignores another deferral (`:475–477`). Cache hits schedule no cleanup (`server/prove.rs:388–390`).

   **Minimal inputs:** an approved origin, a selectable real non-bundled release, and JSON such as `{"bytecode":"!","witness":"!","verifier_target":"noir-recursive"}`. It passes preliminary checks but fails base64 decoding only afterward (`ultra_honk.rs:196–199,338`). Repeated full transfers additionally require metadata failure or repeated misses. Persistent overshoot requires enough real assets and activity refresh through the outstanding cleanup passes.

   **Controls:** eight global admissions, four per Noir origin, body deadlines, 64 MiB archive cap, strict version syntax, fail-closed digest verification, leases, and startup cleanup. These prevent several stronger claims but do not bound cumulative churn.

4. **Fix check:** Digest-first fetching is the smallest useful amplification fix. Count **every attempted cache miss**, including failures and repeated versions, against download budgets; serialize/coalesce duplicate downloads.

   Re-arming cleanup restores eventual reclamation after activity stops, but does not enforce a hard ceiling during sustained refresh. A hard ceiling needs capacity admission before installing additional versions. Preserve the eviction reservation at `version_policy.rs:418–430` and lease acquisition at `server/prove.rs:322,430–437`.

   Moving decoding before acquisition must retain bounded worker concurrency: current decoding runs under the prover permit (`ultra_honk.rs:247–248,333–338`). Simply moving activity updates can reopen the download-to-lease protection gap.

5. **Final confidence:** **high** on mechanisms. **Medium (4.0–6.9), unchanged**: authorized resource abuse affects availability; real disk-fill magnitude remains unmeasured.

### F-004 — CONFIRMED

1. **Verdict:** CONFIRMED as a missing artifact binding, with a conditional exploitation path.

2. **Independent conclusion vs claim:** Agreement that artifact A can pass verification while artifact B is consumed. The stronger attacker requirement is essential: ordinary corrupted downloads fail integrity checks. Registry equivocation, or TLS interception capable of changing both metadata and bytes, is needed. Ordinary package-maintainer access does not establish that capability.

3. **Strengthened trace:** Provenance metadata and digest comparison at `scripts/sdk-release-verification.ts:113–134` → digest discarded from the returned result at `:97–102` → separate signature-audited installation at `scripts/verify-sdk-package-signatures.ts:51–63`, then deleted at `:66` → fresh pack at `scripts/published-playground.ts:107` → comparison only against newly fetched registry integrity at `:111` → tarball returned at `:118` and passed to the swap script at `:153–161` → extraction at `.github/scripts/packaged-e2e-swap-sdk.sh:71,85,134` → build and deployment at `.github/workflows/release-sdk.yml:232,238`.

   **Preconditions:** a deployment runs; the delivery authority supplies legitimate verification responses followed by altered tarball bytes and matching integrity metadata; altered packages preserve checked identities, dependencies, and build compatibility.

   **Controls:** signature audit, SHA-512 integrity, package identity checks (`npm-pack-result.ts:26–34`), dependency checks, and peer checks. None binds all stages to one authenticated digest.

4. **Fix check:** Locally hashing the consumed tarball is necessary, but **returning a digest from `fetchAndVerifySdkProvenance` alone is insufficient**: that function parses an attestation; cryptographic verification happens separately. Carry the digest associated with the cryptographically verified installation/attestation, apply repository/workflow checks to that same statement, and compare the final file before extraction.

   Mirror local hashing in `scripts/install-legacy-sdk.ts:57–61` and installation-to-archive integrity binding in `scripts/tarball-consumer/assert-local-dependency.ts:20–21,38–40`.

   Running `npm audit signatures` merely in an `npm pack` directory does not establish the proposed relationship; it needs an audited installation/lockfile linked to those bytes. Regression risk centers on preserving that relationship across npm output formats.

5. **Final confidence:** **moderate** overall; high on the missing binding. **Low (0.1–3.9), retained as a conditional hardening finding** because the requisite delivery-authority compromise is substantially stronger than the ordinary attacker. Successful substitution could nevertheless have serious consequences.

### F-005 — PARTIAL

1. **Verdict:** PARTIAL — reentrancy defect confirmed; security vulnerability unsupported under the accepted trust model.

2. **Independent conclusion vs claim:** Both identify caller-controlled iteration after the final check. The offline reproduction enabled `httpsOnly:true` inside a typed array’s iterator and still observed HTTP dispatch. The same configuration change inside `body()` correctly caused fallback.

   The claim explicitly concedes that “no external attacker gains anything.” That supports removing its security severity, rather than retaining Low solely because a defensive invariant is violated.

3. **Strengthened trace:** Caller supplies executable serializer through `packages/sdk-core/src/lib/types.ts:190` → serializer returns payload at `presto-client.ts:377` → generation check passes at `:385` → `Uint8Array.from(payload)` invokes its iterator at `:396` → iterator calls `configure`, updating policy and generation (`presto-transport.ts:582,591`) → dispatch still uses the earlier URL (`presto-client.ts:364,401`) → fetch at `presto-transport.ts:957–967`.

   **Preconditions:** direct core-client use, previously permitted HTTP, and a caller-created iterator that reconfigures the same client. No untrusted wire-data path creates this executable hook. Shipped adapters normalize payloads at `packages/sdk/src/lib/presto-prover.ts:166` and `packages/sdk-noir/src/lib/presto-ultra-honk-backend.ts:210`.

4. **Fix check:** Move payload copying before the existing final generation check. This mirrors the established treatment of `body()` and phase callbacks at `presto-client.ts:376–385`. A second identical check is unnecessary if no caller execution intervenes.

   Regression risk is small: preserve one serializer invocation and existing fallback behavior. This repair is independent of F-002’s protocol snapshot.

5. **Final confidence:** **high** on the defect and scope assessment. **No security band / 0.0 under this model**, moved from Low; retain as a correctness regression.

## Verifier summary

| ID | Verdict | Final confidence | Band |
|---|---|---|---|
| F-001 | CONFIRMED | high | High |
| F-002 | CONFIRMED | high | Medium |
| F-003 | CONFIRMED | high | Medium |
| F-004 | CONFIRMED, conditional | moderate | Low, conditional |
| F-005 | PARTIAL: mechanism only | high | None / 0.0 |
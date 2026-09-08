# Consolidated findings — 2026-09-08-presto-noir (security)

Scope: the presto-noir surface (PRs #21–#25) at `main` @ f331a78, six clusters, twelve raw reports
(Claude Sonnet + Codex GPT-6 Astra per cluster, each with a cross-rebuttal). Every claim a decision
below depends on was re-read in source by the coordinator; line numbers are from f331a78.

## Summary table

| ID | Band | Confidence | Found by | Cluster(s) | Title |
|---|---|---|---|---|---|
| F-001 | High | high | both | release-supply-chain | Registry-resolved code runs inside the OIDC publish job and can rewrite the artifact published minutes later |
| F-002 | Medium | high (mechanism) / moderate (timing) | codex → claude verified | core-transport | Concurrent `prove()` calls share the protocol pin: a witness can POST to the never-validated HTTP port |
| F-003 | Medium | high (mechanism) / moderate (impact) | both (merged) | bb-child-and-versions, route-ingress | `x-aztec-version` drives unbounded download churn and defeats the cache size cap before the payload is validated |
| F-004 | Low | high (gap) / low (exploitability) | codex — cross-model disagreement | release-supply-chain | Playground deploy consumes a tarball that is not bound to the provenance it verified |
| F-005 | Low | high (mechanism) / low (significance) | codex → claude verified | core-transport | Caller-supplied payload iterator runs after the last policy check before dispatch |

## Findings

### [High] F-001: Registry-resolved code runs inside the OIDC publish job and can rewrite the artifact published minutes later

**Impact:** High — a live upstream compromise of any range-resolved dependency (e.g. `@logtape/logtape@^2.3.2`) during a routine release yields a forged publish of `@alejoamiras/presto{,-core,-noir}` that carries *valid* SLSA provenance, because the legitimate `npm publish` step signs whatever bytes sit at `$TARBALL`. Attack requirement (an upstream compromise coinciding with a release) keeps it below Critical.  **Confidence:** high  **Mapping:** OWASP A08:2021 Software and Data Integrity Failures; CWE-829 (Inclusion of Functionality from Untrusted Control Sphere), CWE-269 (Improper Privilege Management)  **Found by:** both (converged after rebuttal; Codex's artifact-substitution variant adopted by Claude as the primary path)

**Instances:**
- `.github/workflows/_publish-npm.yml:43-45` — `publish` job holds `id-token: write` + `contents: write` for every step
- `.github/workflows/_publish-npm.yml:52-54` — checkout with default credential persistence
- `.github/workflows/_publish-npm.yml:158` → `:167` — `TARBALL` path exported to the job env, then published as-is
- `.github/workflows/_publish-npm.yml:161-162` — consumer test runs inside the privileged job
- `.github/workflows/_publish-npm.yml:227` + `:245` — fresh unscoped `npm install` with `GH_TOKEN` in env
- `scripts/sdk-tarball-consumer.sh:79`, `:111` — unscoped `npm install` (lifecycle scripts enabled)
- `scripts/sdk-tarball-consumer.sh:93` — `npx --yes --package=typescript@5.9` (registry fetch + execute)
- `scripts/sdk-tarball-consumer.sh:96` — `node runtime-check.mjs` imports the freshly installed graph (runs module-level code even with `--ignore-scripts`)
- Grants re-declared by callers: `.github/workflows/release-sdk.yml:144`, `:173`, `:186`
- Not an instance: `_ts-package-ci.yml`'s `tarball-consumer` job runs the same script under `contents: read` only.

**Description:** The publish job packs the candidate, exports its absolute path (`TARBALL`), runs a consumer test that performs a fresh, range-based `npm install` against the live registry with scripts enabled, then publishes the file at `$TARBALL`. Every process spawned by that install — a `postinstall` hook, the `npx`-fetched compiler, or the module graph loaded by `runtime-check.mjs` — inherits the job environment, including `TARBALL`, `ACTIONS_ID_TOKEN_REQUEST_*`, and (in the final step) `GH_TOKEN`.

**Trace:** range dependency in the packed manifest (`scripts/prepare-sdk-publish.ts:60` preserves ranges) → `scripts/tarball-consumer/host-manifest.ts:28` builds the host → `scripts/sdk-tarball-consumer.sh:79` `npm install` (scripts on) → hook overwrites `$TARBALL` (`_publish-npm.yml:158`) or mints an OIDC token → `_publish-npm.yml:167` `npm publish "$TARBALL" --provenance` signs the substituted bytes. Every downstream check (`:169-190`, `:245`) verifies the *published* artifact, so all pass.

**Why it matters:** This inverts the pipeline's strongest guarantee. Consumers who verify provenance (including this repo's own `sdk-release-verification.ts`) would accept the forged package. `bun.lock` and the 7-day `minimumReleaseAge` (`bunfig.toml`) govern the earlier Bun install, not these npm resolutions; `verify-sdk-package-signatures.ts:51` already uses `--ignore-scripts`, showing the risk class is known but applied to one of four installs.

**Recommended fix:** Split `_publish-npm.yml` into (a) a `build-and-test` job with `contents: read`, no `id-token`, that packs, runs `sdk-tarball-consumer.sh`, and uploads the tarball plus its `sha256sum` as an artifact, and (b) a `publish` job that downloads the artifact, re-hashes it against the recorded digest, and only then runs `npm publish`. Interim, same-day mitigations: record `sha256sum "$TARBALL"` at `:158` and assert it immediately before `:167`; add `--ignore-scripts` to `:79`, `:111`, `:245`; pin `typescript` exactly at `:93`; move the `:245` fresh-install verification to a follow-on job without `id-token`. The `_ts-package-ci.yml` job already demonstrates the unprivileged shape.

**Effort estimate:** hours (interim digest check + flags); ~1 day (job split)

---

### [Medium] F-002: Concurrent `prove()` calls share the protocol pin: a witness can POST to the never-validated HTTP port

**Impact:** Medium — confidentiality of one private witness, disclosed to a loopback listener that *never* answered the health contract; requires the non-default `{httpsOnly:false, allowInsecureDowngrade:true}` policy, overlapping proofs on one client, an HTTPS network failure, and a scheduling window.  **Confidence:** high on mechanism (Codex reproduced with in-memory Fetch mocks; Claude re-traced line by line), moderate on real-browser timing  **Mapping:** OWASP A04:2021 Insecure Design; CWE-362 (Race Condition), CWE-200  **Found by:** codex; Claude verified in rebuttal and withdrew its "reduces to the accepted discovery boundary" position

**Instances:**
- `packages/sdk-core/src/lib/presto-client.ts:450` → `packages/sdk-core/src/lib/presto-transport.ts:648-653` — `demoteHttpsPin()` clears `#protocol`/`#statusCache` without bumping `#generation`
- `packages/sdk-core/src/lib/presto-client.ts:323` (eligibility from cached status) → `:333` (generation check passes) → `:364` (`baseUrl` read live) → `:401`/`presto-transport.ts:958` (POST)
- `packages/sdk-core/src/lib/presto-transport.ts:688-693` — `baseUrl` is computed from the *current* pin, not the status that authorized the attempt
- Reachable from both adapters: `packages/sdk/src/lib/presto-prover.ts:162`, `packages/sdk-noir/src/lib/presto-ultra-honk-backend.ts:126` (nothing serializes overlapping calls)

**Description:** Proof B obtains the cached healthy-HTTPS status at `:323` and yields. Proof A's HTTPS POST fails at the network layer, enters `#retryOverHttp`, calls `demoteHttpsPin()` at `:450`, then awaits `isProtocolHealthy("http")` at `:453`. B resumes: its `detectGen` still matches (`:333`), but `baseUrl` (`:364`) now yields `http://…` because the pin is cleared and the effective policy permits HTTP. B posts the witness to the HTTP port with no health check at all; A's check later fails and A falls back — after B's disclosure.

**Trace:** cached HTTPS status (`presto-client.ts:128`, `:323`) → concurrent `demoteHttpsPin()` (`:450`, `presto-transport.ts:648`) → live `baseUrl` (`presto-client.ts:364`, `presto-transport.ts:692`) → `transport.post` (`presto-transport.ts:958`).

**Why it matters:** The accepted boundary is "discovery is shape-matched, not authenticated" (`packages/sdk/README.md`). This path is strictly worse: the receiving listener need not even answer the shape. The code's own downgrade comment (`presto-transport.ts:628-634`) names the attacker — "any local account that binds 127.0.0.1:59833" — and `#retryOverHttp` re-validates HTTP precisely for that reason; B bypasses that re-validation entirely.

**Recommended fix:** Bind the attempt to the protocol that passed its check: capture `transport.protocol` (or derive it from `status`) alongside `detectGen` in `prove()`, build `url` from that snapshot rather than the live `baseUrl`, and have `demoteHttpsPin()` increment a policy generation that the `:385` check compares (the existing `generation` + `Snapshot` pattern in `prove()` is the template). Also fixes F-005's dispatch half.

**Effort estimate:** hours

---

### [Medium] F-003: `x-aztec-version` drives unbounded download churn and defeats the cache size cap before the payload is validated

**Impact:** Medium — availability of the user's machine and network: each request for an uncached real Aztec version costs up to 64 MiB egress and 64 MiB RAM (`downloader.rs:131`), repeatable indefinitely; cache residency can be held above the 2 GiB cap until restart. One approval (or headless auto-approved localhost) suffices; no further interaction.  **Confidence:** high on both mechanisms (re-read in source), moderate on practical disk-fill (per-version size and release inventory not measured)  **Mapping:** OWASP API4:2023 Unrestricted Resource Consumption; CWE-400, CWE-770  **Found by:** both — Claude's download-churn F-1, Codex's cache-cleanup-bypass F-1, and Codex's rebuttal "failed-download amplification" merged (same root cause, same sink)

**Instances:**
- `packages/presto/core/src/server/prove.rs:374-379` (header) → `:82` (`verify_cached_bb` on every resolve) → `:312` (`download_if_needed` before the permit)
- `packages/presto/core/src/server/ultra_honk.rs:333` precedes `:338` — download and activity refresh happen before `decode_and_check`; a request with garbage `bytecode`/`witness` still pays/refreshes
- `packages/presto/core/src/versions/downloader.rs:38` → `:44` — full tarball fetched *before* `verify_digest`; a digest failure discards it and caches nothing
- `packages/presto/core/src/versions/release_metadata.rs:83-101` — unauthenticated GitHub API; non-2xx (rate limit) → `Ok(None)` → `verify_digest` errors
- `packages/presto/core/src/versions/cache_layout.rs:249`, `:271-275` — `mark_in_use` rewrites `.last-used` on every resolve
- `packages/presto/core/src/versions/version_policy.rs:414` (recently-active exemption), `:458-478` (single non-looping retry; `:477` discards the deferral result)
- `packages/presto/core/src/server/prove.rs:388-404` — cleanup only spawns after a download; cache hits never schedule one

**Description:** Two sub-mechanisms, one root cause (version selection has side effects that run before the request proves it is a real job, and the caps bound concurrency and residency, not churn):
1. *Churn/amplification.* An approved origin cycles `x-aztec-version` through real historical releases; each triggers a full CDN download. After ~60 API calls/hour the digest lookup fails, so **every** further request for **any single** uncached version downloads the full tarball and throws it away — sustainable with one version string, no eviction needed.
2. *Cap bypass.* Fill the cache during one 5-minute window (four concurrent per origin), then keep sending invalid requests against the cached versions less than five minutes apart. Every request refreshes `.last-used`; the deferred cleanup at `version_policy.rs:387-390` runs once, sees everything active, and does not re-arm. Stop after it fires: the excess persists until the next download or restart. The comment at `:384-390` claims the retry "finish[es] the job"; it does not under continued refresh.

**Trace:** `x-aztec-version` → `resolve_version` (`prove.rs:51-91`) → `verify_cached_bb`/`mark_in_use` (`cache_layout.rs:232-252`) or `download_bb` (`downloader.rs:21-60`) → disk/network → cleanup exemption (`version_policy.rs:414`, `:477`).

**Why it matters:** Codex corrected Claude's assumption that GitHub's API limit is a backstop: it is the *trigger* for the cheapest variant. `MAX_INFLIGHT_PROVE`/`MAX_ULTRA_HONK_PER_ORIGIN` bound concurrency; nothing bounds sequential downloads per origin or per hour. Not re-reported: the no-Origin/`--allow-all` exemption from the per-origin cap (documented, `implementations-plan/presto-noir/plan.md:100`).

**Recommended fix:** (1) Fetch the digest *before* the tarball in `download_bb` and fail fast — a missing digest then costs one small API call, not 64 MiB. (2) Add a download cooldown: one uncached download in flight globally plus a per-origin token bucket (e.g. 3 new versions per 10 min), returning the existing `503`/`transient` the client already classifies (`presto-client.ts:541-550`). (3) Make `cleanup_after_active_window` re-arm while `deferred_by_active_window` remains true (bounded backoff), or refresh `.last-used` only once the job reaches `run_ultra_honk`. (4) For `/prove/ultra-honk`, consider running `decode_and_check` before `acquire_prover` so a malformed payload never triggers a download; the ordering was chosen deliberately (`plan.md:135`), so treat this as optional.

**Effort estimate:** hours (1, 3); ~1 day (2)

---

### [Low] F-004: Playground deploy consumes a tarball that is not bound to the provenance it verified

**Impact:** Low — integrity of the deployed `playground.presto.build` bundle (a curated verified site in Presto's registry). Exploitation requires the npm registry (or a TLS MITM) to serve inconsistent responses for one immutable version within a single job — a stronger attacker than the rest of this audit assumes.  **Confidence:** high that the binding is missing; low that the precondition is realistic  **Mapping:** OWASP A08:2021; CWE-345 (Insufficient Verification of Data Authenticity)  **Found by:** codex — **cross-model disagreement**: Claude verified the code gap but disputed the precondition's realism; kept because the defect defeats the exact guarantee the code exists to provide and the fix is trivial

**Instances:**
- `scripts/published-playground.ts:103` (provenance), `:104` (signatures, in a separate temp install), `:107` (a *third* download via `npm pack`), `:111` (compared only to a fresh `npm view dist.integrity`)
- `scripts/sdk-release-verification.ts:113-118` — subject digest compared against `npm view dist.integrity` (a registry response), never a local file; `VerifiedProvenance` (`:37-42`) returns no digest
- `scripts/verify-sdk-package-signatures.ts:39-42` — returns `void`; verifies a copy that is discarded
- Sinks: `.github/scripts/packaged-e2e-swap-sdk.sh:71`, `:85`, `:134` (extract into `node_modules`); `.github/workflows/release-sdk.yml:232`, `:238` (build + deploy); affected calls `published-playground.ts:127`, `:140`, `:152`

**Description:** Three separate registry conversations — attestation fetch, `npm audit signatures` in a temp dir, and `npm pack` — are each internally consistent but never bound to one another. Artifact A can be verified and artifact B deployed.

**Trace:** `fetchAndVerifySdkProvenance` (`:103`) → `verifySdkPackageSignatures` (`:104`) → `npm pack` (`:107`) → `dist.integrity` self-comparison (`:111`) → swap script → `wrangler deploy`.

**Why it matters:** A verified site's JS runs with the user's standing approval in Presto; a substituted bundle can submit arbitrary jobs to the user's loopback prover. The same missing-digest-binding pattern is what makes F-001 exploitable (cross-cutting observation 1).

**Recommended fix:** Return the verified sha512 from `fetchAndVerifySdkProvenance`, hash the packed file locally (`Bun.CryptoHasher("sha512")` over `tarball` bytes) and compare before the swap; or run `npm audit signatures --include-attestations` in the directory the tarball was packed into and assert the audited integrity equals the local file hash.

**Effort estimate:** hours

---

### [Low] F-005: Caller-supplied payload iterator runs after the last policy check before dispatch

**Impact:** Low — a `configure({httpsOnly:true})` executed from inside the payload's own `[Symbol.iterator]` during `Uint8Array.from` is not honoured; the witness goes to the HTTP URL captured earlier. Requires direct `PrestoClient` use with an exotic iterable `body()`; neither shipped adapter constructs one (`presto-prover.ts:166`, `presto-ultra-honk-backend.ts:210`), so the only persona is a caller subverting its own client.  **Confidence:** high on mechanism (both models confirmed `Uint8Array.from` invokes an own iterator); low on security significance  **Mapping:** CWE-367 (TOCTOU), CWE-863  **Found by:** codex; Claude verified empirically and agreed on the narrow persona

**Instances:**
- `packages/sdk-core/src/lib/presto-client.ts:385` (last generation check) → `:396` (`Uint8Array.from(payload)` re-enters caller code) → `:401` / `presto-transport.ts:958` (dispatch to `url` captured at `:364`)

**Description:** `prove()` freezes the request and re-checks `generation` after `body()` (`:377`) precisely to honour mid-flight reconfiguration, but the conversion at `:396` runs caller code after that check.

**Trace:** `ProveRequest.body` (`types.ts:190`) → `:377` → check `:385` → iterator runs `configure()` (`presto-transport.ts:582`, `:591`) → `:401` posts to the stale URL.

**Why it matters:** Only as a gap in a defense the code explicitly claims; no external attacker gains anything.

**Recommended fix:** Move `Uint8Array.from(payload)` above the `:385` check, and add a final `generation`/protocol-eligibility check immediately before `#post` (shared with F-002).

**Effort estimate:** hours (< 1)

---

## Findings NOT pursued (with reasoning)

- **route-ingress / Claude F-1 — `parse_request` runs synchronously on the tokio runtime (`ultra_honk.rs:330`, `:168-188`).** Cross-model disagreement resolved in Codex's favour. Concrete trace, but: the ordering is deliberate and documented (`ultra_honk.rs:166-167`); the cost is one bounded scan/copy of a ≤ 50 MiB body (tens of ms); no starvation was demonstrated; and an approved origin already commands the whole machine through legitimate proving (bb saturates all cores for up to 300 s). Marginal harm over accepted capability ≈ 0. Hardening note: wrap the parse in `on_worker` for consistency.
- **bb-child / Claude F-2 — no minimum-safe bb version floor (`version_policy.rs:295-315`).** No vulnerable build, defect, or input identified; the trade-off is documented at `:238-249`. Speculative.
- **bb-child / Codex F-2 — FIFO `proof.json` blocks the global permit (`bb.rs:487`).** Malicious-bb-only; post-exit path, so it does not touch the `terminate_and_confirm`/quiesce promise. Cheap hardening if wanted: `symlink_metadata().is_file()` before `File::open` in `read_capped`.
- **bb-child / Codex F-3 — Windows ordinary exit leaves Job members running (`bb.rs:929-931`).** Malicious-bb-only; descendants remain inside the Job Object, so the update-path `terminate_and_confirm` still reaches them — the promise relied on elsewhere holds.
- **bb-child / Codex F-4, F-5 — Unix `setsid()` escape (`bb.rs:627`, `:723-731`); Windows spawn-before-assign window (`bb.rs:894` → `:906`).** These do falsify "confirmed dead" for an adversarial child. Not pursued because only a malicious bb — already running as the user, able to persist by any means — can exercise them, and the update-path consequence (an escaped process outliving the install) grants nothing beyond that compromise. Defense-in-depth options: `CREATE_SUSPENDED` + assign + resume on Windows; `PR_SET_CHILD_SUBREAPER`/cgroup on Linux.
- **core-transport / Claude non-findings — `#retryOverHttp` check-then-post window (`:453` → `:470`), `HTTPS_GRACE_MS` pin race.** Both models agree these reduce to the accepted shape-matched discovery boundary and are distinct from F-002.
- **core-transport / Codex non-finding — unconsumed bodies on early returns (`presto-transport.ts:804`, `:926`).** No exhaustion demonstrated.
- **core-transport — `readUnstreamedText` buffers before the cap (`:365-378`).** Unreachable in the supported runtime matrix.
- **route-ingress — no-Origin and `--allow-all` callers exempt from the per-origin UltraHonk cap (`prove.rs:257-260`, `auth.rs:80-84`).** Documented, accepted (`plan.md:100`).
- **route-ingress — admission-guard release before bb reap (`bb.rs:359`).** Fixed in PR #28; excluded per brief.
- **noir-adapter (both models, zero findings).** Server-key cache poisoning is contained (`getVerificationKey`/`verifyProof` never read `#serverKeys`, `presto-ultra-honk-backend.ts:147-156`); bb.js peer version not asserted at runtime (`:267-282`) does not widen trust; `PrestoHttpError.serverMessage` has no unsafe sink in scope (playground renders via `textContent`).
- **playground-noir (both models, zero findings).** No CSP/`frame-ancestors` (`public/_headers:1`): no injection sink exists; clickjacking `#http-session-confirm` affects only the Aztec prover and needs HTTPS to already be failing. `noirStub` is DEV-gated and asserted dead in the production smoke.
- **release — direct `${{ }}` interpolations (`_publish-npm.yml:92`, `_ts-package-ci.yml:90`, `:245`).** Verified: values derive from the allowlisted `NPM_PACKAGES` descriptor or a numeric pid; not attacker-controlled.
- **release — provenance `workflow.path` claim for a job inside a called reusable workflow vs `SDK_RELEASE_WORKFLOW`.** Unverifiable from repository contents; logged as an open question, not a finding.

## Cross-cutting observations

1. **Privileged CI steps trust artifacts across an untrusted execution boundary without a digest.** F-001 (the publish job executes registry code, then publishes `$TARBALL`) and F-004 (the deploy job verifies one download and ships another) share one pattern: verification results are never carried forward as a hash bound to the bytes actually consumed. The fix is the same in both places — compute a local digest at the trust boundary and assert it at the sink.
2. **Mutable shared client state consulted after a check.** `PrestoClient` snapshots the *request* and re-checks `generation`, but the *destination* is read live from `PrestoTransport` (`baseUrl`, `#protocol`) which any concurrent attempt can mutate (F-002), and caller code can run after the last check (F-005). Eligibility and destination should be one immutable snapshot per attempt, and every shared-state mutation (`demoteHttpsPin`, `setProtocol`) should bump a generation.
3. **Resource caps bound concurrency and residency, not churn.** `MAX_INFLIGHT_PROVE`, `MAX_ULTRA_HONK_PER_ORIGIN`, and `CACHE_MAX_TOTAL_BYTES` all limit a snapshot in time; nothing limits rate over time (downloads/hour, refreshes/window). F-003 is the instance; the route-ingress parse note is the same shape at lower magnitude.
4. **Side effects before validation.** Version resolution (download, `mark_in_use`) precedes payload decoding on both prove routes; the cheapest requests (malformed bodies) still pay the most expensive side effects.
5. **Containment is best-effort against an adversarial child.** Process-group/Job-Object containment is sound for the in-model (authentic) bb; the four malicious-bb items are a reminder that `terminate_and_confirm`'s "confirmed" is a statement about the original group/job, not about every descendant.
6. **The revocation denylist is the only version-safety control and is an empty compile-time constant** (`version_policy.rs:249`). Not a finding today; it is a reactive control that requires a Presto release to activate.

## Coordinator notes

- **Verified in source:** `ultra_honk.rs:322-372` (handler ordering, `on_worker` at `:286-304`, deliberate-ordering comment `:166-167`); `prove.rs:51-106`, `:305-340`, `:374-412` (resolve/download/lease/permit order, cleanup only after download); `cache_layout.rs:232-275` (`mark_in_use` on every resolve); `version_policy.rs:370-420`, `:455-478` (exemption; single non-looping retry); `downloader.rs:20-60`, `:118-182` and `release_metadata.rs:50-125` (tarball before digest; API failure → `Ok(None)` → error); `presto-client.ts:120-135`, `:300-480` and `presto-transport.ts:574-700`, `:950-972` (F-002/F-005 line-level trace, `demoteHttpsPin` leaves `#generation` untouched, `baseUrl` live); `_publish-npm.yml:38-58`, `:150-170`, `:222-251`; `sdk-tarball-consumer.sh:70-121`; `verify-sdk-package-signatures.ts:40-60`; `published-playground.ts:95-115`; `sdk-release-verification.ts:35-136`; `bb.rs:700-740` and the `terminate_and_confirm` call graph; `config.rs:113-139` / `server/src/main.rs:94` (desktop does not auto-approve localhost; headless does — Codex's correction to Claude's bb-child F-1 precondition adopted).
- **Deduplication:** bb-child Claude F-1 + Codex F-1 + Codex's rebuttal addendum → F-003 (one root cause: version side effects before validation, caps without rate). Release Claude F-1 + Codex F-1 → F-001 (Codex's `$TARBALL` substitution adopted as primary path; Claude's OIDC/`GH_TOKEN` exposure kept as secondary). Core F-002 and F-005 kept separate: same sink and boundary but different root causes (shared-state race vs post-check re-entrancy) and different personas.
- **Disagreements resolved:** route-ingress F-1 → not pursued (Codex's SPECULATIVE disposition upheld on the marginal-harm argument, plus the documented ordering). bb-child Claude F-2 → not pursued (Codex's disposition upheld; no concrete build). Core-transport: Claude's "reduces to accepted boundary" withdrawn by Claude itself; Codex F-1 upheld as a new boundary. Release F-004: kept at Low despite Claude's realism objection, because the guarantee it defeats is the code's stated purpose. The four malicious-bb items were tested against the brief's carve-out ("breaks a code-level promise relied on elsewhere"): F-4/F-5 technically do, but the consequence is confined to an actor who already has full user-level execution; not pursued.
- **Density:** 5 findings / 6 clusters = 0.83, below the ~1.2 target. Two clusters (noir-adapter, playground-noir) converged on zero with both models after rebuttal — that convergence is the evidence, and manufacturing findings there would be worse than a low count. The remaining four clusters carry 1.25 findings each.
- **Deviation:** none. Nothing outside `findings/consolidated.md` was written.

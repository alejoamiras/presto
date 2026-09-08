# Harden Report: security
**Repo:** alejoamiras/presto — the presto-noir surface (PRs #21–#25)
**Date:** 2026-09-08
**Effort:** high
**Run ID:** 2026-09-08-presto-noir
**Models:** Phase 1 map — Claude Sonnet ×4 (hierarchical, one per package area; the workspace inventory by the driver); Phase 2 — Claude Sonnet + Codex GPT-6 Astra (`xhigh`) per cluster; Phase 2.5 — same agents cross-rebutting; Phase 3 — Claude Fable 5.1 coordinator; Phase 4 — Claude Sonnet + Codex GPT-6 Astra (`xhigh`) verifiers; Phase 5 — the driver (Fable 5.1)
**Scope:** `main` @ f331a78, chosen by the owner: `packages/sdk-core`, `packages/sdk-noir`, the `POST /prove/ultra-honk` route and its shared admission/containment/version code in `packages/presto/core` (+ headless `packages/presto/server`), the playground's Noir panel, the npm release path and CI gates for the three packages, and `fixtures/noir`. Excluded: the rest of the desktop app (trust module, updater, tray, onboarding), landing, banners, release-feed, `node_modules`/`dist`/`target`/generated code, and test-only code.

## Executive summary

The presto-noir work adds a second proving route to the local Presto app, a shared transport package, a bb.js drop-in adapter, a playground panel, and a three-package npm release path. Six clusters were audited by two model families independently, then each side challenged the other's report, a coordinator deduplicated and banded the result, and two fresh verifiers re-derived every finding from source. Two clusters — the Noir adapter and the playground panel — converged on zero findings across all four passes; the request path from a browser origin into the native prover held up against forged hosts, missing origins, revoked approvals, gzip bombs, and malformed keys.

Five findings survived. The one **High** is in the release pipeline, not the product: the job that publishes `@alejoamiras/presto`, `presto-core`, and `presto-noir` with OIDC provenance runs a fresh registry `npm install` (lifecycle scripts enabled, semver ranges) *before* publishing the tarball whose path it has already exported. A compromised upstream dependency coinciding with a release could replace the artifact and ship it with valid provenance. Two **Medium** findings: in the shared client, two overlapping proofs can share a protocol pin so that one witness is POSTed to the HTTP port that was never health-checked (non-default downgrade policy required); and in the app, the `x-aztec-version` header drives bb downloads and cache-activity refreshes before the request proves it is a real job, so an approved origin can force unbounded download churn and hold the cache above its size cap. Two **Low** items: the playground deployment does not bind the tarball it deploys to the provenance it verified, and a caller-supplied payload iterator can run after the client's last policy check (informational).

Recommended order: land F-001's interim mitigations today (`--ignore-scripts`, exact `typescript` pin, digest recorded at pack time and asserted before publish) and the job split this week; fix F-002 and F-005 together in `presto-core` (one attempt = one immutable eligibility+destination snapshot) before promoting the packages to `latest`; F-003 next (digest-first download, a download budget); F-004 alongside F-001 since it is the same missing-digest pattern.

## Methodology

Map-reduce: Phase 1 hierarchical repo map (workspace inventory + four package maps in `raw/repo-map/`); Phase 2 clusters chosen by entrypoint and sink family — `route-ingress`, `bb-child-and-versions`, `core-transport`, `noir-adapter`, `playground-noir`, `release-supply-chain` — two agents per cluster (Claude Sonnet, Codex `xhigh`, read-only sandboxes) with the security prompt, the negative list, and repo-map summaries as dependency context; inter-procedural cap ~4 functions with handoff-edge escalation (HTTP request → handler, workflow `uses:` → reusable workflow, adapter → core client). Phase 2.5 light cross-rebuttal (each agent read the other's report and appended a `## Cross-rebuttal` section). Phase 3 coordinator (Fable 5.1) deduplicated by root cause + sink + boundary, resolved disagreements with source evidence, dropped speculative items, assigned CVSS v4.0 bands. Phase 4 verifiers (Claude Sonnet, Codex `xhigh`) covered all five findings by severity bucket with a mandatory anti-anchoring step. Trust model applied: shape-matched loopback discovery (documented), same-user malware out of scope, client-supplied key spoils only its own proof, a malicious bb release is outside the in-model attacker set, PR #28 (guard release after reap) excluded as already fixed.

Deviations from the formal spec: the workspace-level (outer) map was written by the driver from the plan's own inventory rather than by a separate mapper; Phase 4 ran one Claude verifier and one Codex verifier over all five findings rather than a fresh pair per finding (five findings, all covered). Density: 0.83 findings per cluster (target ~1.2) — two clusters converged on zero with both models after rebuttal.

## Findings

### [High] F-001: Registry-resolved code runs inside the OIDC publish job and can rewrite the artifact published minutes later
**Impact:** High — a forged publish of any of the three packages carrying valid SLSA provenance; requires an upstream dependency compromise coinciding with a release (keeps it below Critical).
**Confidence:** high (both verifiers)
**Mapping:** OWASP A08:2021 Software and Data Integrity Failures; CWE-829, CWE-269
**Found by:** both (converged after rebuttal)

**Instances** (all locations sharing this root cause):
- `.github/workflows/_publish-npm.yml:43-45` — `publish` job holds `id-token: write` + `contents: write` for every step
- `.github/workflows/_publish-npm.yml:52-54` — checkout with credential persistence
- `.github/workflows/_publish-npm.yml:158` → `:167` — `TARBALL` exported to the job env, then published as-is
- `.github/workflows/_publish-npm.yml:161-162` — consumer test runs inside the privileged job
- `.github/workflows/_publish-npm.yml:227`, `:245` — fresh unscoped `npm install` with `GH_TOKEN` in env
- `scripts/sdk-tarball-consumer.sh:79`, `:111` — unscoped `npm install` (lifecycle scripts enabled); `:93` — `npx --yes --package=typescript@5.9`; `:96` — `runtime-check.mjs` imports the freshly installed graph
- Grants re-declared by callers: `.github/workflows/release-sdk.yml:144`, `:173`, `:186`
- Not an instance: `_ts-package-ci.yml`'s `tarball-consumer` job runs the same script under `contents: read`

**Description**: The publish job packs the candidate, exports its path, runs a consumer test that performs a fresh, range-based `npm install` against the live registry with scripts enabled (and an `npx`-fetched compiler, and a runtime import of the installed graph), then publishes the file at `$TARBALL`. Every process spawned by that install inherits the job environment: the tarball path, the OIDC token request variables, and in the final step `GH_TOKEN`.

**Trace**: range dependency kept by `scripts/prepare-sdk-publish.ts:60` → `scripts/tarball-consumer/host-manifest.ts:28` → `scripts/sdk-tarball-consumer.sh:79` `npm install` (scripts on) → a hook overwrites `$TARBALL` (`_publish-npm.yml:158`) or mints an OIDC token → `_publish-npm.yml:167` `npm publish "$TARBALL" --provenance` signs the substituted bytes → every downstream check (`:169-190`, `:245`) verifies the published artifact and passes.

**Why it matters**: It inverts the pipeline's strongest guarantee: consumers verifying provenance (including this repo's own `sdk-release-verification.ts`) would accept the forged package. `bun.lock` and the 7-day `minimumReleaseAge` govern the Bun install, not these npm resolutions; `verify-sdk-package-signatures.ts:51` already uses `--ignore-scripts`, so the risk class is known but applied to one of four installs.

**Recommended fix**: (1) build → pack → `sha256sum` → `upload-artifact`, with no registry execution in between; (2) run `sdk-tarball-consumer.sh` in a job with `contents: read` and no `id-token` on the downloaded artifact (the shape `_ts-package-ci.yml` already has); (3) the publish job downloads the artifact, asserts the digest recorded by job (1), then runs `npm publish`; move the `:245` fresh-install verification to a follow-on job without `id-token`. Interim, same day: `--ignore-scripts` at `sdk-tarball-consumer.sh:79`, `:111` and `_publish-npm.yml:245`; pin `typescript` exactly at `:93`; record `sha256sum "$TARBALL"` at `:158` and assert it immediately before `:167` (a partial control: still in the same job).

**Effort estimate**: hours (interim), ~1 day (job split)

---

### [Medium] F-002: Concurrent `prove()` calls share the protocol pin: a witness can POST to the never-validated HTTP port
**Impact:** Medium — confidentiality of one private witness to a loopback listener that never answered the health contract; needs `{httpsOnly:false, allowInsecureDowngrade:true}`, overlapping proofs, an HTTPS network failure, and a scheduling window.
**Confidence:** high on mechanism (reproduced with in-memory fetch mocks; re-traced line by line), moderate on real-browser timing
**Mapping:** OWASP A04:2021 Insecure Design; CWE-362, CWE-200
**Found by:** codex; Claude verified in rebuttal and withdrew its "reduces to the accepted boundary" position

**Instances**:
- `packages/sdk-core/src/lib/presto-client.ts:450` → `packages/sdk-core/src/lib/presto-transport.ts:648-653` — `demoteHttpsPin()` clears the pin without bumping `#generation`
- `packages/sdk-core/src/lib/presto-client.ts:323` → `:333` → `:364` → `:401` / `presto-transport.ts:958`
- `packages/sdk-core/src/lib/presto-transport.ts:688-693` — `baseUrl` computed from the current pin, not the status that authorised the attempt
- Reachable from both adapters: `packages/sdk/src/lib/presto-prover.ts:162`, `packages/sdk-noir/src/lib/presto-ultra-honk-backend.ts:126`

**Description**: Proof B obtains the cached healthy-HTTPS status and yields. Proof A's HTTPS POST fails at the network layer, enters the HTTP retry, demotes the pin, and awaits the HTTP health check. B resumes: its generation still matches, but `baseUrl` now yields `http://…`, so B posts the witness to the HTTP port with no health check at all; A's check later fails and A falls back — after B's disclosure.

**Trace**: cached HTTPS status (`presto-client.ts:128`, `:323`) → concurrent `demoteHttpsPin()` (`:450`, `presto-transport.ts:648`) → live `baseUrl` (`presto-client.ts:364`, `presto-transport.ts:692`) → `transport.post` (`presto-transport.ts:958`).

**Why it matters**: The accepted boundary is "discovery is shape-matched, not authenticated". This path is strictly worse: the receiving listener need not even answer the shape. The code's own downgrade comment (`presto-transport.ts:628-634`) names the attacker, and `#retryOverHttp` re-validates HTTP precisely for that reason; B bypasses that re-validation.

**Recommended fix**: Bind the attempt to the protocol that passed its check: capture `status.protocol` with `detectGen` in `prove()`, build the URL with the existing explicit-protocol `urlFor(protocol, path)` (`presto-transport.ts:935-938`) instead of the live `baseUrl`, and have `demoteHttpsPin()` bump a generation the final check compares. The existing `generation` + `Snapshot` pattern in `prove()` is the template. Also closes F-005.

**Effort estimate**: hours

---

### [Medium] F-003: `x-aztec-version` drives unbounded download churn and defeats the cache size cap before the payload is validated
**Impact:** Medium — availability of the user's machine and network: each request for an uncached real Aztec version costs up to 64 MiB egress and RAM, repeatable indefinitely; cache residency can be held above the 2 GiB cap until restart. One approval (or headless auto-approved localhost) suffices.
**Confidence:** high on both mechanisms, moderate on practical disk-fill magnitude
**Mapping:** OWASP API4:2023 Unrestricted Resource Consumption; CWE-400, CWE-770
**Found by:** both (three reports merged: download churn, cache-cleanup bypass, failed-download amplification)

**Instances**:
- `packages/presto/core/src/server/prove.rs:374-379` (header) → `:82` (`verify_cached_bb` on every resolve) → `:312` (`download_if_needed` before the permit)
- `packages/presto/core/src/server/ultra_honk.rs:333` precedes `:338` — download and activity refresh before `decode_and_check`
- `packages/presto/core/src/versions/downloader.rs:38` → `:44` — full tarball fetched before `verify_digest`
- `packages/presto/core/src/versions/release_metadata.rs:83-101` — unauthenticated GitHub API; rate limit → `Ok(None)` → digest error
- `packages/presto/core/src/versions/cache_layout.rs:249`, `:271-275` — `mark_in_use` rewrites `.last-used` on every resolve
- `packages/presto/core/src/versions/version_policy.rs:414`, `:458-478` — recently-active exemption; single non-looping retry
- `packages/presto/core/src/server/prove.rs:388-404` — cleanup only spawns after a download

**Description**: One root cause, two mechanisms: version selection has side effects that run before the request proves it is a real job, and the caps bound concurrency and residency, not churn. (1) Churn: an approved origin cycles real historical versions; once the GitHub API limit is hit, every request for any single uncached version downloads and discards the full tarball. (2) Cap bypass: fill the cache, then keep sending malformed requests against cached versions less than five minutes apart; the deferred cleanup runs once, sees everything active, and does not re-arm.

**Trace**: `x-aztec-version` → `resolve_version` (`prove.rs:51-91`) → `verify_cached_bb`/`mark_in_use` (`cache_layout.rs:232-252`) or `download_bb` (`downloader.rs:21-60`) → disk/network → cleanup exemption (`version_policy.rs:414`, `:477`).

**Why it matters**: `MAX_INFLIGHT_PROVE` and the per-origin cap bound concurrency; nothing bounds sequential downloads per origin or per hour, and the API rate limit is the trigger for the cheapest variant rather than a backstop.

**Recommended fix**: (1) fetch the digest before the tarball in `download_bb` and fail fast; (2) a download budget — one uncached download in flight globally plus a per-origin token bucket (e.g. 3 new versions per 10 min) counting every attempted miss, returning the existing `503`/`transient` the client classifies (`presto-client.ts:541-550`), with duplicate downloads coalesced; (3) re-arm `cleanup_after_active_window` while `deferred_by_active_window` holds, or refresh `.last-used` only once a job reaches `run_ultra_honk`; (4) optionally run `decode_and_check` before `acquire_prover` on `/prove/ultra-honk` (the current ordering is deliberate, `plan.md:135`).

**Effort estimate**: hours (1, 3); ~1 day (2)

---

### [Low] F-004: Playground deploy consumes a tarball that is not bound to the provenance it verified
**Impact:** Low — integrity of the deployed `playground.presto.build` bundle (a verified site in Presto's registry); requires the npm registry or a TLS MITM to serve inconsistent responses for one immutable version within one job.
**Confidence:** moderate (gap: high; exploitability: low)
**Mapping:** OWASP A08:2021; CWE-345
**Found by:** codex — cross-model disagreement on the precondition's realism; kept because the defect defeats the guarantee the code exists to provide and the fix is small

**Instances**:
- `scripts/published-playground.ts:103` (provenance), `:104` (signatures, separate temp install), `:107` (third download via `npm pack`), `:111` (compared only to a fresh `npm view dist.integrity`)
- `scripts/sdk-release-verification.ts:113-118`, `:37-42` — subject digest compared against a registry response, never a local file; no digest returned
- `scripts/verify-sdk-package-signatures.ts:39-42` — returns `void`; verifies a copy that is discarded
- Sinks: `.github/scripts/packaged-e2e-swap-sdk.sh:71`, `:85`, `:134`; `.github/workflows/release-sdk.yml:232`, `:238`

**Description**: Three registry conversations — attestation fetch, `npm audit signatures` in a temp dir, `npm pack` — are each internally consistent but never bound to one another; artifact A can be verified and artifact B deployed.

**Trace**: `fetchAndVerifySdkProvenance` → `verifySdkPackageSignatures` → `npm pack` → `dist.integrity` self-comparison → swap script → `wrangler deploy`.

**Why it matters**: A verified site's JS runs with the user's standing approval in Presto. Same missing-digest-binding pattern as F-001.

**Recommended fix**: Carry the digest of the cryptographically verified attestation (the signature audit's subject), hash the packed file locally (`Bun.CryptoHasher("sha512")`) and compare before the swap; or run `npm audit signatures --include-attestations` in the directory the tarball was packed into and assert the audited integrity equals the local file hash.

**Effort estimate**: hours

---

### [Low — informational] F-005: Caller-supplied payload iterator runs after the last policy check before dispatch
**Impact:** Low/informational — a `configure({httpsOnly:true})` executed from inside the payload's own iterator during `Uint8Array.from` is not honoured; only a caller subverting its own client can reach it (neither shipped adapter constructs such a payload).
**Confidence:** high on mechanism, low on significance (Codex would assign no band)
**Mapping:** CWE-367
**Found by:** codex; Claude verified empirically

**Instances**: `packages/sdk-core/src/lib/presto-client.ts:385` → `:396` → `:401` / `presto-transport.ts:958`

**Description**: `prove()` re-checks `generation` after `body()` (`:377`) to honour mid-flight reconfiguration, but the conversion at `:396` runs caller code after that check.

**Recommended fix**: Move `Uint8Array.from(payload)` above the `:385` check (mirrors the treatment of `body()` and phase callbacks at `:376-385`). Shipped with F-002.

**Effort estimate**: hours (< 1)

---

## Findings NOT pursued (with reasoning)

- `parse_request` runs synchronously on the tokio runtime (`ultra_honk.rs:330`) — deliberate, documented ordering (`:166-167`); bounded cost; an approved origin already commands the machine through legitimate proving. Hardening note only.
- No minimum-safe bb version floor (`version_policy.rs:295-315`) — no vulnerable build or input identified; documented trade-off.
- FIFO `proof.json` blocking the global permit (`bb.rs:487`) — malicious-bb-only; post-exit path. Cheap hardening: `symlink_metadata().is_file()` before `File::open` in `read_capped`.
- Windows ordinary exit leaving Job members running (`bb.rs:929-931`) — malicious-bb-only; the update path's `terminate_and_confirm` still reaches them.
- Unix `setsid()` escape and Windows spawn-before-assign window (`bb.rs:627`, `:723-731`, `:894`→`:906`) — only a malicious bb, already running as the user, can exercise them. Defense-in-depth options: `CREATE_SUSPENDED` + assign + resume on Windows; `PR_SET_CHILD_SUBREAPER`/cgroup on Linux.
- `#retryOverHttp` check-then-post window and the `HTTPS_GRACE_MS` pin race — reduce to the accepted shape-matched boundary.
- Unconsumed bodies on early returns (`presto-transport.ts:804`, `:926`) — no exhaustion demonstrated. `readUnstreamedText` pre-cap buffering — unreachable in the supported runtimes.
- No-Origin and `--allow-all` callers exempt from the per-origin cap — documented, accepted.
- Admission-guard release before bb reap — fixed in PR #28.
- Noir adapter (both models zero): server-key cache poisoning contained (`getVerificationKey`/`verifyProof` never read the cache); peer version not asserted at runtime does not widen trust.
- Playground (both models zero): no injection sink; `noirStub` DEV-gated and asserted dead in the production smoke; no CSP but nothing to protect with it yet.
- Direct `${{ }}` interpolations in workflows — values derive from the allowlisted descriptor or a numeric pid.
- Provenance `workflow.path` for a job inside a called reusable workflow — unverifiable from repository contents; open question.

## Cross-cutting observations

1. **Privileged CI steps trust artifacts across an untrusted execution boundary without a digest.** F-001 and F-004 share one pattern: verification results are never carried forward as a hash bound to the bytes actually consumed. Compute a local digest at the trust boundary and assert it at the sink, in both places.
2. **Mutable shared client state consulted after a check.** `PrestoClient` snapshots the request and re-checks `generation`, but the destination is read live from the transport, which any concurrent attempt can mutate (F-002), and caller code can run after the last check (F-005). One immutable eligibility+destination snapshot per attempt; every shared-state mutation bumps a generation.
3. **Resource caps bound concurrency and residency, not churn.** Nothing limits rate over time (downloads/hour, refreshes/window); F-003 is the instance.
4. **Side effects before validation.** Version resolution (download, `mark_in_use`) precedes payload decoding on both prove routes; the cheapest requests pay the most expensive side effects.
5. **Containment is best-effort against an adversarial child.** Process-group/Job-Object containment is sound for the authentic bb; "confirmed dead" is a statement about the original group/job, not every descendant.
6. **The revocation denylist is the only version-safety control and is an empty compile-time constant** (`version_policy.rs:249`); reactive, needs a Presto release to activate.

Artifacts: `findings/consolidated.md`, `findings/verified.md`, `findings/verifier-{claude,codex}.md`, `raw/repo-map/*`, `raw/<cluster>-{claude,codex}.md`, `report.html`.

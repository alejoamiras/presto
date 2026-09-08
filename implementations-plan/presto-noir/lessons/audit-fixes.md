# Lessons — post-audit fixes (2026-09-08)

Plan: `../audit-fixes-plan.md`. Findings: `audit/security/2026-09-08-presto-noir/report.md`.

## Step 1 — #28 was never green on Windows

The reap PR had exactly one CI run and its `Cert Trust (windows)` lane failed in the new
`cancel_terminates_the_job_tree_and_returns_after_the_reap` test with "the descendant never
started". Root cause: the marker path was interpolated inside the quoted `cmd /C` argument; std
escapes embedded quotes as `\"`, which cmd.exe does not understand, so the redirect target was
mangled and the marker was never written. Fix (1190e33): `current_dir(tempdir)` and a relative
marker name, so the argument carries no quotes. Verified with `cargo check --target
x86_64-pc-windows-gnu --tests` (the test cannot run on Linux). Lesson: "green" claims need the
run ID; a PR whose first run has not finished is not green.

## Step 3a — F-001 + F-004 (`fix/publish-digest-binding`)

Design choices:
- The digest travels as a **job output** of `pack`, not only inside the artifact: an artifact can be
  replaced within a run by any job (the runtime token uploads), a recorded output cannot.
- Post-publish registry verification (`sdk-release-verification.ts`, `verify-sdk-package-signatures.ts`)
  stays in the `publish` job before tagging: it executes no registry code (`npm view`, attestation
  fetch, `npm install --ignore-scripts`, `npm audit signatures`), and tagging a publish that failed
  verification would be worse than the extra seconds in the privileged job.
- The consumer installs now run `--ignore-scripts` even though the job is unprivileged. Verified
  locally that the `presto-core` and `presto` consumer profiles still resolve, typecheck, and load.
- F-004 (final shape after codex round 1): `verifySdkPackageSignatures` returns the provenance
  statement npm actually verified (from the audit report's `attestationBundles`), with the
  repository/workflow/ref/commit checks applied to it; the deploy hashes each `npm pack` file with
  `Bun.CryptoHasher("sha512")` and requires it to equal that signed digest. My first cut used the
  temp install's lockfile integrity, which npm's audit never compares against — see round 1.

### Codex loop (session `01a082b0-6ce1-7bd0-a829-40b96529648d`, GPT-6 Astra, high)

**Round 1** — verdict "changes required". Two material findings, both accepted after checking the
claims against npm 11's source:
- High: `bun install --frozen-lockfile` in the publish job still runs a locked dependency's
  lifecycle script (root `prepare` → husky) beside the OIDC identity. Fix: the publish job installs
  nothing; its scripts import only repository modules.
- Medium: the lockfile integrity I returned from the signature audit is NOT what `npm audit
  signatures` verifies — npm calls `pacote.manifest()` afresh and verifies the bundle against THAT
  fetch's integrity, never comparing to the installed copy. An equivocating registry could serve
  malicious bytes to the install, the unsigned attestation endpoint and `npm pack`, and the genuine
  signed material to the audit. Fix: take the statement from the verified entry's
  `attestationBundles` (sigstore-verified, subject digest matched by pacote), apply the
  repository/workflow/ref/commit checks to it, and bind the downloaded bytes to its digest only.
- Low: contract tests accepted `indexOf() === -1`; comments overstated the boundary. Both fixed.
Rejected nothing. Live check after the fix: all three published packages bind (commit f331a78).

**Round 2** — "F-001 and the deployed-byte binding are fixed; two material caller issues remain."
- Medium: the signed verifier's `expectedCommit` was never supplied by production callers, so they
  validated the signed commit's format, not its equality with the dispatched SHA / tag commit.
  Fixed: publish passes `$GITHUB_SHA`, `release-plan.ts` passes the tag commit, promotion compares
  the tag against the signed statement's commit.
- Medium: promotion's rollback allowance (`publish-testnet.yml`) reached only the unsigned check, so
  the new signed check would have rejected every legacy rollback target. Fixed: the allowance is
  passed to both.
- Low: comment precision ("nothing is installed" vs the verifier's `npm install --ignore-scripts`).
Rejected: extracting `verifyPromotionCandidate` behind an injectable seam for a mocked
unsigned-vs-signed regression — a new layer for one test; a source-contract test pins the three
caller shapes instead.

**Round 3** — "ready for PR — no new material findings." One comment nit applied (the header
said "installs nothing"; the signature verifier does `npm install --ignore-scripts`). Codex agreed
the source-contract tests are proportionate. Converged after 3 rounds.

## Step 3b — F-002 + F-005 (`fix/core-attempt-snapshot`)

The audit's fix text also suggested bumping a generation inside `demoteHttpsPin()`. Not done: the
attempt that demotes is the one that legitimately retries over validated HTTP, and bumping the
generation there would make its own final check fail. Binding the destination to the protocol that
answered the attempt's health check (`urlFor(status.protocol, path)`) closes the race on its own:
the demoted pin is never read after the check. Regression test tries eight microtask alignments of
the second proof against the first's failure; on the unfixed client one alignment returned
`kind: "native"` from the foreign HTTP listener (the witness had been posted there).
F-005: the payload copy (`Uint8Array.from`, caller-supplied iterator) now runs before the last
generation check, beside `body()` and the phase callbacks. Manifests: core and noir → 1.0.1.

### Codex loop (session `01a082c2-b260-7491-b734-657dc8ab2220`, GPT-6 Astra, high)

**Round 1** — "request changes: the race fix works, but trusting the mutable public status
introduces an HTTPS-only bypass."
- Medium (accepted): `checkStatus()` hands out the cached status object, and `prove()` now routes
  by `status.protocol`, so a caller mutating `status.protocol = "http"` under `httpsOnly: true`
  posted its witness to HTTP with no health check. Same "caller subverting its own client" persona
  as F-005, but a real policy bypass through the public API. Fix: `cacheStatus` freezes the object;
  regression test asserts the freeze and that the witness still goes to HTTPS.
- Low (accepted): the depth sweep could silently stop covering the race if promise scheduling
  changes. Codex proposed a deferred-promise single-ordering test, but B's continuation has no hook
  (cache hit resolves synchronously inside `checkStatus`); instead the sweep now asserts that at
  least one depth placed B's HTTPS POST after A's HTTP health check — the alignment where B chose
  its URL after A's demotion — so lost coverage fails loudly.
- Low (accepted): focused F-005 test (an iterable payload that calls `configure()` while being
  copied → `endpoint-changed`, nothing posted).
- Low (accepted): `bun.lock` records workspace versions; bumped to 1.0.1 by hand (`bun install`
  does not rewrite them) and validated with `--frozen-lockfile`.
- Comment (accepted): `demoteHttpsPin`'s doc claimed the caller uses its return value; it does not.
Codex confirmed no demotion generation bump is needed and found no internal sequence that yields an
HTTPS-only policy with a cached HTTP status.

**Round 2** — "production fix looks sound; no new material findings." One test-quality
correction applied: my coverage assertion matched the initial dual probe's HTTP health request, not
A's retry check, so depth 0 counted as covered while B had posted before the demotion. The
assertion now requires, within one depth, A's POST → A's HTTP retry check → B's POST with exactly
one HTTPS probe before B's POST (B reused the original status). Converged after 2 rounds.

## Step 3c — F-003 (`fix/bb-download-budget`)

Design choices:
- **Digest first.** `download_bb` fetches the GitHub release digest before the tarball; once the
  unauthenticated API is rate-limited the request fails in one small round trip instead of after
  streaming 64 MiB it will discard.
- **Budget = serial lock + two sliding windows.** `versions::DownloadBudget` lives on
  `HeadlessState`. `download_if_needed` takes the lock, re-checks the cache (a request that waited
  for the same version spends nothing), then spends one token per actual download attempt — success
  or failure — against a per-origin bucket (3 per 10 min; origin-less callers share one) and a
  global bucket (6 per 10 min, so `--allow-all` origin rotation is bounded too). Over budget →
  `429 download_budget_exhausted`, which the SDK already classifies as `transient` → WASM.
- **Activity marks only at execution.** `verify_cached_bb` is now side-effect free;
  `take_cached_bb` (used by `find_bb` on the execution path) writes `.last-used`. A malformed
  request can no longer keep a version "recently active" and exempt from the size cap; only a proof
  that reaches bb can, and that costs a real serialized proof. With downloads budgeted, the
  over-cap excess is bounded, so I did not add a re-arming cleanup loop (a perpetual sleeping task
  for a case the budget already bounds).
- Not done: moving `decode_and_check` before `acquire_prover` — the current ordering is deliberate
  (`plan.md:135`) and the budget makes it safe.

### Codex loop (session `01a082d3-b42e-7881-b44b-95d09214cf5d`, GPT-6 Astra, high)

**Round 1** — "request changes: churn is bounded, but the cache-cap bypass remains material."
- Medium (accepted): `find_bb` marked the version active before bb ran, so a body bb rejects at
  once still refreshed residency for free. The mark now happens only after `run_bb` succeeds, under
  the lease; the deferred size-cap pass repeats up to an hour while entries stay active or held.
- Low (accepted): between `resolve_version`'s verification and the lease, an eviction can complete;
  the lease then succeeds on an absent entry and the job dies later as `500 prove_failed`. Now an
  existence check under the lease answers `503 version_evicting`.
- Low (accepted): the server test depended on the real `~/.presto` cache and raced the cache-layout
  test's process-global `PRESTO_HOME`. Added `ScopedPrestoHome` (private temp home, restored on
  drop) and `#[serial]` on every reader/writer; pinned the "a waiter spends nothing" claim.
- Comment nits accepted. Codex confirmed: tokens are spent before any network on both routes, no
  cross-origin token theft or window reset, no lock cycle, refusal precedes the Downloading status
  and releases admission seats, digest-first keeps the sidecar path and fail-closed behaviour,
  429 → SDK `transient` is right.

**Round 2** — "download protection looks sound; the lease-race fix and test isolation remain
incomplete." Two Lows accepted: the post-lease existence check skipped a request whose version was
installed by another request's download (`needs_download` describes the initial resolution), so
it now runs for every non-bundled version; two unannotated tests (`resolve_version_flags_uncached
_for_download`, `version_bb_path_format`) read the cache root without `#[serial]` and could race
the private `PRESTO_HOME` — both serialized, the former on its own private home. Comment on the
deferred-cleanup loop corrected: the passes bound retry duration, not residency.

**Round 3** — "no new material findings." Converged after 3 rounds.
**Round 3** — "no new material findings." Converged after 3 rounds.

## Step 4 — npm re-release

Dry run 34280070511 (`packages=all`, after #32 and #33 merged) planned: core 1.0.1 publish,
noir 1.0.1 publish, presto 5.2.0-revision.2 publish, each adapter's provenance and consumer rerun
deferred to after core. Real run 34280233253 dispatched next — the first end-to-end exercise of the
split `_publish-npm.yml`.
Run 34280233253: `npm publish` of core 1.0.1 succeeded (commit eaa6288), but the verification
step got HTTP 404 for the attestation for its whole 60 s window and the job failed before the tag
and GitHub release. The attestation appeared minutes later; both verifiers pass locally. The
auto-mode classifier blocked my tag push, so the record repair (tag + release) is the owner's;
PR #35 widens the wait to ten minutes. Redispatch after both.

## Step 5 — Presto 1.1.1

Dispatched run 34281717754 (`version=1.1.1`) from main at 0a8960b (carries #28, #34).
Run 34281717754 succeeded: `presto-v1.1.1` tagged at 0a8960b, published non-draft non-prerelease
with 17 assets; `latest.json` names 1.1.1, four platforms, non-empty signatures, exact release
URLs; macOS notarization and every updater smoke (positive and negative) green.
Promote-only dry run 34283994541 green; promotion 34284199732 flipped the KV feed, verified the
live feed, marked `presto-v1.1.1` GitHub Latest, and opened bump PR #36 (1.1.2-rc.1); its
`gh pr merge --auto` failed as before ("Auto merge is not allowed"), so #36 is merged by hand once
green.

## Steps 6–8 — promotion, close-out, wrap-up

Promotion to `latest` is the owner's (OTP): `bun run sdk:promote -- --package presto-core 1.0.1`,
`bun run sdk:promote -- --package presto-noir 1.0.1`, `bun run sdk:promote -- 5.2.0-revision.2`,
each with `--dry-run` first, after noir 1.0.1 and presto 5.2.0-revision.2 are on `testnet`.

Open at close-out: the core 1.0.1 tag/release repair and the redispatch of `release-sdk.yml
packages=all` (owner), PR #35 (attestation wait), bump PR #36 (red on three npm advisories
published after the last green audit: extract-zip, js-yaml, sharp — accept or bump). The worktree
`presto-noir` can be removed with `agent-worktree done presto-noir` once those merge.

Contentious decisions, with the call: no demotion generation bump in `PrestoClient` (it would
invalidate the demoting attempt's own legitimate retry; binding the URL to the attempt's own check
closes the race — codex concurred); no injectable seam in `verifyPromotionCandidate` for a mocked
unsigned-vs-signed test (source-contract test instead — codex concurred); activity mark only after a
completed proof rather than at resolve or execution start (codex's round-1 finding, accepted);
bounded twelve-pass cleanup retry rather than a perpetual loop (codex accepted the bound).

## Final state (2026-09-08, after the owner lifted the classifier holds)

- Core 1.0.1 record repaired: tag `@alejoamiras/presto-core@1.0.1` at eaa6288 (annotated, signed
  per this machine's config; the workflow itself writes lightweight tags) and its GitHub release.
- #35 merged (attestation wait 60 s → 10 min). The redispatch after it, run 34286357275, was
  cancelled: its dependency-audit gate failed on three npm advisories published after the last
  green audit (extract-zip GHSA-7pqw-9j4j-h8q3, js-yaml GHSA-2883-xcg3-v3hh, sharp
  GHSA-rgj7-g3m4-5g8c — all dev/CI tooling). Accepted until 2026-11-30 in #38.
- Run 34287696426 then published noir 1.0.1 and presto 5.2.0-revision.2 (core reused), both with
  signed provenance for f025d78, and deployed the playground. The split `_publish-npm.yml` ran
  end to end for the first time here: pack → consume → publish → verify, on both packages.
- Bump PR #36 (1.1.2-rc.1) needed #38 first; its Windows launch smoke then timed out once on the
  runner (the smoke's own caveat) and passed on a single rerun.
- Promotion to `latest` (owner OTP) is the only step left: core 1.0.1, noir 1.0.1, presto
  5.2.0-revision.2, dry run first.

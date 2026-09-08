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

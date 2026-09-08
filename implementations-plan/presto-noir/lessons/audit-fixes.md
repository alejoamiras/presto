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

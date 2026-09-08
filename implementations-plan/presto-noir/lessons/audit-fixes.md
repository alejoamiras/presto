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
- F-004: `verifySdkPackageSignatures` returns the lockfile integrity the audit signed over;
  `fetchAndVerifySdkProvenance` returns the integrity its subject digest matched; the deploy hashes
  the packed file with `Bun.CryptoHasher("sha512")` and requires all three to agree.

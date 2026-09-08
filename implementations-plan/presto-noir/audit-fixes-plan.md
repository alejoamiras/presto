# presto-noir — post-audit execution plan (2026-09-08)

Source: `audit/security/2026-09-08-presto-noir/report.md` (five findings, F-001..F-005). Owner approved this order on 2026-09-08 ("sounds perfect"). Run inside the `presto-noir` worktree; branch off `origin/main` for every change.

## Authorizations for this run (override plan.md's hard limits for exactly these actions)

- Merge PRs #28, #29, the audit PR, the three fix PRs, the close-out PR and the release bump PR: `gh pr merge --squash`, one at a time, only after `gh pr checks` is fully green and the branch is up to date with main.
- Dispatch `release-sdk.yml`: `packages=all dry_run=true`, then `mode=sdk-and-playground packages=all` (publishes to `testnet`, deploys the playground).
- Dispatch `release-presto.yml`: `mode=publish`, then `mode=promote-only dry_run=true`, then `mode=promote-only bump_source=true`.
- Keep commit signing on (non-interactive on this machine).

**Still forbidden:** `bun run sdk:promote` (owner OTP — stop and print the commands); registering trusted publishers or touching credentials; force-pushes; yacana integration; `/code-review`; any change outside the five findings plus their tests and docs. If the auto-mode classifier blocks an authorized action, surface it and hold; never work around it.

## Steps (in order)

1. **Merge #28, then #29** into main.
2. **Audit PR**: open from `audit/presto-noir-security` (body: the five-findings table + recommended follow-ups + session trailers); merge when green.
3. **Three fix PRs**, each branched off the then-current main, tests inline, docs in the same PR (`CLAUDE.md`, package READMEs, `docs/RELEASE_RUNBOOK.md` where behaviour or workflow shape changes):
   - `fix/publish-digest-binding` — **F-001 + F-004**. `_publish-npm.yml` split into: build → pack → `sha256sum` → `upload-artifact` (no registry execution before the hash); an unprivileged consumer-test job (`contents: read`, no `id-token`, on the downloaded artifact); a publish job that downloads the artifact, asserts the recorded digest, then publishes. The post-publish fresh-install verification moves to a follow-on job without `id-token`. `--ignore-scripts` on the `sdk-tarball-consumer.sh` installs; `typescript` pinned exactly. `published-playground.ts` carries the digest from the cryptographically verified attestation and compares the locally hashed tarball before the swap. Contract tests updated (`sdk-release-contract.test.ts`, `published-playground.test.ts`); `bun run lint:actions` exit 0.
   - `fix/core-attempt-snapshot` — **F-002 + F-005**. `prove()` binds the attempt to the protocol that passed its check via `urlFor(protocol, path)`; `demoteHttpsPin()` bumps a generation the final check compares; `Uint8Array.from(payload)` moves above the last check. Concurrent-prove regression test in sdk-core. `packages/sdk-core` and `packages/sdk-noir` manifests bumped to 1.0.1.
   - `fix/bb-download-budget` — **F-003**. Digest fetched before the tarball in `download_bb`; a download budget (global single-flight + per-origin token bucket counting every attempted miss; over-budget → the existing 503 `transient`; duplicate downloads coalesced); cleanup re-armed while the active window holds (or `.last-used` refreshed only once a job reaches `run_ultra_honk`). Rust tests for budget, coalescing, re-arm; `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test` green.

   **Codex loop per PR**: `/codex high` (GPT-6 Astra) over the diff with the finding text from the report, the adversarial ask, and plan.md's no-over-engineering and comment-quality rules (`plan.md:570`, `:572`) verbatim. Resume the same session until a round reports no material findings (quote it in the transcript); hard stop at 3 rounds → surface. Open the PR only after convergence and local `bun run test` + `bun run lint:actions` pass; then `gh pr checks --watch`. Rerun a failed lane once if it is a known flake (Windows auth-flow, NSS timeout); otherwise fix forward. Log every consult and decision in `lessons/audit-fixes.md`.
4. **npm re-release** — only after the F-001 PR is merged: `release-sdk.yml packages=all dry_run=true` green → `mode=sdk-and-playground packages=all` green (core 1.0.1, noir 1.0.1, presto at the next revision the plan job computes; all on `testnet`; playground deployed) → provenance and signature verification of the three published versions in the transcript.
5. **Presto 1.1.1** from main (carries #28 + F-003): `release-presto.yml mode=publish` green → runbook verification → `promote-only dry_run=true` green → `promote-only bump_source=true` green (live feed flipped and verified, GitHub Latest) → bump PR merged.
6. **Stop** and print the promotion commands verbatim for the owner (dry-run first): `bun run sdk:promote -- --package presto-core 1.0.1`, `bun run sdk:promote -- --package presto-noir 1.0.1`, `bun run sdk:promote -- <presto version>`. Do not run them.
7. **Close-out PR**: `implementations-plan/index.md` marks presto-noir completed (date, PRs, releases, audit path); merge. Then hand the owner `agent-worktree done presto-noir` (run from the canonical clone, not this worktree).
8. **Wrap-up report**: what shipped (versions, run IDs, PR numbers), every contentious codex decision with ELI5 context, open items.

## Standing constraints

- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_012j1SuSb4bGmKprXqfycqMn`; PR bodies end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)` and that URL.
- No absolute local paths in anything committed.
- Same step failed 3 times → reassess with codex before retrying.

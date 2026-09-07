---
driver: codex
eli5_mode: file
code_review: off
baseline: ae1cb9c8d0e2ac6ecb2290811522fd529db4eca5
---

# Presto cleanup

Three reviewable stacked arcs retire the spent first-release exception, refresh dependencies under a
seven-day publication-age policy, then enforce complexity limits through readable refactoring.
Readability is the objective; metric-driven compression is forbidden.

## Status

- [x] Arc 1: first-release exception removal
- [x] Arc 2: dependency refresh and age enforcement
- [ ] Arc 3: complexity enforcement and readable refactoring
- [ ] Final cross-arc review and delivery

## Architecture & Implementation

### Arc 1 — release baseline enforcement

Remove the `1.0.0-rc.1` escape path from `resolve-updater-baseline.ts`, its `bootstrap` result and
workflow output, and every updater-smoke skip condition. Keep pagination, greatest-lower-version
selection, complete-asset checks, same-key verification, credential diagnostics, signing, and all
positive/tampered updater jobs unchanged. Update current runbook instructions while preserving the
dated launch records.

Validation gate:

```sh
bun test packages/presto/scripts/resolve-updater-baseline.test.ts packages/presto/scripts/release-contract.test.ts
bun run test
bun run lint:actions
```

Pass criteria: missing baselines—including the former RC1 case—fail; the greatest complete lower
same-key release is selected; all updater jobs remain mandatory; commands exit zero.

### Arc 2 — dependency eligibility and refresh

Refresh npm dependencies, all three independent Cargo lockfiles, SHA-pinned Actions/composites, and
pinned CI/development tools to the newest stable, non-deprecated versions that were published at
least seven full days before the update. Preserve aliases, workspace references, Aztec companion
alignment, Windows checksum review, runtime typings, restricted install scripts, and compatible
minisign verification. Remove both Aztec age exemptions, invalidate affected caches, add a
dependency-free resolved-entry/action age checker, gate affected jobs before install/build, and add
Dependabot cooldown. Record withheld candidates and the four open Dependabot PRs present at start.

Validation gate:

```sh
bun run test
bun run lint:actions
bun run audit:dependencies
bun run --cwd packages/sdk build
cargo test --locked --manifest-path packages/presto/src-tauri/Cargo.toml
cargo test --locked --manifest-path packages/presto/core/Cargo.toml
cargo test --locked --manifest-path packages/presto/server/Cargo.toml
```

Pass criteria: eligibility tests cover exact boundary, young transitives, missing metadata, aliases,
source changes, forced Aztec updates, composites, and an opt-in registry integration; dependent CI
steps cannot run after a failed age check; all commands exit zero.

### Arc 3 — complexity limits and readable refactoring

Configure Biome for handwritten root/package JS/TS, excluding generated output; set cognitive
complexity 15, nonblank function length 80 with `skipIifes: false`, and nested test suites to errors;
leave `noExtraBooleanCast` and `noForEach` off and make `noBannedTypes` a warning. Exempt only test
bodies from function length. Share Clippy thresholds 15/80 across the three independent crates
without creating a workspace, add `lint:clippy`, expand CI routing, measure the full baseline, and
refactor every violation through coherent responsibility extraction. Keep desktop startup changes
in a focused commit with behavioral validation.

Validation gate:

```sh
bun run format
bun run lint
bun run lint:clippy
bun run test
bun run lint:actions
cargo test --locked --manifest-path packages/presto/src-tauri/Cargo.toml
cargo test --locked --manifest-path packages/presto/core/Cargo.toml
cargo test --locked --manifest-path packages/presto/server/Cargo.toml
```

Pass criteria: all limits are enforced without blanket exceptions, every violation is resolved or
narrowly justified, each crate passes separately with its committed lockfile, and a final diff review
finds no compressed control flow or needless indirection.

## Security & Adversarial Considerations

- Release enforcement fails closed and preserves the same-key Ed25519 updater trust boundary.
- Dependency metadata is untrusted input: reject missing, malformed, changed-source, young, or
  unverifiable records rather than treating absence as eligibility.
- Registry timestamps—not commit dates—establish age. Action tags must resolve exactly to the pinned
  commit and an eligible stable GitHub release.
- Workflow permissions remain least-privilege; no secret values are printed or moved.
- Frozen lockfiles and restricted install-script permissions remain mandatory.
- Complexity work must preserve cancellation, locking, resource ownership, initialization order,
  error handling, and cleanup behavior.

## Assumptions

### Facts

- The implementation baseline is commit `ae1cb9c` on `origin/main`.
- The initial native release and its same-key successor are published; dated evidence remains under
  `docs/PRESTO_LAUNCH_STATUS.md` and `docs/PRESTO_LAUNCH_TODO.md`.
- The repository has three independent Rust manifests and lockfiles under `packages/presto/`.
- Bun, Biome, Cargo, ShellCheck, and actionlint are existing local validation tools.
- Four Dependabot PRs were open at implementation start: #8 tar, #9 tauri, #10 serde_with, #11 openssl.

### Inferences

- The supplied plan is approved implementation authority; no second planning approval is required.
- `code_review: off` means no additional same-family `codex review`; the explicitly required Claude
  review/fix loops remain mandatory.

### Asks

None.

## Decision ledger

- Keep historical launch evidence unchanged; update only current operational instructions.
- Use one dependency-policy implementation for npm, Cargo, workflows, and composites rather than
  independent partial checkers.
- Share Clippy configuration without creating a Cargo workspace because the crates are intentionally
  independent.
- Reject blanket lint grandfathering; allow only narrow documented exceptions where a threshold
  would make code harder to read.

## Post-implementation review

At each arc boundary, run a fresh `/claude high` review over that arc's full diff and this plan. Ask
for correctness, adversarial/security issues, plan drift, metric-driven compression, unnecessary
indirection, behavior changes, and comment quality. Include these rules verbatim:

> Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra
> configuration surface, new layers, or rewrites — the smallest change that fixes each real problem.
> If code works and is clear, leave it alone.

> Audit the comments for value per character. Flag any comment that narrates what the code visibly
> does, restates its line, references implementation plans / phases / reviews, or spends a paragraph
> where a sentence works — and flag places where a non-obvious invariant or constraint deserves a
> comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays
> to re-read: they must be few, dense, and exact.

Verify every finding against the repository. Apply accepted fixes in a separate commit, record the
verdict in `lessons/`, then resume the same Claude session with the fix diff. Stop and reassess if
material findings continue after three rounds. After all arcs converge, run a fresh cross-arc Claude
review for seams, duplication, and drift before opening any PR.

## Delivery

| Arc | Branch | Stacks on | Scope | Review |
|---|---|---|---|---|
| 1 | `worktree-presto-cleanup` | `main` | First-release exception removal | Claude high loop |
| 2 | `presto-cleanup-dependencies` | Arc 1 | Dependency refresh and age policy | Claude high loop |
| 3 | `presto-cleanup-complexity` | Arc 2 | Complexity rules and refactors | Claude high loop |

After every arc and the final cross-arc pass converge, initialize/sync the stack, submit the three
PRs, write accurate PR bodies, run `gh pr checks --watch`, and do not merge automatically.

## Seed

```text
/goal Complete implementations-plan/presto-cleanup/plan.md: all four Status items marked complete,
each validation gate reported passing, every per-arc and final Claude review loop converged, and the
three stacked PRs exist with required checks green. Never merge, publish, deploy, rotate keys, or
expand scope.
```

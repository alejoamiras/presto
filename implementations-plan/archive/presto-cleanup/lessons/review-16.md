# Review — PR #16 (`worktree-presto-cleanup`)

Independent review of the peer's Arc 1 by a second driver (Claude), with Codex as the foreign
reviewer. Scope: intent vs. delivered, introduced bugs, unprompted CI changes.

## Original ask

Remove the spent first-release escape from the release pipeline: exactly `1.0.0-rc.1` could skip
the updater-smoke baseline (`bootstrap: true`) when no Presto release existed. The lost-key
"rotation" wiring was already gone on `main` (the existing release contract test asserts it).

## What the peer delivered

- Resolver: deleted the RC1 branch and the `bootstrap` field; unrelated reordering of one line.
- Workflow: removed the `bootstrap` output, the four `outputs.bootstrap != 'true'` smoke guards,
  and the `(skipped && bootstrap && version == '1.0.0-rc.1')` escape on the `release` gate.
- Tests: exact error assertions, one new wrong-key fallback case, contract for `outputs.bootstrap`.
- Runbook: RC1 recovery section replaced with a historical note.

Every `.github/**` hunk was required by the ask. No unprompted CI change.

## Findings

- No fail-open path: a resolver throw fails `resolve-updater-baseline`; all four smoke jobs and
  the `release` gate require `result == 'success'` with no `continue-on-error`.
- No leftover bootstrap/rotation wiring in `.github/`, `docs/` (outside dated launch records), or
  `packages/`.
- Codex (max effort): APPROVE WITH NITS. Adopted both: (1) the ordering test only had one
  same-key candidate, so greatest-lower selection was untested — added an older same-key release;
  (2) restored the resolver's original statement order (the move was behavior-neutral churn).

## Validation

- `bun test` on the resolver and release-contract suites: 31 pass.
- `bun run test`: all packages pass. `bun run lint:actions`: pass.

Codex session `01a07d89-7c30-7023-b604-aa85ef4bd295`.

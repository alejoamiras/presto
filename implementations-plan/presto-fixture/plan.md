---
plan: presto-fixture
tier: light
driver: claude-code
eli5_mode: off
code_review: off
codex_model: sol
explainer: off
status: approved 2026-10-14 (director brief)
created: 2026-10-14
worktree: .claude/worktrees/presto-fixture
branch: worktree-presto-fixture
base: main @ cfe86f1
---

## Summary

`audit/fixtures/interop-sdk.json` names the published SDK that the sandbox e2e proves against the
workspace's Presto. It still names `@alejoamiras/presto` 6.0.0-rc.1, but the workspace targets
Aztec 6.0.0-rc.3. Release run 38599643298 published presto 6.0.0-rc.3 from `b842a53`, and since then
`scripts/install-legacy-sdk.ts` fails by design: "point audit/fixtures/interop-sdk.json at it". So
every sandbox e2e on `main` is red at the legacy step. This plan re-points the fixture at 6.0.0-rc.3
(#103).

## Scope

| # | Change | How |
|---|---|---|
| 1 | `sdkVersion` 6.0.0-rc.1 → 6.0.0-rc.3, plus its `sdkIntegrity` | Written by a script, never typed. The script takes the integrity that `scripts/verify-sdk-package-signatures.ts` reports and requires it to equal `npm view … dist.integrity`. The verifier runs npm's signature audit plus SLSA, with the expected commit `b842a53`. |
| 2 | `sdkDependencies` | The same procedure, for every `@alejoamiras/*` dependency the published manifest pins. 6.0.0-rc.3 pins `presto-core` 1.2.1, the same publication as before, so the entry does not change. |
| 3 | `follow-ups.md` | Drop the #103 entry. |

**Out of scope:** the gate logic, the e2e test, and the other fixture fields. `proverExport`,
`statusMethod` and `configOption` were checked against the published 6.0.0-rc.3 and still hold.

## Gates

- the legacy step, `bun scripts/install-legacy-sdk.ts`: exit 0, printing the published entry rather
  than the dormant notice;
- `bun install --frozen-lockfile`, `bun run test`, `bun run lint`, `bun run lint:actions`.

On the PR, the acceptance check is `sdk.yml`'s sandbox e2e. The fixture path routes it, and it runs
`legacy-compatibility.test.ts` against the branch's server.

## Security & Adversarial Considerations

- **Which bytes CI trusts.** The installer checks the tarball against `sdkIntegrity`. So the value
  must come from a source that vouched for the bytes: npm's signature audit and the SLSA statement
  over the same digest, both bound to the release workflow and commit. The registry's
  `dist.integrity` alone is not enough. A hand-copied value that matched the wrong publication
  would let CI prove against bytes nobody built from this repository.
- **The siblings.** Core's integrity is re-verified, not carried forward. It is unchanged only
  because the published manifest still pins 1.2.1.

## Post-implementation

Run `/codex high` on `gpt-6.1-sol` over the diff and the verification record. Stop at 3 rounds.
Then open a PR with `Closes #103`, run `gh pr checks --watch`, and send
`DONE presto-fixture: <PR url>; CI <state>`.

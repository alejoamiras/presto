# ci-1 recon

Base: `origin/main` @ f8a9f3b (2026-10-25). One read-only Explore agent (sonnet) plus the planner's
own checks against GitHub. #169's head is 49110f1, one commit, and its merge base is f8a9f3b: no
drift between the PR and `main`.

## Reuse map

| Capability needed | Existing code | Verdict |
|---|---|---|
| Dependabot's nine `uses:` edits | #169's commit 49110f1 (`_aztec-update.yml` ×2, `release-bot-token-check.yml`, `release-presto.yml`, `release-sdk.yml`, `sign-verified-sites.yml`; `setup-presto/action.yml`, `_e2e.yml`, `dependency-audit.yml`) | reuse-as-is (apply its diff byte for byte) |
| The App-key tripwire | `scripts/verified-sites-workflows.test.ts:103-107`, the only literal app-token SHA in any test | adapt: the two strings at :105-106 |
| Pin and label policy | `scripts/action-pins.test.ts` (40-hex SHA, `# vX.Y.Z`, `# v1` for `dtolnay/rust-toolchain`, one SHA and one label per action) | reuse-as-is; it fails on a partial bump |
| A helper that derives the SHA from workflow text | none (searched `scripts/*.ts`, `packages/*/scripts` for `@[0-9a-f]{40}`, `uses:`, `dtolnay`; `action-pins.test.ts`'s `externalUses()` is file-local) | not built: deriving the SHA makes the tripwire pass by itself |
| Docs naming either version or SHA | none outside `audit/` and `implementations-plan/archive/` (searched README, CLAUDE.md, AGENTS.md, CONTRIBUTING.md, `docs/`, `lessons.md`, `follow-ups.md`) | not applicable |

## Other tests that read these files (not affected)

- `scripts/verified-sites-workflows.test.ts:131-135` matches the step by substring and asserts
  `permission-contents` / `permission-pull-requests`; `:158` compares `uses` with the `@sha` cut off.
- `scripts/complexity-policy.test.ts:76-92` reads the three rust-toolchain files for `toolchain:`
  only. `packages/presto/scripts/ci-filter-contract.test.ts:172-185` reads `save-if` only.
  `scripts/sdk-release-contract.test.ts:210` concerns `actions/setup-node`.

## How the tests run

- Local: `bun run test` → `lint` + `test:typecheck` + `test:unit`, which ends in `test:scripts`
  (`bun test scripts/*.test.ts scripts/tarball-consumer/*.test.ts`).
- CI: `presto.yml` job "Lint" (`bun run lint` + `bun run test:scripts`) and `_ts-package-ci.yml`
  "Unit Tests" (called by `sdk.yml`, `sdk-core.yml`, `sdk-noir.yml`, `banners.yml`).
- Routing: `scripts/**` routes presto's `release_tooling` and every TS package gate;
  `.github/actions/setup-presto/**` routes the heavy presto lanes and `app.yml`;
  `.github/workflows/**` routes `actionlint.yml`. No PR-triggered workflow mints the App token.

## Collision and dedup risks

- A hand edit that misses one of the nine lines fails `action-pins.test.ts` (split SHA or label).
- Open PRs: #169 only. Issues mentioning `create-github-app-token`, `client-id` or `app-id`: none.
  Closed `known-limit` issues on action pins: none.
- Convention: past action-group bumps squash as `chore(ci): …` (044cd2f, #112). No earlier PR edited
  this test for a bump.

# Phase 9 — `_publish-npm.yml` and the `release-sdk.yml` package DAG

Date: 2026-09-08. Branch `presto-noir/npm-tooling` (arc 2).

## What landed

- `scripts/release-plan.ts`: the release decision as a pure function over gathered facts —
  `publish` / `reuse` / collision per package, `workspace:` dependency pins, and the list of checks
  that must be deferred until a dependency published in the same run is verified. `orderByDependencies`
  puts dependencies first. The CLI gathers facts (npm versions; for an already-published manifest
  version: the release tag commit, the verified provenance commit, and `git diff` of the package
  directory since that commit) and writes `plan`, `summary`, and per-key `publish_*` / `version_*` /
  `deps_*` outputs, so workflow conditions are plain string compares. Tests cover: `all` ordering,
  revision suffix, a previously unpublished core (adapter checks deferred), a published-tagged-unchanged
  core (reused, nothing deferred), collision cases (tag/provenance disagree; sources moved), and an
  unselected dependency that must already be on npm.
- `.github/workflows/_publish-npm.yml` replaces `_publish-sdk.yml`: inputs `package`, `dist_tag`,
  `release_asset`, `dependency_versions`; the package name, directory, and version mode come from the
  descriptor at run time; every script call passes `--package`; the consumer runs with the package key;
  `--tag "$DIST_TAG"` comes from an env var, never interpolated into the shell.
- `.github/workflows/release-sdk.yml`: `packages` choice (`presto` default, `presto-core`,
  `presto-noir`, `all`) and `dry_run`; a `plan` job after `assert-main` that records the plan in the
  step summary; `publish-core` → `publish-presto` / `publish-noir` (both wait for core: success or
  skipped); `deploy-app` follows `publish-presto`. Only the three `publish-*` jobs carry
  `id-token: write`; `dry_run` skips e2e, audit, publish, and deploy.
- `sdk-release-contract.test.ts` is parameterised over the descriptor: every key is a dispatch choice
  with its own gated publish job; OIDC appears exactly once per publish job and nowhere else; no
  `NPM_TOKEN`; consumer before publish; verification before records.
- Runbook: trusted-publisher registration per npm name is an owner action before a first publish;
  `packages` / `dry_run` usage; plan semantics; fix-forward recovery after a partial publish.

## Notes

- `presto-core` and `presto-noir` are dispatch choices and publish jobs already, but until their
  descriptor entries land (arcs 3 and 4) the plan job fails loud on them and the publish jobs stay
  skipped (`publish_presto_core` is empty). Selecting `presto` behaves exactly as before.
- `release-sdk.yml` `dry_run` asserts `refs/heads/main`, so it cannot be exercised from this branch;
  running it from main after merge is a Delivery follow-up for the owner.

## Gate

`bun run lint:actions` ✓ · `bun run test:scripts` ✓ · `bun run typecheck:scripts` ✓ · biome ✓ ·
`sdk.yml` dispatched on `presto-noir/npm-tooling`: see the run link appended below.

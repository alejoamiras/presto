# Phase 12 — CI: `_ts-package-ci.yml`, `sdk.yml` package input, `sdk-core.yml`

Date: 2026-09-08. Branch `presto-noir/sdk-core` (arc 3).

## What landed

- `.github/workflows/_ts-package-ci.yml` (`workflow_call`, inputs `package`, `e2e_presto`): `resolve`
  (descriptor → dir), `lint` (repo-wide), `typecheck`, `unit-tests` (+ `test:scripts`,
  `typecheck:scripts`), `tarball-consumer`, and an optional `e2e` that calls `_e2e.yml` with
  `build_presto: true`. No `id-token` anywhere.
- **Bootstrap mode** for the consumer: `scripts/pack-candidate.ts --package <key>` builds and packs
  the candidate together with every `workspace:` dependency (dependencies first, each at its own
  manifest version, the dependant pinned to exactly that through `preparePublishManifest`; the
  manifest is restored in a `finally`). It prints `tarball=` and `with=name=path,...`, also to
  `$GITHUB_OUTPUT`. `sdk-tarball-consumer.sh <tarball> [key] [--with name=tarball ...]` installs
  those as `file:` dependencies beside the candidate (`host-manifest.ts` gained the `local` map; an
  entry naming the tested package is rejected like a profile extra). npm satisfies the SDK's exact
  core pin from the root `file:` copy, so nothing is fetched from the registry. `_publish-npm.yml`
  keeps calling the consumer without `--with`: the release rerun resolves core from npm.
- `sdk.yml`: `workflow_dispatch` input `package` (choice over the descriptor keys, default
  `presto`); `changes` filter gains `packages/sdk-core/**` and the reusable; the job graph is
  `changes → ci (reusable, e2e only for presto) → sdk-status`.
- `sdk-core.yml`: thin `pull_request` + `workflow_dispatch` caller with `package: presto-core`.
- `app.yml`: both filters gain `packages/sdk-core/**`.
- `scripts/ts-package-ci.test.ts` pins: reusable shape and bootstrap consumer call; registry-mode
  consumer in the publish workflow; every descriptor key is an `sdk.yml` dispatch choice; the thin
  caller; the app filter. `pack-candidate.test.ts` covers ordering, cycles, and pins.

## Notes

- `pack-candidate.ts` must `mkdir -p` its `--out` (the first local run failed on the manifest
  backup copy because the directory did not exist).
- `sdk.yml`'s `inputs.package` is empty on `pull_request`; `inputs.package || 'presto'` keeps the PR
  gate on the SDK pipeline and the e2e condition compares the same expression.
- The `noTemplateCurlyInString` biome warning on workflow-string assertions: use `toMatch` with a
  regex instead of a string containing `${{ }}`.
- Local reproduction of both consumer jobs: `presto` with `--with` (packed core; exact-host
  `@aztec/stdlib` singleton, typecheck + runtime load OK) and `presto-core` (no pin; OK).

## Gate

`bun run lint:actions` ✓ · `bun run test:scripts` 170 ✓ · `bun run test` exit 0 ·
`sdk.yml` dispatched on `presto-noir/sdk-core`:

| Head | `package=presto` | `package=presto-core` |
|---|---|---|
| ca9a1c8 | 34188806696 — SDK E2E failed (legacy tarball lost `ms`; fixed in the arc-3 loop), all else green | 34189058843 green (first dispatch 34188800186 was cancelled by the shared concurrency group; fixed in the loop) |
| 8647117 | 34190048536 green (E2E included) | 34190050406 green, concurrent with the presto lane |
| 8dc7ac0 (arc head) | 34190787712 | 34190789910 |

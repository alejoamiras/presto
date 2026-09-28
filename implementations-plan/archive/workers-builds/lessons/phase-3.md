# Phase 3 — Retire the Actions deploy paths, add the CI and release pieces

- **`bump-playground` keeps `deploy-app`'s e2e and audit gates.** The plan listed only `plan` and
  the publish jobs as needs; a noir reuse-only run would then have raised the pin without the
  release's e2e or dependency audit passing. Recorded in `plan.md`.
- **`result="$(bun …)"`, not `echo "result=$(bun …)"`.** Under `bash -e`, a failing command
  substitution inside an argument does not fail the step; an assignment does.
- **The routing test derives its list instead of copying it.** It walks `workers-build.ts` and
  `published-playground.ts` through `Bun.Transpiler.scanImports`, so a new import on the production
  path fails the test until `app.yml`'s `published` filter names it. Mutation-checked both ways:
  dropping `npm-pack-result.ts` from the filter fails it, and adding `scripts/tarball-consumer/**`
  fails it on `host-dependencies.json` (the codex round-2 deadlock).
- **Found, not fixed (out of scope):** `_aztec-update.yml` stages `packages/*/package.json bun.lock
  aztec.ts copy-bb.ts`, but `update-aztec-version.ts` also rewrites
  `scripts/tarball-consumer/presto-noir/host-dependencies.json` (its `@aztec/bb.js` pin). The step's
  own `git diff --exit-code` guard should then fail every Aztec update PR. Filed in `follow-ups.md`.
- `bun run lint:actions` exit 0; contract tests 37 pass across the three files.

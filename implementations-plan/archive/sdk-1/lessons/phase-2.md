# Phase 2 (a2): the version transition

## Banners (2026-10-27)

- The orchestrator asked for presto-banners `1.1.0` → `1.1.1`, from CLAUDE.md's
  "manifest-versioned, 1.1.0".
- The tree disagreed. The manifest is `1.2.0`, the tag `@alejoamiras/presto-banners@1.2.0` is
  `b46898f`, and npm lists `1.2.0`. So the bump is `1.2.0` → `1.2.1`, and CLAUDE.md is corrected.
- The reason held. Since the `1.2.0` tag, #189 changed `packages/banners/package.json` (happy-dom
  `^20.12.0` → `^21.0.4`) and `src/test-setup.ts`. `release-plan.ts`'s own `lockfileSlice` also
  differs between the tag's `bun.lock` and `main`'s.
- The same check confirms core and noir: their directories changed since `1.2.1` and `2.0.0`.
- `1.3.0`, `2.1.0` and `1.2.1` exist nowhere yet: not on npm, not as tags, not as GitHub releases.

## Gate

- `bun install` changed exactly the three workspace version lines in `bun.lock`.
- `bun install --frozen-lockfile` exit 0. `bun run lint` exit 0, with the same 5 warnings in files
  this arc does not touch. `bun run test` exit 0, with 10 suites at 0 fail.
- The tree is clean. The scope check lists the three manifests, `bun.lock`, the noir README and
  `CLAUDE.md`. None of them is in `app.yml`'s `published` filter.

# Phase 1 — core helpers and re-exports

## What shipped

- `packages/sdk-core/src/lib/loopback-permission.ts`: `loopbackPermission()` and
  `watchLoopbackPermission()`, one query path (`loopback-network`, then `local-network-access` only
  when the first name is rejected), `navigator.permissions` read on every call.
- The transport's private denied check now delegates to it; the three landing/playground copies are
  removed in phases 4–5.
- Re-exported from `presto` and `presto-noir`; contract tests and the three consumer fixtures pin
  the names. The fixtures' runtime checks also assert `loopbackPermission()` resolves `unsupported`
  in Node, which has no Permissions API.
- `presto-core` and `presto-noir` at `1.2.0`; noir README compatibility row added.

## Gate

- `bun run test`: exit 0 (sdk-core 193, SDK 20, sdk-noir 39, banners 29, playground 82, presto
  scripts 105, release-feed 4, root scripts 198).
- Tarball consumer (the `_ts-package-ci.yml` steps, run locally through a scratch wrapper):
  `presto-core`, `presto`, `presto-noir` all typecheck against the packed dist and load at runtime.

## Notes

- The worktree guard rejects shell loops that run scripts which may invoke git; run each tarball
  check as its own command.
- A pre-existing Biome warning (`scripts/sdk-release-contract.test.ts:85`,
  `noTemplateCurlyInString`) is not ours and does not fail the lint.

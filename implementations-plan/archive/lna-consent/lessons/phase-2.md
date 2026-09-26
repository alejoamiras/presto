# Phase 2 — docs, examples and agent pointer

## What shipped

- `packages/sdk/examples/consent.ts`: `askBeforeConnecting(prover, onStatus)` → `{connect,
  beforeProving, stop}`. It is typechecked by `test:lint` (`tsc -p examples`) and is not packed. The
  plan's draft names `resumePresto()`/`connectPresto()` became one function: load-time connection on
  `granted` happens inside it, so an integrator cannot forget that path.
- `packages/sdk/src/lib/docs-examples.test.ts` runs that module on a real `PrestoProver` (WASM
  simulator, recorded `fetch`, stubbed `navigator.permissions`) and lints every ts/js block (and
  every html `<script>`) in the five integration docs.
- SDK README "Ask before you probe"; SKILL.md got the same section, gated steps 2–6, the "probing on
  load is unsafe" warning and a checklist; the root, noir and banners READMEs and PLATFORM_SUPPORT
  are gated or point to that section; `packages/sdk/AGENTS.md` ships (`files`); the contract test
  pins the heading, both helpers and `AGENTS.md` in `files`.

## Gate

- Red first: before the doc edits, `docs-examples.test.ts` had 4 passing and 2 failing tests (the
  lint and the verbatim check).
- `bun run test`: exit 0 (sdk-core 193, SDK 27, sdk-noir 39, banners 29, playground 82, presto
  scripts 105, release-feed 4, root 198).
- Tarball consumer `presto`: `TARBALL_CHECK_OK presto` (typecheck + runtime import from the packed
  dist).
- `npm pack --dry-run` in `packages/sdk`: `AGENTS.md` and `.claude/skills/presto/SKILL.md` listed;
  grep exit 0.

## Notes

- Biome rewraps `examples/consent.ts` (a trailing comment on an `if` without braces went onto its
  own line), which broke the verbatim copies. Keep comments on their own lines in quoted modules,
  and re-sync the docs from the file with a script, never by hand.
- `noExcessiveLinesPerFunction` (80) counts a `describe` callback, so hoist fixtures to module
  scope.
- `src/**/*.test.ts` already shipped in the tarball before this change (`files: ["src", ...]`). The
  new test ships too and imports `examples/`, which does not. That is pre-existing packaging, left
  out of scope.

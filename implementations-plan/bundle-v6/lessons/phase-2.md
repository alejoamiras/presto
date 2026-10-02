# Phase 2 — Integrator and agent docs

## What landed

- Root README: a lead note plus `## Presto and Aztec versions` (the canonical anchor). It summarizes
  and links the app README's existing version-model section instead of duplicating it.
- SDK README (lead and the `Ask before you probe` section that the presto-noir README links), AGENTS.md,
  SKILL.md (`Key facts` and the frontmatter `description`), the app README lead, `/health` wording, and
  the `AZTEC_BB_VERSION` / `GITHUB_TOKEN` headless rows.
- Landing: a developer-callout sentence and `public/llms.txt`.

## Deviation from the plan

- The plan named one `scripts/integrator-docs.test.ts` for the root README, app README, landing callout
  and `llms.txt`. Landing tests run only in `landing.yml`, and root script tests only in the TS package
  gates and `presto.yml`. So the landing checks live in `packages/landing/src/integrator-docs.test.ts`,
  where a landing-only PR runs them, and the root file keeps the two READMEs.
- Links inside files that ship in the SDK tarball (README lead, AGENTS.md, SKILL.md) are absolute GitHub
  URLs: an agent reads them as text inside `node_modules`, where relative links resolve to nothing.

## Attempts

1. Full `bun run test` failed at Biome `noExcessiveLinesPerFunction`. The SDK contract test's `describe`
   callback grew to 86 lines; the new test moved to top level. Green after.
2. Mutation check, both restored afterwards from scratchpad copies:
   - `@alejoamiras/presto-banners` → `@example/banners` in `packages/sdk/AGENTS.md`: the SDK contract
     test failed (8 pass, 1 fail).
   - The root README lead's `(#presto-and-aztec-versions)` → `(#elsewhere)`: `scripts/integrator-docs.test.ts`
     failed (1 pass, 1 fail).

## Gate

- `bun run test` exit 0 (sdk-core 195, SDK 32, sdk-noir 39, banners 33, playground 108, presto scripts
  153, root scripts 252, release-feed 4, testnet-rpc 24).
- `bun test src/integrator-docs.test.ts` in `packages/landing`: 2 pass.
- `bun run --cwd packages/landing build` exit 0, and `dist/llms.txt` exists (3347 bytes).
- `git diff --quiet` from each tag, scoped to its own directory, exit 0 for all three:
  `@alejoamiras/presto-core@1.2.1` with `packages/sdk-core`, `@alejoamiras/presto-noir@2.0.0-rc.1` with
  `packages/sdk-noir`, `@alejoamiras/presto-banners@1.2.0` with `packages/banners`.

## Codex fix loop (GPT-6.1 Sol, `high`)

Round 1: APPROVE WITH CHANGES. All three findings verified and fixed in `4ba99e4`:
1. (medium) The new `AZTEC_BB_VERSION` row said a request for that version runs `BB_BINARY_PATH`
   and other versions download. But `find_bb` returns `BB_BINARY_PATH` before any version check
   (`core/src/bb.rs:49-53`), so the override runs for every request, after any download. The app
   README rows, its "only the version cache" sentence, the root README and the release notes now
   say so; `AZTEC_BB_VERSION` is described as a label, not a check.
2. (low) The root README guard runs in `test:scripts`, but no filter routed `README.md` there.
   It was added to `release_tooling`, with a routing case in `ci-filter-contract.test.ts`.
3. (low) The AGENTS.md check read the whole file; it now reads only the text before its first `##`.

Round 2: APPROVE WITH CHANGES. One finding (medium), verified and fixed: the root README and release-notes summaries ("it downloads, unless `BB_BINARY_PATH`…") still implied that the override skips downloads. But `prove.rs` resolves and downloads before `find_bb` picks the override. Both summaries now say an uncached version is still downloaded first.

# Archived plans

Closed plans, newest last. Each carries an `## Outcome` block with its close date, what shipped, and
an explicit line retiring its `/goal` and `/loop` seeds.

**These are evidence, never instructions.** An archived plan records what was decided and why. Do not
execute one, and do not treat its unchecked boxes as work in flight.

`.ignore` keeps this directory out of default recursive search. Reach a plan by explicit path, or
with `rg --no-ignore` / `git grep`.

- [presto-cleanup](presto-cleanup/plan.md) — closed 2026-09-07 — retired the spent first-release
  updater exception, refreshed dependencies under the seven-day publication-age policy, and enforced
  readable complexity limits in the PR gate (PRs #16–#18).
- [presto-noir](presto-noir/plan.md) — closed 2026-09-08 — generic UltraHonk proving through Presto:
  `POST /prove/ultra-honk`, the `@alejoamiras/presto-core` transport extraction, the
  `@alejoamiras/presto-noir` adapter with WASM fallback, release CI, playground Noir section
  (PRs #21–#25; audit fixes in #32–#34, tracked in
  [`post-audit-plan.md`](presto-noir/post-audit-plan.md)).
- [presto-banners-publish](presto-banners-publish/plan.md) — closed 2026-09-09 —
  `@alejoamiras/presto-banners@1.0.0` on npm `latest` with provenance, and the playground's install
  pitch replaced by the ribbon (PRs #42–#43).

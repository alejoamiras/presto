# deps-1 phase 0: planning consults

## Recon (2026-10-25)

- Two Sonnet explorers: a reuse sweep over eight capabilities, and the wrangler blast radius. Both
  returned; findings are in `recon.md`.
- Trial bump in a scratch copy of the tree (`git archive HEAD`), outside the repo: wrangler 4.151.1,
  no `sharp` override, plain `bun install` on bun 1.4.2. The lock diff was closure-only. Without
  regenerated types, `wrangler types --check` failed. The release-feed and testnet-rpc dry-runs
  passed, and so did the landing dry-run after `vite build`.
- Baseline audit on unchanged `main` exits 1 (zod, happy-dom, undici GHSA-xjj6). CI run
  40026882402 (2026-10-23) was the first red one. The scheduled run on 2026-10-19 passed.
- A live probe of the bulk advisory endpoint with the bundled tree (141 names, 143 versions) returned
  HTTP 200. Every bundled directory path equals its `package.json` name; there are no symlinks, and
  every version is exact semver.

## Codex plan audit, round 1 (gpt-6.1-sol, high)

Session `01a170e0-ad33-7683-a4a0-a065152af311`. Verdict: **conditional approve**. The conditions:
validate advisory records and package identities and versions; specify and test symlink handling;
bound the claims about install equivalence; strengthen T1-T3. Triage is in plan.md's Audit verdicts.

## Plan agent audit, round 1 (Opus, fresh)

Verdict: **conditional approve**. The conditions: strict advisory validation; Workers Builds checks
in the phase 1 gate; Outcome scoped to `bundleDependencies` (wrangler's esbuild bundle is invisible,
KL-1); start the walk under the root's `node_modules` and throw on symlinks; inject `fetch` only; pin
4.151.1; a step that files the red-audit issue; `.bun-version` and `bunfig.toml` in the audit's paths;
trim. All accepted. Triage is in plan.md.

## Red audit filed as #172 (2026-10-25)

Dedupe searches (`zod`, `happy-dom`, `undici`, `dependency audit`, `audit red`) found only #101,
which is closed (the earlier red audit). Filed #172 with the `dependencies` label.

## ORCHY-STEER: arc a3 (#172) added after round 1

- Trial `undici` splice on the wrangler-bumped lock: 8 lines, the frozen install passes, and only
  miniflare's 7.29.1 stays below the fix.
- A first try that dropped lock entries with a script broke the lock's JSON. Bun then re-resolved
  the whole tree (`lockfileVersion` went 1 → 2, with dozens of unrelated bumps). Never delete lock
  entries by script without validating the JSON.
- A full re-resolve (from the corrupted lock) kept `cheerio/undici` at 7.29.1. After the
  ORCHY-STEER (no hand splice), `bun update undici` on the valid lock moved every caret copy, cheerio's
  to 7.30.1 included, in 8 lines. The frozen install passes, and a later `bun install` changes nothing.
  Bun's own mechanism is enough, so nothing goes in by hand.
- `@happy-dom/global-registrator` is also a banners devDependency. Bumping only the playground would
  leave the advisory.

## ORCHY-STEER: no hand splice

`bun update undici` replaced the hand splice. Its result is identical, and it comes from Bun's
resolver.

## Final Codex pass (fresh session `01a170f1-2ade-73b0-91a8-fe4ffa77b8a4`)

Verdict: **conditional approve**, on three conditions:
- drop the lock-splice fallback in phase 1;
- correct the `zod` acceptance rationale (exhausting client memory goes beyond data trust);
- make arc 2's delivery conditional on stacking.

All three are applied. The verify-only resume returned **VERDICT: approve**.

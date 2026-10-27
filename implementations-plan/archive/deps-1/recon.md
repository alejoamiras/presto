# deps-1 recon

Base: `origin/main` at 80b562e, read 2026-10-25. Two Sonnet explorers (reuse sweep, wrangler blast
radius) plus direct checks by the planner. A trial bump ran in a scratch copy of the tree, outside
the repo.

## Reuse map

| Capability | Found | Verdict |
|---|---|---|
| Read the playground's npm pin | `scripts/workers-build.ts:69` `pinnedNpmVersion(manifest)`: exact 11.x+ or throws; module guarded by `import.meta.main` | reuse-as-is |
| Locate the pinned npm on disk | nothing exposes `packages/playground/node_modules/npm` (searched `pinnedNpm\|PINNED_NPM\|node_modules/npm` in `scripts/`, `.github/scripts/`, `packages/playground/scripts/`) | build new (one constant) |
| Walk a `node_modules` tree for name@version | `scripts/aztec-installer-graph.ts:44-66` `installedAztecPackages`: skips dotfiles, descends `@scope/*`, recurses nested `node_modules`, skips symlinks, tolerates ENOENT; Aztec-filtered through `record()` | adapt (same walk, fail-closed, no filter) |
| POST to the npm registry | only GETs exist: `scripts/promote-sdk-latest.ts:84-95`, `scripts/sdk-release-verification.ts:140`; style `if (!response.ok) throw new Error("… failed: HTTP N")`; no fetch uses a timeout | build new, same error style |
| Request deadline | `scripts/registry-consistency.ts:33` `NPM_TIMEOUT_MS = 180_000` (for `spawnSync`) | reuse the constant |
| Parse advisories | `scripts/dependency-audit.ts:92` `parseBunAudit(Record<string, BunAdvisory[]>)`; the bulk endpoint answers the same shape (`id,url,title,severity,vulnerable_versions,cwe,cvss`, probed live) | reuse-as-is, then set `source` |
| Gate a finding | `evaluateFindings` / `classifyFinding`: npm high/critical block unless an unexpired exception matches `ecosystem:id:package` | reuse-as-is |
| Temp trees and fetch stubs in tests | `scripts/aztec-installer-graph.test.ts:6-35` (`mkdtempSync` + `afterEach` cleanup); `scripts/download-bb.test.ts:45-54` (`globalThis.fetch` swap, restored in `afterEach`) | reuse the patterns |
| Committed `node_modules` fixture | root `.gitignore:2` ignores `node_modules` at any depth (`git check-ignore` confirmed) | rejected; build the tree in the test |
| Parse `bun.lock` | regex scans only (`scripts/bunfig-aztec-excludes.test.ts:24`), `lockfileSlice` private to `release-plan.ts` | not needed |

## Facts the plan rests on

- `package.json:57-61` overrides `sharp` 0.35.5, `systeminformation`, `ws`; `:77` pins `wrangler` 4.135.0.
- The only `sharp` dependent in `bun.lock` is `miniflare@5.20260918.0-alpha` (exact `sharp` 0.35.4).
- npm registry, 2026-10-25: wrangler 4.150.0 is the first release whose miniflare pins `sharp` 0.35.5.
  The newest stable past the 7-day gate is **4.151.1** (2026-10-16), with miniflare
  5.20261012.1-beta, workerd 1.20261012.1, esbuild 0.28.2 and `@cloudflare/unenv-preset` 2.16.2, all
  older than 7 days. 4.151.2 clears the gate on 2026-10-26, 4.151.3 on 10-27, 4.152.0 on 10-29.
  Every 4.150+ miniflare pins `undici` 7.29.1 and `sharp` 0.35.5.
- Trial (`bun` 1.4.2, the `.bun-version`): wrangler 4.151.1 and no `sharp` override gave a 131-line
  lock diff. It touched only wrangler's closure (wrangler, miniflare, `miniflare/undici`, workerd and
  `@cloudflare/workerd-*`, `@cloudflare/unenv-preset`, `esbuild` and `@esbuild/*`, with `tsx/esbuild*`
  deduped into the root esbuild 0.28.2) and the override line. The re-dedupe drift that
  `lessons.md` records for bun 1.4.0 did not happen.
- Trial: `wrangler types --check` fails until `bun run --cwd packages/release-feed types` regenerates
  `worker-configuration.d.ts` (+588/-44). After that, `release-feed typecheck` passes. The lesson's
  citation (`archive/rc-update-channel/lessons/phase-7.md`) does not contain this fact; the trial does.
- Trial: `wrangler deploy --dry-run` passes for release-feed and testnet-rpc. Landing passes after
  `vite build`, which is the same order as `landing.yml:63-72`.
- Trial `bun audit` difference: ten `undici` advisories gone (the two excepted highs GHSA-rfgv-xxqx-mfg5
  and GHSA-w293-vg96-wgc3 among them), none added, no `sharp` entry.
- The pinned npm 11.21.1 resolves to `node_modules/.bun/npm@11.21.1/node_modules/npm`. After
  `bun install --frozen-lockfile` it holds 141 names and 143 versions under `node_modules/npm/node_modules`:
  two nested trees (`minipass-pipeline/node_modules/{minipass,yallist}`,
  `tinyglobby/node_modules/{fdir,picomatch}`), scoped dirs, no symlinks, no hidden lockfile.
- #167's example holds: the bundle carries `ip-address` 10.7.2; `bun.lock:2669` records
  `npm/ip-address` 10.5.0. The bulk endpoint returns `ip-address` 10.7.2 GHSA-rxp7-6hxx-x8q5 (moderate)
  and bundled `undici` 6.29.0 GHSA-xjj6-f33q-929c (high) and GHSA-4qv8-2p9j-2685 (moderate). The answer
  is filtered by version: the 10.5.0 advisories the lock audit shows do not appear.
- **The audit is red on `main` today, apart from this lane.** A local run on 80b562e exits 1 with
  four BLOCKED lines:
  - `zod` GHSA-mrhx-c7xc-m3w5 (`@aztec-labs/*` 6.0.0 require `~4.4.3`; the fix is 4.6.6);
  - `happy-dom` GHSA-834v-8h66-3h79 (playground devDependency `^20.12.0`; the fix is 21.0.4, a major);
  - `undici` GHSA-xjj6-f33q-929c, twice (the 6.x and 7.x ranges). The fixes are 6.29.1 and 7.30.1, but
    every miniflare past the gate exact-pins 7.29.1, and npm 11.21.1, the newest 11.x, bundles 6.29.0.

  CI run 40026882402 (PR #169, 2026-10-23) was the first red run, on `zod` alone. The scheduled run on
  2026-10-19 passed. Both release workflows gate on this job (`docs/RELEASE_RUNBOOK.md:142`).
- The `braces` exception has printed STALE since at least 2026-10-23. That is not this lane's work.
- `Audit dependencies` is not a required check. The ruleset requires SDK, App, Presto and Actionlint Status.
- `packages/presto/scripts/ci-filter-contract.test.ts:204-222` pins the audit workflow's triggers and
  paths with `toContain`, so appending a path is safe.
- `docs/RELEASE_RUNBOOK.md:142` describes the audit's sources; it is the one doc to update.

## Collisions

- `implementations-plan/follow-ups.md:11-22` carries the undici expiry and #106. This lane resolves
  both entries.
- `release-1` (a sibling lane) owns release-path scripts; `registry-consistency.ts` is not in its list.
  Importing its constant is read-only. Open #132 (deadlines on the release path) is adjacent, not
  overlapping.
- No closed `known-limit` issue covers the audit, the allowlist, npm or wrangler.

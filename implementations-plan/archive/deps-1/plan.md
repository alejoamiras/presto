---
plan: deps-1
tier: mid
driver: claude-code
claude_model: opus
codex_model: sol
code_review: off
explainer: off
eli5_mode: skipped (orchestrator-owned)
quality_bar: production
trunk: main
base: 80b562e
issues: [106, 167, 172]
asks: none
---

## Outcome

- **2026-10-27: completed** in three PRs: #175 (arc 1), #181 (arc 2) and #189 (arc 3, with this
  close-out). Together they close #106, #167 and #172.
- **Shipped**:
  - #106: wrangler 4.151.1 and no `sharp` override; miniflare's own pin supplies `sharp` 0.35.5. The
    two `undici` exceptions that the bump cleared are removed.
  - #167: `audit:dependencies` also audits the pinned npm's `bundleDependencies` tree (141 packages)
    through the registry's bulk advisory endpoint. It fails closed on every malformed input.
  - #172:
    - `bun update undici` moved every caret copy to its fixed release;
    - `happy-dom` is 21.0.4 in the playground and banners;
    - the owner's P4-01 accepts `zod` and `undici` until 2026-11-30;
    - the audit on the final head reports 0 blocked.
  - The stale `braces` exception is gone: GitHub withdrew GHSA-vfj7-8cjw-p6xm on 2026-10-23.
- **Changed in review**:
  - named errors for a malformed manifest and a non-JSON answer (arc 1);
  - phase 4's gate requires 0 blocked (arc 2).
- **Dropped**:
  - a hand splice of `bun.lock` and a root `undici` override (D3);
  - a stacked arc 2 (D18);
  - a canary against registry omissions (D13).
- **Known limits:**
  - #187 (KL-1): code that esbuild inlined into wrangler's `cli.js`;
  - #188 (KL-2): same-version tampering, and registry omissions.
- **Open items:** none. The eleven exceptions that expire on 2026-11-30 are in `follow-ups.md`. The
  next banners release must bump its version (F9), which `release-plan.ts` enforces.
- **Seeds retired**: the `/goal` and `/loop` lines below are not instructions.

# deps-1: bump wrangler, drop the sharp override, audit npm's bundle, clear what bumps can clear

Size: about 400 lines against the 350 target. It covers three issues in five phases over three arcs,
with restatement already cut.

## Outcome & Quality Bar

**For whom.** The maintainer who reads `bun run audit:dependencies` before a release. The playground's
Workers Build, which runs the pinned npm next to the account-wide deploy token.

**What excellent looks like.**
1. Each override in `package.json` has a reason that still holds. `sharp` comes from miniflare's own
   pin.
2. The audit also checks npm's `bundleDependencies` tree, which the lock does not record. A bundled
   high or critical advisory blocks the audit, as a lock finding does.
3. The audit fails closed. It stops with a message that names the cause, and never passes silently,
   on: a missing or wrong npm install, an empty or malformed tree, a symlink inside the bundle, a
   registry error, or a malformed answer.
4. A bundle finding names its source (`npm 11.21.1 bundle`), and the run prints what it sent.
5. Every blocked advisory that an in-range bump can fix is fixed. The rest wait for the owner's pick
   (`OWNER-ASKS.md`), with the facts the owner needs to choose.

**Good enough.** No new allowlist semantics, no per-copy keys, no audit at Workers Build time, no
change to how severity blocks lock findings.

## UI impact

Recorded owner decisions for this lane: **none: nothing a person sees changes.** Merges redeploy
both sites from identical assets; only the audit's terminal output gains lines. `OWNER-ASKS.md` holds
one security-acceptance ask (allowlist entries); it concerns no surface a person sees. It is now answered:
**P4-01** (decision page 4, Release audit exceptions; delegated by the owner, recorded by the
orchestrator 2026-10-25): **Option A** — the allowlist accepts the `zod` and `undici` entries until
2026-11-30, each with its reason and removal condition (Ask 1 wording: one `zod` entry, one `undici`
entry covering the miniflare and npm-bundle copies).

## Issue and ask map

| Item | Arc | Disposition |
|---|---|---|
| #106 | arc 1, phase 1 | `Closes #106`. Its purpose holds: no override, and no `sharp` advisory. Its "audit green" step cannot hold (F-red) |
| #167 | arc 1, phase 2 | `Closes #167` |
| #172 (filed by this plan) | arc 2 (phases 3, 5), arc 3 (phase 4) | arc 2 `Refs #172` (the audit stays red on `happy-dom`); arc 3 `Closes #172` once the audit is green |
| asks | none | the lane brief names none |

Arcs: arc 1 (#175, merged as b85134c) is the orchestrator's a1 and a2. The orchestrator regrouped a3
(D19): arc 2 is phases 3 and 5 now, and arc 3 is phase 4 plus the close-out, on or after
2026-10-27T18:06Z, when `happy-dom` 21.0.4 clears the age gate.

## Assumptions

**Facts** (evidence in `recon.md` and `lessons/phase-0.md`):
- F1. `package.json:58` overrides `sharp` 0.35.5, and `:77` pins `wrangler` 4.135.0. miniflare is the
  only `sharp` dependent in `bun.lock`.
- F2. In the versions checked through 2026-10-25, every wrangler from 4.150.0 to 4.152.0 pins a miniflare
  with exact `sharp` 0.35.5 and `undici` 7.29.1. 4.151.1 (2026-10-16) is the newest stable release
  past the 7-day gate, and every new transitive in it is older than 7 days.
- F3. Trial with 4.151.1 (bun 1.4.2): the lock diff is closure-only. `wrangler types --check` fails
  until the types are regenerated. Both excepted `undici` highs clear (GHSA-rfgv-xxqx-mfg5,
  GHSA-w293-vg96-wgc3), and no advisory is added.
- F4. After `bun install --frozen-lockfile`, the pinned npm's bundle has 141 names and 143 versions
  (113 top-level, 26 scoped, 4 nested). It has no symlink inside, and each path equals its manifest
  `name`. No bundled package has an install script, so CI and Workers Builds' `--ignore-scripts` get
  the same tree. #167's example holds (bundle 10.7.2, lock 10.5.0).
  `packages/playground/node_modules/npm` is itself a symlink into `node_modules/.bun/`.
- F5. The bulk advisory endpoint answers `Record<name, advisory[]>`, filtered by version.
  `parseBunAudit` reads that shape, and it maps an unknown severity to `unknown`, which does not block.
- F6. Workers Builds watch `package.json`, `bun.lock` and `scripts/*`. A merge redeploys both sites
  with the locked wrangler. PRs run the checks `Workers Builds: presto-landing` and `Workers Builds:
  presto-playground`. The repository squash-merges.
- **F-red** (#172). On 80b562e the audit exits 1 on `zod` GHSA-mrhx-c7xc-m3w5, `happy-dom`
  GHSA-834v-8h66-3h79 and `undici` GHSA-xjj6-f33q-929c. This lane does not cause them, and the release
  workflows gate on this audit.
- F7. Trial `bun update undici` on top of the wrangler bump changes only `bun.lock`, in 8 lines:
  - root `undici` and `npm/undici` move 6.29.0 → 6.29.1;
  - `webdriver/undici` 6.28.1 goes, because root satisfies `^6.27.0`;
  - `cheerio/undici` moves 7.29.1 → 7.30.1.

  The frozen install passes, and a plain `bun install` afterwards changes nothing. Only miniflare's
  exact 7.29.1 stays below the fix.
- F8. `@happy-dom/global-registrator` `^20.12.0` is a devDependency of **both** `packages/playground`
  and `packages/banners` (their test preloads). The fixed 21.0.4 clears the gate at
  2026-10-27T17:58Z (registrator) and 2026-10-27T18:06Z (`happy-dom`).
- F9. `release-plan.ts:377-392`: any change under `packages/banners` makes its next release refuse
  reuse until the banners version is bumped.
- F10. `zod` is a runtime dependency of `@aztec-labs/foundation` (34 files import it). In npm's bundle,
  only `node-gyp/lib/download.js` requires `undici`.

**Inferences.**
- I1. The bulk endpoint takes the whole tree in one request; the live probe did.
- I2. On the day, a plain `bun install` reproduces the trial's narrow diff. Phase 1 step 3 checks it.
- I3. `happy-dom` 21 keeps the `GlobalRegistrator.register()` API that both preloads call. The phase 4
  unit tests check it.

**Asks** (settled on a working assumption, nobody to ask):
- Ask 1. Clear F-red in arc 1? **No.** Arcs 2 and 3 do what in-range bumps can do. The rest is the owner's
  call (`OWNER-ASKS.md` Ask 1).
- Ask 2. Which wrangler? **4.151.1, exact**: the trial covers it. If its install fails, take the next
  version that passes the gate and rerun phase 1 in full.
- Ask 3. The steer names the playground's registrator, but banners' copy keeps the advisory (F8).
  **Assumption: bump both.** The PR states the banners consequence (F9).

## Architecture & Implementation

**Arc 1, phase 1 (#106): a data change.**
- Bump the root `wrangler` pin and drop `overrides.sharp`.
- Re-resolve the lock and review its diff.
- Regenerate `release-feed`'s Worker types.
- Retire the two `undici` exceptions; the bump meets their `upgrade` condition.

**Arc 1, phase 2 (#167)** adds a third finding source beside `bun audit` and `cargo audit`. It feeds
the existing `evaluateFindings`:

```ts
// scripts/workers-build.ts, beside PINNED_NPM_BIN:
export const PINNED_NPM_DIR = "packages/playground/node_modules/npm";
// scripts/dependency-audit.ts
/** name → exact versions under `<npmDir>/node_modules`, nested trees included; throws unless npm@`pin`. */
export function npmBundle(npmDir: string, pin: string): Record<string, string[]>;
/** Bulk-audits `bundle`; each finding carries `source`. Throws on a malformed answer. */
export async function auditNpmBundle(
  bundle: Record<string, string[]>, source: string, fetchImpl: typeof fetch = fetch,
): Promise<AuditFinding[]>;
```

- **`npmBundle`** is a local walker, adapted from `installedAztecPackages` (which tolerates where this
  one throws).
  - It reads `<npmDir>/package.json` through the outer Bun link, and needs `name === "npm"` and
    `version === pin` ("run `bun install`").
  - It walks `<npmDir>/node_modules`: skips dot entries, descends into `@scope/*`, recurses into each
    package's `node_modules`, and dedupes versions with a `Set`.
  - It throws on a symlink inside the bundle, a missing `package.json`, a `name` that is not the
    entry's path, a version that fails `isExactSemver` (`scripts/npm-packages.ts`), or an empty result.
- **`auditNpmBundle`**:
  - It POSTs JSON to `https://registry.npmjs.org/-/npm/v1/security/advisories/bulk` with
    `AbortSignal.timeout(180_000)`; any bound under the job's 15 minutes works.
  - It throws on `!response.ok` (`bulk advisory request failed: HTTP N`). It throws unless the body
    is a non-null, non-array object of arrays whose advisories each have a string `url` and a
    `severity` in {info, low, moderate, high, critical}.
  - It returns `parseBunAudit(body)` with `source` added. `{}` is a valid clean answer.
- **`main()`**, after `bun audit`: resolve `root` from `import.meta.dir`; read
  `pin = pinnedNpmVersion(<root>/packages/playground/package.json)`; run `npmBundle`, then
  `auditNpmBundle(..., "npm <pin> bundle")`; print `npm <pin> bundle: <names> packages, <versions>
  versions sent, <m> advisories`; push the findings. Gating, the allowlist and the exit code do not
  change.

**Arcs 2 and 3 (#172)** change data only. Arc 2: phase 3 runs `bun update undici` (F7), and phase 5
adds the entries the owner picked (P4-01), verbatim. Arc 3: phase 4 bumps the registrator in both
packages.

**File-level change map.**

| File | Phase | Change |
|---|---|---|
| `package.json` | 1 | `wrangler` → 4.151.1; delete `"sharp": "0.35.5"` from `overrides` |
| `bun.lock` | 1, 3, 4 | re-resolved closure (1); `bun update undici` (3); the registrator closure (4) |
| `packages/release-feed/worker-configuration.d.ts` | 1 | regenerated by `wrangler types` |
| `scripts/dependency-audit-allowlist.json` | 1, 5 | remove the two `undici` exceptions (1); the owner's picks only (5); `reviewed` → that day |
| `implementations-plan/follow-ups.md` | 1 | delete the undici sub-bullet and the #106 bullet; the count becomes ten |
| `scripts/workers-build.ts` | 2 | export `PINNED_NPM_DIR` |
| `scripts/dependency-audit.ts` / `.test.ts` | 2 | `npmBundle`, `auditNpmBundle`, wiring in `main()`; T1-T4 |
| `.github/workflows/dependency-audit.yml` | 2 | append to `paths`: `scripts/workers-build.ts`, `scripts/npm-packages.ts`, `.bun-version`, `bunfig.toml` |
| `packages/presto/scripts/ci-filter-contract.test.ts` | 2 | `:212-221`: pin the four new paths |
| `docs/RELEASE_RUNBOOK.md` | 2 | `:142`: the audit covers the pinned npm's bundle; an exception's reason must cover every source its ACCEPTED lines print |
| `packages/playground/package.json`, `packages/banners/package.json` | 4 | `@happy-dom/global-registrator` → `^21.0.4` |

## Security & Adversarial Considerations

- **Threat model.** A known-vulnerable package in npm's bundle runs during the playground's Workers
  Build, next to an account-wide deploy token. The audit detects published advisories; it does not
  prevent malicious code. The age gate and the integrity-pinned lock stay the preventive layers.
- **Trust.** The audit trusts the registry's advisory data and TLS to `registry.npmjs.org`, as
  `bun audit` does. A wrong `{}` passes; a canary would be new state.
- **Silent holes closed by a throw:** a wrong root, a wrong version, an empty or malformed walk, a
  symlink inside the bundle, a malformed record, an unknown severity.
- **Not covered** (closed `known-limit` issues at close-out). KL-1: code that esbuild inlined into a
  prebuilt bundle (`wrangler-dist/cli.js`, about 14.5 MB, runs next to the token). KL-2: same-version
  tampering of an installed tree, and an omission by the registry.
- **Allowlist.** An entry accepts every copy of its package (D8). Phase 5 adds only entries that the
  owner picked, and it copies their reasons verbatim.
- **Least privilege.** `dependency-audit.yml` keeps `contents: read` and no secret. The request sends
  only public names and versions.
- **Supply chain.** No new dependency, and the 7-day gate stays: phase 4 waits until
  2026-10-27T18:06Z. Every lock change comes from Bun's resolver, never a hand edit.
- **Exploitability of F-red here**: unknown. The owner ask records each copy's consumer.

## Phase 1: wrangler bump and override removal (#106) ✓

1. Run `bun run audit:dependencies > <scratch>/audit-trunk.txt`. It must print its `Dependency audit:`
   summary line. Exit 1 is expected (F-red).
2. In `package.json`, set `wrangler` to `4.151.1` and delete `"sharp": "0.35.5"`.
3. Run `bun install`, then `git diff bun.lock`. Every changed key must be `wrangler`, `miniflare`,
   `miniflare/undici`, `workerd`, `@cloudflare/workerd-*`, `@cloudflare/unenv-preset`, `esbuild`,
   `@esbuild/*`, a `*/esbuild*` dedupe entry, or the `overrides.sharp` line. Warning: never edit the lock
   by hand. On any other key, stop. Find the cause with Bun's resolver, and do not go on until the diff
   is closure-only.
4. Run `bun run --cwd packages/release-feed types`.
5. Run the audit. Remove each `undici` exception it prints as STALE (expected: both). Set `reviewed`.
6. Edit `follow-ups.md` as the change map says.

**Validation gate.**
- Commands: `bun install --frozen-lockfile`, `bun run lint`, `bun run test`, then
  - `bun run --cwd packages/landing build && bunx wrangler deploy --dry-run --config packages/landing/wrangler.jsonc`
  - the same dry-run for `release-feed` and `testnet-rpc` (no build needed)
  - `bun run --cwd packages/playground build && bunx wrangler deploy --dry-run --config packages/playground/wrangler.jsonc`
  - `bun run audit:dependencies > <scratch>/audit-p1.txt`
- Pass criteria:
  - Every command before the audit exits 0.
  - The audit prints its summary line, no line naming `sharp`, and no STALE line naming `undici`.
  - The set of `BLOCKED` keys (`ecosystem/severity id package`) is a subset of the baseline's. A key
    outside the baseline fails the gate, unless a trunk run on the same day also has it; such a key
    goes onto #172.
- After the PR opens: both `Workers Builds` checks pass.
- Layers: lint, typecheck (incl. `wrangler types --check`), unit, build, and the deploy dry-runs.
  `landing.yml` repeats the dry-runs.
- No test is added: this is a data change, and the gate proves it.

## Phase 2: audit the pinned npm's bundle (#167) ✓

1. Export `PINNED_NPM_DIR`.
2. Add `npmBundle` and `auditNpmBundle`, and wire them in.
3. Add T1-T4, the workflow paths, the contract-test entries and the runbook sentences.

**Tests** (`mkdtempSync` trees, removed in `afterEach`; `fetch` is injected, never swapped globally):
- **T1, success control.** The tree has `npmDir` as a symlink to the real dir, a top-level package,
  a scoped package, a nested `node_modules` with a second version of an existing name, and `.bin`.
  `npmBundle` returns exactly `{name: [versions]}`.
- **T2, fails closed.** `npmBundle` throws when: the root is not `npm`; the version is not the pin;
  the bundle is empty; an entry has no `package.json`; a name differs from its path; a version is not
  exact semver; a symlink is inside the bundle.
- **T3, the registry seam.** The stub records a `POST`, a JSON body equal to the bundle, and a
  signal. A high advisory returns with `source`, and `evaluateFindings` blocks it. `{}` gives no
  findings. Each of these throws: HTTP 503, `[]`, `{"error":"x"}`, `severity: "HIGH"`, and a record
  without `url`.
- **T4, live.** It runs under `describe.skipIf(!process.env.PRESTO_LIVE_AUDIT)`, like
  `PRESTO_LIVE_PROVENANCE`. It sends the real installed bundle to the real endpoint. It asserts at
  least 100 names and an answer that passes validation.

**Validation gate.**
- Commands: `bun test scripts/dependency-audit.test.ts` (plain, then with `PRESTO_LIVE_AUDIT=1`),
  `bun run lint`, `bun run test`, `bun run lint:actions`, `bun run audit:dependencies > <scratch>/audit-p2.txt`.
- Pass criteria:
  - All but the audit exit 0.
  - `audit-p2.txt` has the coverage line with at least 100 packages.
  - It has `ip-address` GHSA-rxp7-6hxx-x8q5 (REPORT) and `undici` GHSA-xjj6-f33q-929c (BLOCKED), both with
    the bundle source. The lock audit alone misses the first, which proves the gap in #167 is closed.
  - Its `BLOCKED` keys equal the phase 1 keys.

## Phase 3: re-resolve the caret `undici` copies (#172) ✓

1. Warning: never edit `bun.lock` by hand or by script. A hand edit hides the real constraint, and
   the next resolution reverts it.
2. Run `bun update undici`.
3. Run `bun install --frozen-lockfile`.

**Validation gate.**
- Commands: `bun install --frozen-lockfile`, `git diff --stat bun.lock`, `bun run lint`,
  `bun run test`, `bun run audit:dependencies`.
- Pass criteria: only `bun.lock` changes, in the F7 lines; the frozen install leaves it unchanged; lint
  and test exit 0; `bun audit --json` lists GHSA-xjj6-f33q-929c only with the `>=7.18.0 <7.30.1` range
  (miniflare); the bundle source still reports `undici` 6.29.0.
- After the PR opens: the routed SDK E2E and WebDriver lanes pass. They load `@aztec-labs/foundation`'s
  and webdriverio's `undici`.

## Phase 4: bump `happy-dom` (#172) ✓

1. Set `@happy-dom/global-registrator` to `^21.0.4` in `packages/playground` and `packages/banners`.
2. Run `bun install`. The lock diff must be the registrator's and `happy-dom`'s closure only. If it is
   not, stop, as in phase 1 step 3.

**Validation gate.**
- Commands: `bun install --frozen-lockfile`, `bun run --cwd packages/playground test:unit`,
  `bun run --cwd packages/banners test:unit`, `bun run lint`, `bun run test`, `bun run audit:dependencies`.
- Pass criteria: every command exits 0, the audit included (0 blocked, so `Closes #172` holds).

## Phase 5: the owner's picks (#172) ✓

P4-01, Option A: both entries, verbatim from `OWNER-ASKS.md` Ask 1.

1. Add each entry that `OWNER-ASKS.md` Ask 1 records as picked, verbatim.
2. Set `reviewed` to the day.

**Validation gate.**
- Commands: `bun run test`, `bun run audit:dependencies`.
- Pass criteria: `bun run test` exits 0. The audit prints both entries as `ACCEPTED until 2026-11-30`
  (the bundle copy of `undici` too), and its only `BLOCKED` key is `happy-dom`, which phase 4 clears.

## Delivery

- **Arc 1** = phases 1-2, on `worktree-deps-1` above the plan commit, against `main`.
  - Title: `chore(deps): bump wrangler, drop the sharp override, audit npm's bundled tree`.
  - Body: what and why, the validation runs, `Closes #106`, `Closes #167`. It says that
    `Audit dependencies` stays red because of #172, and that the merge redeploys both sites from
    identical assets.
- **Arc 2** = phases 3 and 5, on `deps-1-a2` from `origin/main` at b85134c. No stacked PRs.
  - Title: `chore(deps): re-resolve the caret undici copies, accept the zod and undici advisories`.
  - Body: `Refs #172`; the audit's BLOCKED keys before and after, from a same-day run on `main`.
- **Arc 3** = phase 4 plus the plan's close-out, on `deps-1-a3` from `origin/main` after arc 2
  merges, not before 2026-10-27T18:06Z.
  - Title: `chore(deps): bump happy-dom to 21 in the playground and banners`.
  - Body: `Closes #172`; the next banners release must bump its version (F9).
- `code_review: off`. One commit per phase. Parallelism: none; the arcs are serial by date.

## Decision ledger

| # | Decision | Chosen | Rejected and why |
|---|---|---|---|
| D1 | arc 1 topology | one PR for #106 + #167 | two PRs: two CI passes and two production redeploys (F6) for about 250 lines |
| D2 | wrangler target | 4.151.1 exact | newest on the day: variation the trial never covered (Plan agent; Codex: either) |
| D3 | lock method | Bun's resolver only: `bun install` + closure-only review (1, 4), `bun update undici` (3) | a hand splice: the next resolution reverts it (ORCHY-STEER). A root `undici` override: it pins every copy to one version, forcing Aztec's and webdriver's 6.x ranges and miniflare's exact 7.x together |
| D4 | the two `undici` exceptions | remove them in phase 1 | keep them until 10-31: their `upgrade` condition is met |
| D5 | F-red | #172, a gate on the key set compared with the trunk baseline, close #106 | exit 1 counted as "expected": an aborted audit also exits 1 |
| D6/D7 | bundle source / call | the installed tree + the bulk endpoint (A) | `npm pack` (downloads bytes again); outline B below |
| D8 | allowlist key | unchanged + a runbook sentence | a key per source: a contract change |
| D9 | deadline | local `AbortSignal.timeout(180_000)` | import `NPM_TIMEOUT_MS`: ties the audit to a release-path module |
| D10 | where it runs | `audit:dependencies` | inside `workers-build.ts`: every deploy would depend on advisory data |
| D11 | walker | local, fails closed | share `installedAztecPackages`: it needs a policy flag |
| D12 | audit job install | unchanged | `--ignore-scripts` (Codex, "prefer"): F4 shows the same tree either way |
| D13 | `{}` answer | passes | fail: a clean bundle is a real answer; a canary is new state |
| D14 | live test T4 | env-gated | CI job alone: the owner's rule asks for an opt-in real-data test |
| D15 | a3 grouping | its own PR, after 2026-10-27 | fold into arc 1: arc 1 would wait two days for the age gate; superseded by D19 |
| D16 | `happy-dom` scope | playground and banners | playground only: banners' copy keeps the advisory (F8) |
| D17 | the rest of F-red | an owner ask; nothing lands unpicked | entries the panel chooses: a risk acceptance belongs to the owner |
| D18 | arc 2 base | `origin/main` after arc 1 merges | stacking on arc 1: the implementer brief allows no stacked PRs |
| D19 | a3 grouping | arc 2 = phases 3 + 5 now; arc 3 = phase 4 + close-out after the age gate (orchestrator) | one PR after 2026-10-27: holds the in-range fixes and the owner's picks two days for nothing |

**Outline B** (npm's own tooling): write a synthetic `package-lock.json` from the bundle, then run the
pinned `npm audit --json --package-lock-only`. Two formats to keep in step, plus a spawn and a temp
dir, for the same data. npm 11.21.1's `#getReport()` calls the same endpoint with no fallback (Codex
read the source). Rejected.

**Disputed:** D12 (Codex prefers `--ignore-scripts`; rejected on F4) and D2 (Codex: either).

## Audit verdicts

| Round | Reviewer | Verdict | Accepted | Rejected |
|---|---|---|---|---|
| 1 | Codex gpt-6.1-sol high, `01a170e0` | conditional approve | strict advisory validation (demonstrated); exact semver and `name === "npm"` (demonstrated: a bad version gets `200 {}`); throw on a symlink inside the bundle; bounded install claims (KL-2); key-set gate; inject `fetch`; wider T1-T3; T4; fixed F2 wording; dropped B's fallback claim | D12 |
| 1 | Plan agent, Opus | conditional approve | S1 (= Codex); S2 Workers Builds checks (F6); S3 `bundleDependencies` scope + KL-1; S4 walk under the root's `node_modules`, symlinked `npmDir` in T1; S5 `.bun-version`/`bunfig.toml` paths pinned in `ci-filter-contract.test.ts`; pin 4.151.1; file #172 (done); export `PINNED_NPM_DIR`; pass `source`; print what was sent; D8 runbook sentence; trim | none |
| — | ORCHY-STEER, after round 1 | arc a3 added | phases 3-5, `OWNER-ASKS.md` Ask 1, D15-D17 | — |
| final | Codex gpt-6.1-sol high, fresh `01a170f1` | conditional approve, then **approve** after a verify-only resume | dropped the lock-splice fallback (phase 1 step 3); corrected the `zod` rationale in `OWNER-ASKS.md` (exhausting client memory goes beyond data trust); delivery is conditional on stacking | none |
| arc 1 r1 | Codex gpt-6.1-sol high, `01a170fd` (diff 1298669..b43cbd5) | clean | none needed | — |
| arc 1 r1 | Opus diff review (fresh) | clean, 3 minor | the walker names the file on a malformed or `null` manifest, and a non-JSON answer gets its own error (both tested); the doc comment states its failure contract; dot entries skipped inside `@scope` too; D18 reordered | symlinked files inside a package (needs a tampered tree, KL-2); the `lessons.md` citation is fixed in arc 2's close-out |
| arc 1 r2 | Codex resume `01a170fd` (fix diff cfaf6a1) | clean | converged | — |
| arc 2 r1 | Codex gpt-6.1-sol high, `01a172ed` (diff b85134c..a8fcf05) | 0 material, 1 doc note | stale arc references after D19 in `OWNER-ASKS.md` and the plan, fixed | — |
| arc 2 r1 | Opus diff review (fresh) | 1 material, 2 minor | phase 4's gate would have passed a red audit: it now requires 0 blocked; D15 marked superseded and D19 reordered; phase-3 lesson notes that `npm/undici` is lock-only; the stale `braces` exception goes in arc 3's close-out | — |
| arc 2 r2 | Codex resume `01a172ed` (fix diff a84a4ae) | clean | converged | — |
| arc 3 r1 | Codex gpt-6.1-sol high, `01a17eab` (diff c1d1f6f..28a82f6) | clean, 1 minor | #187's "no `package.json` names them" was too broad (wrangler's `devDependencies`, `cli.js` path comments); the issue now says no authoritative inventory exists | — |
| arc 3 r1 | Opus diff review (fresh) | 1 material, 6 minor | #187 now records the inlined `zod` 4.6.5 and `undici` 7.29.1, both inside accepted advisories, and a reopening condition that was not already true; `follow-ups.md` says to check them before dropping either exception; three `lessons.md` compressions restored, and the `bun update` line matches its source; the Outcome's bullet renders right; banners' setup comment no longer says happy-dom fetches CSS (off by default in 21); the close-out commit's retirement count reworded before push | the allowlist's `undici` reason is the owner's verbatim text; it describes the copies the audit sees |

## Post-implementation

There is no `implementations-plan/README.md` standard here, so the steps are written out. They run
**per arc**: arc 1 after phase 2, arc 2 after phase 5, arc 3 after phase 4. The close-out goes on
arc 3's PR.

**While implementing.** Comments state invariants and whys only. Log each attempt in
`lessons/phase-N.md`. Run `agent-worktree status deps-1 "phase N green: <next>"` at each gate. Stop
after 3 failures on one step.

1. **Codex audit** of the arc's diff:
   - Command: `~/.claude/skills/codex/scripts/run-codex.sh <prompt-file> "$(git rev-parse --show-toplevel)" high read-only gpt-6.1-sol`.
   - The prompt holds the diff, this plan with its ledger, the arc map (arc N of 2), and the
     adversarial ask. It also holds these two rules, verbatim:
     - *"Report bugs and small, targeted improvements only. Do not propose speculative abstractions,
       extra configuration surface, new layers, or rewrites — the smallest change that fixes each real
       problem. If code works and is clear, leave it alone."*
     - *"Audit the comments for value per character. Flag any comment that narrates what the code
       visibly does, restates its line, references implementation plans / phases / reviews, or spends
       a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint
       deserves a comment it doesn't have. Comments are permanent context every future reader, human
       or LLM, pays to re-read: they must be few, dense, and exact."*
2. **Fix loop.** Verify each claim against the code, fix, commit, and log in `lessons/review.md`.
   Resume with `resume-codex.sh` and the fix diff. Stop when a round has no new material finding, and
   surface after 3 rounds. New state, a lifecycle, a protocol, a recovery policy or a public contract
   is a plan change: stop for approval.
3. **Delivery.** Run `bun run test` and `bun run lint:actions`. Push the arc branch, then run
   `gh pr create --base main` with the Delivery title and body. Each later arc starts only after the previous one merges.
   Arc 1 only: comment on #106 that its
   "green" step did not hold, because of #172. Watch `gh pr checks`, bounded inside one tool call.
4. **Close-out** (arc 3's final commits):
   - Merge `origin/main` first, and read what changed in `lessons.md`, `follow-ups.md` and
     `archive/index.md`. Never use a union merge.
   - Write `## Outcome` after the front matter: date, status, shipped (PR numbers), dropped,
     `Known limits:` KL-1 and KL-2 as issue numbers, `Open items:` (#172 if open), and the seeds retired.
   - In `lessons.md`:
     - re-stamp the wrangler line to 4.151 and cite `lessons/phase-1.md`;
     - add: "`bun.lock` records a bundling package's declared deps, not its `bundleDependencies`";
     - add: "`bun update <transitive>` re-resolves every copy within its ranges; deleting lock entries by
       script corrupts the lock and re-resolves the whole tree";
     - prune to 8 KiB.
   - File KL-1 and KL-2 as `known-limit` issues, closed as not planned. Each states the hypothesis,
     consequence, missing prerequisite, disposition and reopening condition.
   - Put every other open item in its home: an issue with a `Record` link; `owner-decision` or
     `blocked:external`; a private draft advisory for a suspected exploitable weakness; an Outcome line
     for what was rejected or done.
   - Drop the `braces` exception if the audit still prints it as STALE.
   - Delete `STATUS.md`.
   - In its own commit, run `git mv implementations-plan/deps-1 implementations-plan/archive/deps-1`.
     Add one line to `archive/index.md`, and none to `index.md`. Repair what `git grep -n deps-1` finds.
5. **Report and wait.** The orchestrator merges.
6. **Teardown** once `git fetch -q origin main && git cat-file -e FETCH_HEAD:implementations-plan/archive/deps-1/plan.md`
   succeeds: run `agent-worktree done deps-1 --merged` (no `EnterWorktree` session to exit). Relay a
   refusal verbatim; never force. A `/loop` session checks on each firing, a `/goal` session at its
   next turn.

## Seeds

Not run by this lane; the orchestrator drives implementation.

```
/goal Phases 1-5 of implementations-plan/deps-1/plan.md are ✓ (phase 5 may be ✓-skipped with no owner pick), each backed by its gate passing in the transcript, with LESSONS_FILE=implementations-plan/deps-1/lessons/phase-N.md printed per phase; /code-review NOT run; the Codex loop converged per arc (a resumed pass with no new material finding, quoted); all three PRs exist against main (each later arc branched from main after the previous merged), each opened after its loop, the third carrying the close-out (git show --stat of the archive move); bun run test and bun run lint:actions exit 0.
```

```
/loop 15m Drive implementations-plan/deps-1 forward: read plan.md and lessons/ first (once archived, run the merge check and `agent-worktree done deps-1 --merged`, then clear the loop); take the next open step (never phase 4 before 2026-10-27T18:06Z), run `bun run lint` and `bun run test` after each edit, commit, mark ✓ only on a passing gate, settle questions with Codex (gpt-6.1-sol, high); never merge, publish or deploy; after 5 failures on one step, reassess with Codex.
```

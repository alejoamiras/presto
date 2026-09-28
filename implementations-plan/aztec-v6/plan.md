---
plan: aztec-v6
tier: mid
driver: claude-code
eli5_mode: artifact
code_review: off
status: approved 2026-09-28 (A1–A7 answered); implementing
created: 2026-09-28
worktree: .claude/worktrees/aztec-v6
branch: worktree-aztec-v6
base: main @ 4cdc2f2
---

## Summary

Move Presto to Aztec v6 `6.0.0-rc.1` and release it. Aztec v6 renamed its npm scopes: `@aztec/*`
became `@aztec-labs/*`, and the barretenberg and noir packages became `@aztec-foundation/*`. It also
publishes `bb` only from `AztecProtocol/barretenberg`. The owner's premise, "only the SDK needs
releasing", does not hold, for two reasons:

- **Every released Presto app (up to 1.1.2) downloads `bb` from `aztec-packages`, which has no v6
  release.** A v6 page talking to today's app silently falls back to WASM. The app has to switch its
  `bb` source and ship before the SDK is useful natively. The switch works for v5 too, so it ships
  first.
- **The release tooling cannot publish a prerelease Aztec base.** The version regex, the pin
  ordering, the promotion guard and a dozen hardcoded `@aztec/stdlib` reads all assume v5 shapes.

Three arcs, in dependency order:

1. **`bb` from barretenberg.** No behaviour change for v5. Ships as app 1.1.3.
2. **Release tooling for a prerelease Aztec base.** One scope-agnostic manifest reader, prerelease
   ordering and a promotion guard. No behaviour change on v5.
3. **The v6 migration.** Packages, imports, CI installer policy, Noir fixtures, the token demo, the
   legacy gate, then the network cutover. The cutover needs the owner's v6 RPC. The arc then releases
   `presto@6.0.0-rc.1`, `presto-noir@2.0.0-rc.1` and `presto-core@1.2.1`, and points the playground
   at the v6 network.

`main` moves to v6 now. The Aztec testnet already runs 6.0.0-rc.1 (owner, 2026-09-28), so the v6
artifacts publish to our `testnet` tag, which tracks that network. v5 is frozen at
`5.2.0-revision.5`, which stays on `latest` until v6 is stable.

**Tier:** `mid`, the owner's call ("Deep is too much"). The rubric scores two HIGH dimensions (blast
radius: every consumer and the app's fetch path; external coupling: an Aztec rc, a new repository and
a new network), which would suggest `deep`. The compensation is that each arc is small and
independently revertable.

## Outcome & Quality Bar

**For whom.**
- **A dApp developer on v6 rc.1.** They install `@aztec-labs/*@6.0.0-rc.1` and want native proving
  from one install line.
- **A Presto user.** They should never learn that `bb` moved repositories.
- **A playground visitor on the v6 network.**
- **A v5 integrator on `latest`.** Nothing they rely on may move.

**Excellent looks like:**
1. **The npm tags cannot mislead.**
   - `npm i @alejoamiras/presto` still yields `5.2.0-revision.5`.
   - `@testnet` yields `presto@6.0.0-rc.1`, matching the network the tag names; its exact
     `presto-core` and `@aztec-labs/*` pins match what a v6 app installs.
   - `presto-noir@testnet` peers exactly `@aztec-foundation/bb.js@6.0.0-rc.1`.
   - The tooling refuses to promote any prerelease to `latest`, with or without `--rollback`.
   - The shipped README and agent skill show the v6 install line, with v5 clearly labelled.
2. **The released 1.1.3 server proves v6 natively from a cold cache.** With nothing but its own
   version cache to draw on, it downloads `bb` 6.0.0-rc.1 from barretenberg, checking the digest
   first.
   - Its native Chonk proof of an account deployment is accepted by the network.
   - Its native UltraHonk proof is byte-identical to the committed fixture and verifies.

   On the deployed playground, the page's phase trail contains `transmit` and neither `fallback` nor
   `denied`.
3. **One cache serves 5.2.0 and 6.0.0-rc.1 side by side.** A versioned 5.2.0 request and a versioned
   6.0.0-rc.1 request each run their own digest-verified `bb`, with error reasons, caps and the
   download budget unchanged.
4. **The next rc is routine.** `bun run aztec:update 6.0.0-rc.2`, then:
   - review the two exemption lists (bunfig and the installer), which fail closed with a named
     package;
   - add a Windows pin;
   - regenerate the fixtures.

   No tooling surgery and no week of red CI.

**Good enough:**
- No v5 maintenance branch.
- No `latest` promotion of any rc artifact.
- The playground's token demo uses Aztec's reference `Token`; aztec-standards has no v6 release.
- No SDK-side "update Presto" message when an old app cannot fetch v6 `bb`. The documented WASM
  fallback stays.
- The legacy-SDK interop gate goes dormant on v6 (A6).

## Scope

**In:**
- **App:** `bb` source switch to barretenberg, plus release 1.1.3 (publish and promote).
- **Tooling:** release tooling for a prerelease base, and a single scope-agnostic Aztec manifest
  reader used by every script and workflow that reads one.
- **v6 migration** of the SDK, the Noir adapter, the core patch bump, the playground, the tarball
  consumer, the CI installer policy and the shipped docs:
  - Noir fixtures regenerated with v6 bb.js.
  - Windows `bb.exe` pin for 6.0.0-rc.1.
  - Age-gate exemptions extended to exact `@aztec-labs/*` and `@aztec-foundation/*` names (owner
    decision, 2026-09-28).
  - Update automation retargeted to `@aztec-labs/aztec.js` and its `prerelease` tag.
- **Network cutover:** the v6 RPC; SponsoredFPC deployed and funded under a capped keyed run.
- **SDK release** to `testnet`, then the playground pin and deploy.

**Out:**
- v5 maintenance releases.
- `latest` promotion of rc packages.
- An aztec-standards v6 token.
- An SDK "update your app" UX.
- Any change to the app's HTTPS, consent or admission model.
- `presto-banners`, which is reused unchanged.
- A v6-era legacy interop fixture (a follow-up).

## Architecture & Implementation

### Proposed architecture

Nothing new at the component level. Three re-pointings, one version-policy extension and one
manifest reader:

- **Arc 1: the `bb` source.**
  - A single repository constant per language. Rust: `BB_RELEASE_REPO =
    "AztecProtocol/barretenberg"` feeds `download_url` and the digest API URL in
    `core/src/versions/release_metadata.rs`.
  - On the TS side, `scripts/download-bb.ts`, `packages/presto/scripts/copy-bb.ts` and
    `scripts/check-windows-bb-pin.ts` share one exported constant, following the import direction
    that already exists.
  - Kept as they are: digest-first ordering, the redirect-refusing metadata client, the
    redirect-following tarball client, the caps and `DownloadBudget`.
  - Windows pins barretenberg does not serve identically are pruned: 4.2.0 and 4.3.1 (absent) and
    5.0.1 (rebuilt; corrected in phase 1, see `lessons/phase-1.md`). The live pin (5.2.0) is
    re-verified against barretenberg's digest; it is identical.
- **Arc 2: the release policy and one manifest reader.**
  - `scripts/npm-packages.ts` accepts an Aztec prerelease base for `aztec-derived` packages.
  - `get-sdk-publish-version.ts` gets `aztecDerivedOrder`: prerelease < stable < `-revision.N`.
  - Every package keeps publishing to `testnet`, the tag the workflows already use by default, so no
    per-package tag machinery is added.
  - `promote-sdk-latest.ts` refuses anything not on `testnet` (`:158-159`), but `--rollback`
    bypasses that check. Once `testnet` holds 6.0.0-rc.1, that check alone would let a prerelease
    reach `latest`. So it gains an explicit prerelease refusal that applies in both modes.
  - **The reader.** `scripts/aztec-manifest.ts` matches `^@aztec(?:-labs|-foundation)?/<bare>$`
    across the given sections.
    - `findAztecDependency(manifest, bare, sections)` returns `{name, version}` or `undefined`, and
      **always throws when more than one matches**.
    - `requireAztecDependency` also throws when none matches. `aztecVersionOf(manifest)` uses it on
      `stdlib`.
    - Optional callers (`exact-pin.ts` for a `manifest`-versioned package, which legitimately has no
      stdlib) use `find`. Required callers use `require`. Nobody catches the reader's errors, so an
      ambiguous dual-scope manifest can never pass silently.
  - **Every** script and workflow that reads an Aztec name or version from a manifest goes through
    it. Recon plus the audits count 13:
    - `get-sdk-publish-version.ts:86`, `_publish-npm.yml:316`, `release-presto.yml:971`;
    - `setup-aztec/action.yml:31`, `_aztec-update.yml:82`, `check-aztec-update.ts:20-56`;
    - `tarball-consumer/exact-pin.ts:20`, `tarball-consumer/host-manifest.ts:26`,
      `sdk-tarball-consumer.sh:60,105,111,118`;
    - `install-legacy-sdk.ts:68`;
    - `published-playground.ts:192-196` (the Noir adapter's peer);
    - `packaged-e2e-swap-sdk.sh:111,158` (the packed SDK's `bb-prover` dependency and the packed
      adapter's peer);
    - `copy-bb.ts` `resolveAztecBb()`.

    `noir-fixture.ts:238` `loadBbJs` stops duplicating `resolveAztecBb()` and reuses it.
  - The module joins `app.yml`'s `published` filter, because `get-sdk-publish-version.ts` imports it.
  - The reader stays dual-scope permanently. It also reads published artifacts of either generation
    (the legacy tarball, old consumer hosts).
- **Arc 3: the scope rename, v6 API edits, CI installer policy and the network cutover.**
  - Mostly manifest, import and configuration edits.
  - The behavioural code: the playground token flow (reference `Token`), the FPC funding scripts
    (capped and destination-checked), the setup-aztec exemptions and allow-list, and the legacy
    gate's skip.

**The load-bearing constraint on the split.** `app.yml`'s `published` filter (`:71-84`) runs the
Published Playground Build on any PR touching the pin or the production build path.
`published-playground.ts` `assertPublishedManifest` (`:22-41`) compares every published dependency
to the workspace manifest, so during a bump it must fail until the SDK it pins is published from the
same `main`. Arc 3 therefore touches **no file in that filter**. Arc 2 lands the filter-listed
changes while `main` is still v5, where that build passes.

### Key interfaces

```ts
// scripts/npm-packages.ts
// aztec-derived: X.Y.Z | X.Y.Z-revision.N | X.Y.Z-(rc.N | nightly.YYYYMMDD | aztecnr-rc.N)[.M]
export const VERSION_PATTERNS: Record<VersionMode, RegExp>;

// scripts/get-sdk-publish-version.ts — replaces revisionOrder (throws on any prerelease today)
/** Publish order: prereleases (semver order among themselves) < X.Y.Z < X.Y.Z-revision.N. */
export function aztecDerivedOrder(a: string, b: string): number;

// scripts/aztec-manifest.ts (new; repo-internal; in app.yml's `published` filter)
type Section = "dependencies" | "devDependencies" | "peerDependencies";
type AztecDependency = { name: string; version: string };
/** The dependency named @aztec/<bare>, @aztec-labs/<bare> or @aztec-foundation/<bare> across
 *  `sections`, or undefined; throws when more than one matches. Reads either Aztec generation. */
export function findAztecDependency(
  manifest: PackageManifest, bare: string, sections: readonly Section[],
): AztecDependency | undefined;
/** As `findAztecDependency`, but a missing dependency also throws. */
export function requireAztecDependency(
  manifest: PackageManifest, bare: string, sections: readonly Section[],
): AztecDependency;
export function aztecVersionOf(manifest: PackageManifest): string; // required stdlib pin
// CLI: bun scripts/aztec-manifest.ts <package.json> [bare=stdlib] [--name]  → prints version or name
```

```rust
// packages/presto/core/src/versions/release_metadata.rs
const BB_RELEASE_REPO: &str = "AztecProtocol/barretenberg";
```

Workflow contract: unchanged. Every publish goes to `testnet`, and `_publish-npm.yml` already reads
the tag back after publishing (`:284-288`). `npm publish --tag testnet` never moves `latest` on a
package that already has one.

Published package contracts after arc 3:

| Package | Version | Tag | Key pins |
|---|---|---|---|
| `@alejoamiras/presto` | `6.0.0-rc.1` | `testnet` | `@aztec-labs/{bb-prover,foundation,stdlib}`, `@aztec-foundation/{noir-acvm_js,noir-noirc_abi}` exact 6.0.0-rc.1; `presto-core` exact 1.2.1 |
| `@alejoamiras/presto-noir` | `2.0.0-rc.1` (major: peer renamed) | `testnet` | peer `@aztec-foundation/bb.js` exact 6.0.0-rc.1; `presto-core` exact 1.2.1 |
| `@alejoamiras/presto-core` | `1.2.1` (patch: `files` changed since 1.2.0; Aztec-agnostic) | `testnet` | none |
| `@alejoamiras/presto-banners` | `1.2.0` | reused | — |

### Data & control flow

**Critical path: a v6 native proof.**
1. The page uses SDK 6.0.0-rc.1 and calls `/health`.
2. `POST /prove` carries `x-aztec-version: 6.0.0-rc.1`, read from `@aztec-labs/stdlib`.
3. The version gate (`version_policy.rs`, unchanged) passes.
4. On a cache miss, `DownloadBudget` applies, then the digest GET goes to
   `api.github.com/repos/AztecProtocol/barretenberg/releases/tags/v6.0.0-rc.1` with no redirects.
5. The tarball GET goes to `github.com/AztecProtocol/barretenberg/releases/download/v6.0.0-rc.1/barretenberg-<platform>.tar.gz`,
   following redirects.
6. The server checks the sha256 against the digest, extracts, then runs `bb prove --scheme chonk
   --ivc_inputs_path … -o …`. v6 still accepts every flag. The msgpack now carries a `kind` per
   step; the server passes it through opaquely.
7. `decodeChonkProof` decodes the result. `ChonkProofWithPublicInputs` is unchanged v5→v6.

**Release sequence** (the agent dispatches each step once its preconditions hold; owner
authorization, 2026-09-28, A5):
- **R1, after arc 1 merges:**
  1. `release-presto.yml mode=publish version=1.1.3`.
  2. Its gates run.
  3. `mode=promote-only version=1.1.3`.
  4. Installed apps auto-update.

  R1 must complete before phase 6, whose gate uses the released artifact.
- **R2, after arc 3 merges:**
  1. `release-sdk.yml packages=all dry_run=true`.
  2. The real dispatch: core 1.2.1, noir 2.0.0-rc.1 and presto 6.0.0-rc.1, all to `testnet`;
     banners reused.
  3. The e2e runs on a v6 local network (the legacy step skips per A6), then `noir-gates`, then
     publish core, then noir, then presto.
  4. `bump-playground` opens the pin PR. It auto-merges, or, if auto-merge does not fire, the agent
     merges it once its checks pass (A7).
  5. Workers Builds deploys the production playground.
  6. `smoke-playground.yml` runs against the public v6 RPC.

  `main`'s production playground build fails closed from the arc 3 merge until the pin PR merges.
  Cloudflare keeps serving the previous deploy, and R2 follows the merge immediately.

### File-level change map

**Arc 1:**
- `core/src/versions/release_metadata.rs`: constant, URLs, doc comments; tests at :297, :315 and
  :328, whose URL fixture moves to 5.2.0.
- `core/src/versions/downloader.rs:906`: the fallback version becomes 5.2.0.
- `scripts/download-bb.ts:82,204,294`.
- `packages/presto/scripts/copy-bb.ts`:
  - comments at :9, :34 and :115, and the URL at :156;
  - prune the pins barretenberg does not serve identically (4.2.0, 4.3.1, 5.0.1);
  - 5.2.0's note records the barretenberg re-verification.
- `scripts/check-windows-bb-pin.ts:43`.
- `docs/SECURITY_MODEL.md:30,86,119`, `README.md:194`.

**Arc 2:**
- `scripts/aztec-manifest.ts` and its test (new).
- `scripts/npm-packages.ts`: patterns.
- `scripts/get-sdk-publish-version.ts`: `aztecDerivedOrder`, and `baseVersionFor` via the reader.
- `scripts/playground-pin.ts`: uses `aztecDerivedOrder`.
- `scripts/release-plan.ts`: plans a prerelease base (no tag output; everything stays `testnet`).
- `.github/workflows/_publish-npm.yml:316` via the reader.
- `.github/workflows/release-presto.yml:971`.
- `scripts/promote-sdk-latest.ts`: explicit prerelease refusal.
- `.github/actions/setup-aztec/action.yml:31`, `.github/workflows/_aztec-update.yml:82`,
  `scripts/check-aztec-update.ts`: package list and aztec.js name from the manifests.
- `scripts/update-aztec-version.ts`: managed set is `@aztec/`, `@aztec-labs/`, and exact
  `@aztec-foundation/{bb.js,noir-acvm_js,noir-noirc_abi}`. `LOCKSTEP_PACKAGES` keeps aztec-standards
  until arc 3 drops the dependency.
- `scripts/tarball-consumer/{exact-pin,host-manifest}.ts`, `scripts/sdk-tarball-consumer.sh`
  (`count_stdlib` and the conflict host take the stdlib name from the tarball manifest).
- `scripts/install-legacy-sdk.ts`: compares via the reader.
- `scripts/published-playground.ts:192-196`.
- `.github/scripts/packaged-e2e-swap-sdk.sh:111,158`.
- `copy-bb.ts` `resolveAztecBb()`.
- `scripts/noir-fixture.ts:238`.
- `.github/workflows/app.yml`: add `scripts/aztec-manifest.ts` to `published`.
- Tests next to each.

**Arc 3.** The gate proves this diff intersects the `published` filter nowhere.
- **Manifests and lock:** `packages/{sdk,sdk-noir,playground}/package.json` (drop aztec-standards;
  `viem` alias 2.38.3), `bun.lock`, `bunfig.toml` (the exemption list regenerated from the lock),
  `scripts/bunfig-aztec-excludes.test.ts` (three scopes, foundation names exact).
- **Lockstep removal:** `scripts/update-aztec-version.ts` drops `LOCKSTEP_PACKAGES`, whose only
  member was aztec-standards, together with its test cases.
- **CI installer policy:** `.github/actions/setup-aztec/action.yml`:
  - the `@aztec/*` glob is replaced by **exact names only**, one `min-release-age-exclude[]=<name>`
    line per package in the step's existing temporary npmrc (npm's documented array syntax). The
    names are every `@aztec-labs/*`, `@aztec-foundation/*` and `@aztec/viem` package in the v6
    installer's resolved graph, from `npm ls --all --json` in a scratch prefix. They live in one
    committed list file that both the npmrc loop and the graph check read;
  - the step asserts npm's effective `min-release-age-exclude` list equals the reviewed list before
    installing;
  - **a graph check runs on every job, cache hit or miss**: a new step after the install, not gated
    on `cache-hit`, compares the Aztec-scoped names (`@aztec-labs/*`, `@aztec-foundation/*`,
    `@aztec/*`) actually installed under `~/.aztec/versions/<version>` with the list file, and fails
    naming each addition and removal. The installer resolves unlocked, so a new first-party package
    that is already older than seven days would otherwise install unexamined and pass the config
    assertion. The comparison is a small root script with a fixture-tree test, one case being an
    unlisted package old enough to clear quarantine;
  - the `allow-scripts` list is re-reviewed against v6's script-bearing packages and version-pinned;
  - the cache salt (:64) is bumped.
- **Imports:** `packages/sdk/{src,e2e}`, `packages/sdk-noir/src`,
  `packages/playground/{src,scripts,e2e}`, `scripts/tarball-consumer/presto-noir/*` (host deps and
  imports; the conflict host's stdlib becomes a published `@aztec-labs/stdlib` of another version,
  e.g. `6.0.0-nightly.20260829`).
- **`x-aztec-version`:** `sdk/src/lib/presto-prover.ts:76-81`, `playground/vite.config.ts:186-189`,
  `playground/src/aztec.ts:52-53`.
- **Playground build config:** `playground/vite.config.ts` (dedupe, optimizeDeps and allowlists at
  :44-48, :68-69, :113, :118, :208, :276), `playground/licensing/license-fallbacks.ts` (rules
  re-keyed; the bb.js text now sourced from the barretenberg repository at `v6.0.0-rc.1`).
- **FeeJuice:** `FeeJuiceContract` from `@aztec-labs/aztec.js/protocol` in
  `playground/scripts/{deploy-sponsored-fpc,batch-fund-fpc}.ts` and
  `sdk/e2e/{legacy-compatibility,proving}.test.ts`.
- **Token demo:** `playground/src/aztec.ts:650-790` rewritten for the reference `Token`;
  `CRS_CACHE_VERSION`.
- **Windows pin:** `copy-bb.ts`, the hand-reviewed `6.0.0-rc.1` pin only.
- **Versions:** `sdk-noir` 2.0.0-rc.1 (peer, `TESTED_BB_VERSIONS`); `sdk-core` 1.2.1.
- **Fixtures:** `fixtures/noir/*` regenerated.
- **Legacy gate:** `_e2e.yml:107-112` and `install-legacy-sdk.ts`. The step skips with a named
  notice when the legacy fixture's Aztec major differs from the workspace's (A6). The fixture file
  stays, because `presto-release-readiness.ts` reads it.
- **FPC scripts** (`deploy-sponsored-fpc.ts`, `batch-fund-fpc.ts`, with shared logic in one helper
  module):
  - **No default RPC**; `AZTEC_NODE_URL` is required.
  - **Amounts** are whole FJ, positive integers bounded by A4's caps, and given per operation:
    `--bootstrap-amount` for the deployer account and `--fpc-amount` for the FPC. The sum is checked
    against `--max-total` before the first send. `batch-fund-fpc.ts` bridges exactly `--fpc-amount`,
    never the wallet's balance.
  - **A signer-free `--preflight` mode** (no L1 key; on the private RPC it is still a keyed run,
    for the URL) reads the node and prints a JSON manifest: L1 chain id, fee juice portal, fee juice
    token, mint handler, FPC address (from the salt), and each amount and the total. The agent
    checks that manifest against the independent anchor (Security).
  - **The keyed run is bound to the approved values.** It takes them as
    `--expect-{chain,portal,token,handler,fpc}` plus the amounts, reads the node **once**, and
    refuses any mismatch before signing anything. The L1 client's `getChainId()` must equal
    `--expect-chain` too.
  - **The portal manager is built from that one validated snapshot**, with the public constructor
    `new L1FeeJuicePortalManager(portal, token, handler, l1Client, logger)`. Never `.new(node, …)`:
    in `@aztec-labs/aztec.js@6.0.0-rc.1` it calls `getNodeInfo()` again
    (`dest/ethereum/portal_manager.js`), and a second answer could substitute the destinations.
  - Tests cover, without keys: malformed amounts, a cap breach, a wrong destination, a node that
    reports a different chain, an L1 client on a different chain, and a node whose successive
    `getNodeInfo()` answers disagree (the manager must carry the first, validated one).
- **Shipped docs:** `packages/sdk/README.md`, `packages/sdk/.claude/skills/presto/SKILL.md`,
  `packages/sdk/MIGRATION.md`, `packages/sdk-noir/README.md`, and `packages/landing/index.html`'s
  install snippet. Each gets the v6 `@testnet` install line plus v5 labelled as `latest`, and says
  native v6 needs Presto ≥ 1.1.3.
- **Update automation:** `.github/workflows/aztec-stable.yml` (`dist_tag: prerelease`).
- **Security docs:** `docs/SECURITY_MODEL.md`, covering the scope maintainers, the shared foundation
  account, provenance, and exact-pin reliance.
- **Keyed-run template (phase 7a):** `packages/playground/scripts/testnet-v6.env.example`, committed,
  with `# op: import` above `AZTEC_NODE_URL=op://Keyed-Runs/Presto-Testnet/AZTEC_NODE_URL`. The
  owner pastes the private RPC once through `op-remote create`.
- **Network cutover (phase 7b):** the RPC in `playground/vite.config.ts:175`, `playground/package.json`
  `dev:testnet`, `sdk/package.json` `test:e2e:remote`, `.github/workflows/smoke-playground.yml:14`.
- **Docs:** `CLAUDE.md` and `AGENTS.md` current state; `implementations-plan/follow-ups.md`.

### Non-obvious mechanics

- **`aztecDerivedOrder`.** Parse `X.Y.Z` plus an optional suffix into `(major, minor, patch, stage)`,
  where stage is −1 for a prerelease, 0 for stable and 1 for revision N. Two prereleases fall back
  to `Bun.semver.order` on the full strings. The chain 5.2.0-revision.5 < 6.0.0-rc.1 < 6.0.0-rc.1.1 <
  6.0.0-rc.2 < 6.0.0 < 6.0.0-revision.1 is a table test.
- **`resolvePublishVersion` already suffixes prereleases with `.N`.** This path has never met the
  registry (`presto` has never published a prerelease), so the pattern and order must accept
  `6.0.0-rc.1.1`.
- **Two age gates, one rule.** bunfig covers the workspace install; `setup-aztec`'s npm config covers
  the CLI installer's separate, unlocked graph. Both use exact names only, per the owner's decision.
  The installer's old `@aztec/*` glob would let any new package under a scope skip quarantine
  unreviewed, so it goes too. npm reads the list from repeated `min-release-age-exclude[]` npmrc
  lines, and the step asserts the parsed list, so no parsing inference remains. That assertion
  proves the configuration, not the graph: a new first-party package already past seven days
  installs regardless. So a separate check compares the installed Aztec names with the list on every
  job, a cache hit included.
- **Version-less requests bypass the cache.** A request without `x-aztec-version` takes the unversioned
  path (`server/prove.rs:57`): sidecar, then `~/.bb`, then `PATH`. That is why `native.test.ts` gains
  the header (the fixture's recorded bb.js version), and why the released-artifact gate runs with
  `BB_BINARY_PATH` unset, a `HOME` with no `.bb`, and a `PATH` with no `bb`.
- **The released desktop app bundles `bb` 5.2.0** as its sidecar, since R1 is built from v5 `main`.
  The headless `presto-server` archive contains only the server binary (`release-presto.yml:527`).
  Versioned requests fetch v6 `bb` on first use. The next app release after arc 3 bundles 6.0.0-rc.1, which is not part of this plan.
- **Noir fixtures are the WASM reference.** Regeneration needs `aztec-nargo` 6.0.0-rc.1 on the dev
  box through the official installer; `~/.aztec` holds only 5.0.1. Native identity is asserted by
  `sdk-noir/e2e/native.test.ts` against a live presto; `test:identity` proves WASM reproducibility.

### Trade-offs & alternatives not taken

- **A dual-source app (barretenberg first, aztec-packages as fallback).** Rejected. Every published
  SDK targets 5.2.0, which barretenberg serves with identical digests. A second source doubles the
  trust surface for no supported version.
- **A single `AZTEC_STDLIB` constant flipped in arc 3 (Fable).** Rejected. The reader must read both
  generations' artifacts (the legacy tarball, conflict hosts), and a module outside the `published`
  filter on the production build path would make the filter lie.
- **"Resolve every declared dependency" in the swap script.** Rejected: `@aztec/stdlib` and
  `@aztec/foundation` have no root export. The script resolves the named `bb-prover` and the
  adapter's peer through the reader instead.
- **v6 as `presto@6.0.0` stable.** Rejected: `npm i` would pick up a prerelease-Aztec artifact.
- **A separate `rc` tag (the audited draft).** Superseded by the owner (D29): the Aztec testnet runs
  6.0.0-rc.1, so `testnet` is the honest tag for it, and a second channel would add tag plumbing
  that no consumer needs.
- **`presto-noir@2.0.0` stable.** Rejected: it would reach `latest` at the next promotion and break
  v5 users.
- **Waiting for aztec-standards v6.** Rejected (A1): no release, no date.
- **Combining arcs 1 and 2 into one PR (Codex).** Viable. Kept separate so R1 never waits on tooling
  review.
- **Competing outline B** (below).

## Competing outline B: "v6-first, one PR"

B does everything in one PR on `main`:
- the scope rename, the tooling fixes, the `bb` source switch and the token swap;
- then a single app release built from v6 `main` (bundling `bb` 6.0.0-rc.1);
- then the SDK release.

**For B:**
- One review, one CI cycle, one release window.
- The app ships bundling v6 `bb`.

**Against B:**
- It touches `published`-filter files, so the required Published Playground Build fails until the
  SDK it pins is published from that same `main`. B therefore needs a gate bypass.
- The app release waits on the whole migration and the RPC, while every installed app cannot serve
  v6.
- A stable app bundles a prerelease `bb` that v5 users (the `latest` majority) don't use.
- A revert takes the source switch with it.

**Verdict:** A. Both auditors concur.

## Security & Adversarial Considerations

- **Threat model.** Presto runs a downloaded native binary on user machines. Attackers worth
  modelling:
  - a compromised upstream publisher, whether a GitHub release or an npm scope;
  - scope confusion or typosquats on the new names;
  - a release-channel mistake shipping prerelease code to `latest`;
  - a malicious or mistyped RPC steering a keyed L1 run.
- **bb supply chain.**
  - The source moves to another repository in the same organisation. The digest and the binary still
    come from one control plane, so matching the asset to GitHub's digest is a **consistency check,
    not publisher authentication**. The SEC-02 residual is unchanged, and `docs/SECURITY_MODEL.md`
    says so for barretenberg.
  - Kept: digest-first ordering, a metadata client that refuses redirects (a repository move fails
    closed rather than leaking a token across hosts), the caps and `DownloadBudget`.
  - Windows keeps hand-reviewed pins (F-008, `copy-bb.ts:42`). The 6.0.0-rc.1 pin is added only
    after the manual review recorded there: release page and tag, a diff against the prior asset,
    and the file's sha256 equal to the API digest `6335a036…`.
  - Who can publish barretenberg releases is not known; the plan does not rely on it.
- **npm supply chain.**
  - Age-gate exemptions extend to exact names. A bunfig glob is silently ignored, and the lock test
    pins the list to the resolved graph in both directions.
  - `@aztec-foundation/bb.js`'s `prerelease` tag already points at `7.0.0-nightly.20260928`, so
    exact pins are the only thing holding the version. The managed set stays exact.
  - Maintainers:
    - `@aztec-labs`: `nchamo` and `charlielye`;
    - `@aztec-foundation`: a shared service account plus `ludamad`.

    bb.js carries SLSA provenance and `@aztec-labs/*` carries none, the same as `@aztec/*@5.2.0`. The
    exemption therefore admits same-day publishes from a shared account. This residual is recorded
    in `docs/SECURITY_MODEL.md`, not hidden.
  - Our publishes keep trusted publishing, provenance and no token.
- **The production playground bundle.** It installs the provenance-verified **adapter and core**
  publications pinned in `published-sdk.json`. Upstream dependencies are verified only by lockfile
  integrity, and banners come from the workspace. The claim is scoped to exactly that.
- **Release channel.**
  - Every publish goes to `testnet`; `latest` moves only through promotion.
  - Promotion refuses a non-`testnet` tag (existing, forward only) and a prerelease (new, forward
    and `--rollback`). With `testnet` holding 6.0.0-rc.1, the prerelease refusal is the only thing
    keeping it off `latest`.
  - The pin moves forward only.
  - The published-playground build fails closed on graph drift.
- **Keyed FPC run.**
  - The private RPC reaches only the one process, through `env-exec`, and never the agent's
    commands or files. The L1 key is the owner-authorized exception: disposable, agent-generated,
    never printed, and deleted after use (A4).
  - The RPC is the one input that names every destination: portal, token, mint handler and FPC.
    Checking the chain id alone would not stop a lying node. So a **signer-free preflight** produces
    the destinations and amounts. The agent approves them only against an **independent anchor**,
    because the owner delegated funding (A4). The anchor is Aztec's published `network_config.json`
    (`AztecProtocol/networks`, `testnet.registryAddress` and `feeAssetHandlerAddress`), followed on
    L1 through the registry to the node's rollup version, that rollup's fee-asset portal and the
    portal's token. The signing key is disposable and holds only public-faucet funds, so a lying
    node can cost at most that balance. Hence: an anchor that **disagrees** with the node stops the
    run and surfaces to the owner, while an anchor that simply does not cover v6 is recorded and
    the run proceeds on the node's (owner-supplied) word. The keyed run takes the approved values
    as `--expect-*` arguments, reads the node once, and refuses any mismatch before it signs.
  - One node read, one snapshot. v6's `L1FeeJuicePortalManager.new(node, …)` calls `getNodeInfo()`
    again, so a node could answer the check truthfully and the factory with other addresses. The
    manager is built with its public constructor from the validated snapshot, and nothing reads a
    destination from the node after that.
  - The signer's own L1 RPC is a second trust input, so its `getChainId()` must also equal
    `--expect-chain`.
  - Every bridge operation counts toward one enforced total, bootstrap and FPC alike, and each amount
    is a bounded positive integer.
  - The funds are minted test FJ, so the worst case is Sepolia gas plus at most the approved total,
    sent to the approved addresses.
- **Least privilege.** No new secrets, workflow permissions or origins. The RPC is HTTPS, supplied by
  the owner.
- **The private RPC.** The owner has a keyed v6 RPC URL that must never become public. It lives in
  1Password and reaches only keyed runs through `env-exec`, as `AZTEC_NODE_URL`. It never appears in
  a commit, lessons, a PR, a CI secret or a deployed build. Before every push,
  `git grep -nE '/k/[0-9a-f]{32,}'` is empty. Only the public RPC, when the owner has it, is
  committed.
- **Smart contracts.**
  - Salt-0 SponsoredFPC is a public faucet by design; funding stays at A4's cap.
  - Token demo semantics: `constructor(admin=Alice, …)` makes Alice the minter; `transfer(bob, 500)`
    moves only the caller's own notes.

## Assumptions

### Facts (verified 2026-09-28; ✓✓ = re-verified independently by an auditor)

1. ✓✓ v6 rc.1 npm names exist as in `recon.md`, including `@aztec-labs/{kv-store,sqlite3mc-wasm,pxe,accounts,protocol-contracts,wallets,noir-contracts.js}`,
   with `engines.node >=20.10`. `@aztec-labs/aztec.js` dist-tags: `prerelease: 6.0.0-rc.1`,
   `latest: 6.0.0-nightly.20260829`, `tmp-publish`, and no `rc`.
2. `lazy.d.ts` and `chonk_proof.d.ts` are identical v5.2.0→v6 rc.1 after scope normalisation.
   `serializePrivateExecutionSteps` adds `kind`.
3. v6 `bb` (linux amd64, sha256 = API digest `a03fae96…`) accepts every flag Presto passes. ✓✓
   `@aztec-foundation/bb.js@6.0.0-rc.1` still ships `build/*/bb`, so `copy-bb.ts:240` holds.
4. ✓✓ barretenberg has v5.0.0-rc.1 through v6.0.0-rc.1. Every v5 release's assets match
   aztec-packages' except v5.0.1, which barretenberg rebuilt (all six `bb` tarballs differ; found in
   phase 1). aztec-packages has no v6 release. Nightlies older than 2026-06-30 and all v4.x are
   absent.
5. ✓✓ `VERSION_PATTERNS["aztec-derived"]` rejects `6.0.0-rc.1`; `revisionOrder` throws on it;
   `release-sdk.yml` passes no `dist_tag`; `promote-sdk-latest.ts:158-159` refuses a version not on
   `testnet`.
6. ✓✓ In the `published` filter, only `get-sdk-publish-version.ts:86`, `published-playground.ts:192-196`
   and `packaged-e2e-swap-sdk.sh:111,158` name Aztec packages.
7. ✓✓ aztec-standards has no 6.x. The reference `Token` exists in `@aztec-labs/noir-contracts.js`;
   `FeeJuice` moved to `@aztec-labs/aztec.js/protocol`.
8. ✓✓ npm state: presto latest=testnet=`5.2.0-revision.5`; core, noir and banners `1.2.0`. The app's
   Latest is `presto-v1.1.2`, with source at `1.1.3-rc.1`. `release-presto.yml:250` patches the
   version from the input.
9. The local-network token spec (`demo.local-network.spec.ts:76`) runs in CI under WASM.
10. The v6 installer lives at `install.aztec-labs.com`, reached by a 301 from `install.aztec.network`
    that `setup-aztec` follows. It runs `npm install @aztec-labs/aztec @aztec-labs/cli-wallet`.
11. ✓✓ `install-legacy-sdk.ts:68` throws when the fixture's stdlib differs from the workspace's; it
    runs on every SDK PR and in the release e2e.
12. ✓✓ `release-plan.ts` cannot plan on today's `main`: `presto-core@1.2.0` changed after its tag.
13. `Bun.resolveSync("@aztec/stdlib")` and `("@aztec/foundation")` fail, because there is no root
    export.

### Inferences (attack these)

- **I1.** Beyond imports, FeeJuice and Token, the playground and SDK e2e need no v6 API changes. The
  detector is the three-graph typecheck.
- **I2.** `aztec start --local-network` and `start-services`' `node_getNodeInfo`/`nodeVersion` probe
  behave the same in v6. Arc 3 names the installer edits (above); phase 6's local run and arc 3's CI
  are the detectors.
- **I3.** v6 native `bb` reproduces v6 bb.js WASM byte for byte for `*-no-zk`. The detectors are
  `native.test.ts` in phase 5 and phase 6's released-artifact run, plus the WebDriver Noir test on
  all three OSes in arc 3's CI.
- **I4.** The v6 network's L1 is Sepolia-like, with a FeeJuice portal reachable through
  `L1FeeJuicePortalManager`, and a faucet mint capped at 1,000 FJ per call. Salt-0 SponsoredFPC is
  absent or unfunded. The signer-free preflight shows the real values before any signing key is involved.
- **I7.** `AztecProtocol/networks`' `network_config.json` (last changed 2026-05-28) may predate the
  v6 testnet and name an older registry. The detector is phase 7's anchor check, which then stops
  and surfaces rather than funding.
- **I5.** Installed apps reach 1.1.3 through auto-update within days. Until then, v6 pages fall back
  to WASM on those machines. Documented; not blocking.
- **I6.** `bb` 6.0.0-rc.1 on Windows keeps the text-mode bug that `--output_format json` routes
  around. The detector is arc 3's Windows WebDriver lane.

### Asks (surfaced for approval, not silently assumed)

Owner answers, 2026-09-28, are recorded after each Ask.

- **A1: the token demo contract.** Today's demo uses `@aztec-foundation/aztec-standards@5.2.0`
  (`AztecProtocol/aztec-standards`: tags end at `v5.2.0`, no v6 branch, last `main` commit
  2026-08-19). Aztec's reference `Token` (`@aztec-labs/noir-contracts.js`), with the flow
  rewritten. *Owner: yes.* This drops `aztec-standards` from the repo entirely: the playground
  dependency, its lock entry, and `update-aztec-version.ts`'s `LOCKSTEP_PACKAGES`, which only
  existed for it.
- **A2: the npm channel.** *Owner: the Aztec testnet runs 6.0.0-rc.1.* So v6 artifacts (presto
  6.0.0-rc.1, noir 2.0.0-rc.1, core 1.2.1) publish to `testnet`, the tag that tracks that network.
  `latest` keeps v5 presto `5.2.0-revision.5` and noir `1.2.0` until v6 is stable; no prerelease is
  ever promoted.
- **A3: app version for R1.** `1.1.3`: a patch, since the only change is where `bb` downloads come
  from. *Owner: ok.*
- **A4: RPC and FPC funding.** *Owner: the agent handles funding with disposable keys it creates
  itself, public faucets and the public contracts; the keys are never used again.*
  - A private, keyed v6 RPC exists now (1Password, keyed runs only; see Security). The public RPC
    follows, and only it is ever committed.
  - Caps: bootstrap account **1,000 FJ** (one faucet mint), FPC **1,000 FJ** (the 5.x practice),
    **total 2,000 FJ**. Expected L1: Sepolia, chain id 11155111.
  - The disposable L1 key is generated by a short script that writes it to a `0600` file under
    `~/.cache/presto/aztec-v6-fund/` (real disk, outside the repo) and prints only the address. It
    holds nothing but public-faucet Sepolia ETH and handler-minted FJ, and the file is deleted once
    the FPC balance is recorded. The address, never the key, goes in lessons.
  - Sepolia ETH comes from a public faucet. Most gate on a captcha or an account; if none dispenses
    to a script, the owner sends a small amount of Sepolia ETH to the printed address (an address
    only, no key crosses).
  - The agent checks the preflight against the independent anchor (Security) and records the
    manifest and anchor reads in lessons.
- **A5: release authorizations.** *Owner: the agent dispatches.* R1 (publish, then promote) and R2
  (dry run, then real dispatch, which triggers the pin PR and the playground deploy) are dispatched
  by the agent once each step's preconditions hold. The release environments have no required
  reviewers (verified 2026-09-28).
- **A6: the legacy-SDK interop gate.** The install step and the test skip, with a named notice, when
  the legacy fixture's Aztec major differs from the workspace's, so the gate is dormant on v6. A
  follow-up re-arms it against the previous published presto rc once `6.0.0-rc.1` exists. *Owner:
  ok.*
- **A7: merges.** *Owner: the agent merges all of them, after Codex loops that end with no critical
  or high findings.* The agent merges each arc PR once its checks are green and its Codex loop has
  converged with the final round reporting no CRITICAL or HIGH finding (arc 3 also needs the
  cross-arc pass to meet that bar). It merges the pin PR once its checks pass, if auto-merge does
  not fire.

## Phases

Every gate includes the fast layers. PRs open only in Delivery. Local services claim ports from
`~/.agents/ports.md`, run in their own process group with a real-disk data directory, and are torn
down by process group.

### Phase 1: `bb` from barretenberg (arc 1) ✓

**Validation gate:**
- `bun run test && bun run lint` exit 0.
- `cargo test --locked --manifest-path packages/presto/core/Cargo.toml` exit 0.
- With `PRESTO_HOME` set to a fresh real-disk directory (never the shared cache),
  `PRESTO_DOWNLOAD_TEST=1 AZTEC_BB_VERSION=<v> cargo test --locked --manifest-path packages/presto/core/Cargo.toml download_and_verify_bb -- --nocapture`
  passes for both `5.2.0` and `6.0.0-rc.1`.
- `bun run bb:download 5.2.0` exit 0.
- `rg -n 'aztec-packages/releases|repos/AztecProtocol/aztec-packages' packages scripts docs README.md .github -g '!node_modules'`
  returns only licence-text URLs that arc 3 re-keys.

Layers: lint · unit · Rust unit · live download (two versions, isolated).

### Phase 2: prerelease versioning and the promotion guard (arc 2) ✓

**Validation gate:**
- `bun run test && bun run lint && bun run lint:actions` exit 0.
- Table tests pass for each of the following:
  - the `aztecDerivedOrder` chain above;
  - the pattern accepting `6.0.0-rc.1`, `6.0.0-rc.1.2` and `6.0.0-nightly.20260829`, and rejecting
    `6.0.0-foo.1`;
  - `raisePin` moving `5.2.0-revision.5` → `6.0.0-rc.1` and `1.2.0` → `2.0.0-rc.1`, and refusing
    the reverse;
  - promotion refusing `6.0.0-rc.1` and `2.0.0-rc.1`, both forward and with `--rollback`;
  - `planRelease` over synthetic facts: a v6 base plans presto `6.0.0-rc.1`; a repeat plans
    `6.0.0-rc.1.1`; noir `2.0.0-rc.1`; core `1.2.1`.

Layers: lint · typecheck · unit · workflow lint.

### Phase 3: one scope-agnostic Aztec manifest reader (arc 2) ✓

**Validation gate:**
- `bun run test && bun run lint && bun run lint:actions` exit 0; `lint` includes shellcheck.
- The `aztec-manifest` tests pass:
  - v5 and v6 SDK manifests;
  - the Noir adapter's peer under both scopes;
  - both scopes present (`find` and `require` both throw);
  - none present (`find` returns `undefined`; `require` throws);
  - `exact-pin.ts` accepts a `manifest` package with no stdlib and rejects an `aztec-derived` one.
- The `update-aztec-version` tests cover a `@aztec-labs/` pin, an exact foundation name, and an
  unrelated `@aztec-foundation/x` left untouched.
- `bun scripts/aztec-manifest.ts packages/sdk/package.json` prints `5.2.0`.
- `scripts/sdk-tarball-consumer.sh` passes for each package key against a locally packed v5 tarball,
  including the conflict host. This is the same script `_ts-package-ci.yml` runs.
- `rg -n "@aztec/(stdlib|bb-prover|bb\.js|aztec\.js)" scripts .github -g '!*.test.ts'` shows every
  remaining hit is inside `aztec-manifest.ts` or a comment.
- The Published Playground Build on this PR (at delivery) passes on v5.

Layers: lint · unit · consumer install · workflow lint.

### Phase 4: v6 dependencies, imports and CI installer policy (arc 3)

**Validation gate:**
- `bun install --frozen-lockfile` exit 0 with no min-age skips.
- `bun run test && bun run lint && bun run lint:actions` exit 0, including the three-graph
  typecheck and the exemption-to-lock test.
- `bun run --cwd packages/sdk-core build && bun run --cwd packages/sdk build && bun run --cwd packages/sdk-noir build && bun run --cwd packages/playground build`
  exit 0; the licence step fails on any unmapped package.
- `scripts/sdk-tarball-consumer.sh` passes for `presto`, `presto-core` and `presto-noir` against
  v6 tarballs packed from this branch.
- `bun run --cwd packages/presto prebuild` writes `AZTEC_VERSION` = `6.0.0-rc.1`.
- In a scratch prefix, with the step's temporary npmrc:
  - `npm config get min-release-age-exclude` prints exactly the reviewed name list;
  - the v6 installer's `npm install` gives no ETARGET and no blocked-packages warning;
  - `aztec --version` prints `6.0.0-rc.1`.

  The reviewed list and `npm ls --all` of the installed tree are recorded in lessons. Every
  `@aztec-labs`, `@aztec-foundation` and `@aztec/viem` name in the tree is listed, and nothing else.
- The graph-check script passes on that scratch tree, and its test fails with a named addition for
  an unlisted, quarantine-aged package and with a named removal for a listed, absent one. On this
  PR's CI, the check step runs and passes on both a cache miss and a re-run that hits the cache.
- `git diff --name-only origin/main...` intersected with `app.yml`'s `published` list is empty.
- `rg -n --pcre2 '@aztec/(?!viem)' packages scripts .github README.md docs -g '!node_modules' -g '!**/archive/**'`
  hits only:
  - `aztec-manifest.ts` and its tests;
  - the legacy fixture and legacy installer;
  - labelled v5 sections of shipped docs;
  - changelog history.

Layers: lint · typecheck ×3 · unit · build · consumer install · installer dry run.

### Phase 5: Noir fixtures and adapter gates (arc 3) ✓

**Validation gate:**
- After installing `aztec-nargo` 6.0.0-rc.1 and running `bun scripts/noir-fixture.ts --regenerate`,
  `bun scripts/noir-fixture.ts --verify` exits 0 and every manifest records `bbJs: 6.0.0-rc.1`.
- `bun run --cwd packages/sdk-noir test:identity` passes.
- `native.test.ts`'s raw requests send `x-aztec-version` set to the fixture's recorded bb.js version,
  so they exercise the versioned path the adapter uses.
- `PRESTO_URL=http://127.0.0.1:<port> bun run --cwd packages/sdk-noir test:e2e` passes (5 tests,
  `fallback: "none"`, including `native.test.ts`'s byte identity). It runs against `presto-server`
  built from this branch, with a private `PRESTO_HOME` and the port claimed from the registry.
- `bun run test` exit 0.

Layers: unit · integration (native bb 6 against the committed WASM reference).

### Phase 6: token demo, legacy gate and local-network e2e (arc 3; needs R1 published) ✓

Rewrite the token flow for the reference `Token`: `constructor(alice, …)`, `mint_to_private(alice,
1000n)`, `transfer(bob, 500n)` sent from Alice, and balances of 500/500. The narrative and copy are
unchanged. Add the legacy-gate skip (A6).

**Validation gate:**
- `bun run test` exit 0.
- With port 5173 claimed in the registry, since Playwright hardcodes it and reuses an existing server:
  - `bun run --cwd packages/playground test:e2e` passes (mocked, including Noir);
  - `bun run --cwd packages/playground test:e2e:production-smoke` passes.
- On a v6 local network owned by this run (`aztec start --local-network`, with claimed ports):
  - `PRESTO_URL=<branch presto-server> AZTEC_NODE_URL=http://127.0.0.1:<node-port> bun run --cwd packages/sdk test:e2e`
    passes, including transmit, and the legacy step logs its skip notice;
  - `AZTEC_NODE_URL=http://127.0.0.1:<node-port> bun run --cwd packages/playground test:e2e:local-network`
    passes, with the Local token flow at 500/500.
- **The released artifact.** Download the published `presto-server` 1.1.3 linux asset from the
  `presto-v1.1.3` release and check it against the release's `.sha256` asset. The archive holds only
  the server binary. Start it with:
  - an **empty** real-disk `PRESTO_HOME`;
  - `BB_BINARY_PATH` unset;
  - a `HOME` with no `.bb`;
  - a `PATH` containing no `bb`.

  This way the only `bb` it can run is one it downloads. Then:
  - The SDK e2e above passes against it: a native Chonk deployment accepted by the local network,
    with `transmit` in the phases.
  - `bun run --cwd packages/sdk-noir test:e2e` passes against it: native UltraHonk, byte-identical to
    the v6 fixture and verified.
  - `$PRESTO_HOME/versions/6.0.0-rc.1/bb` exists, and its tarball's sha256 equals barretenberg's
    digest. `BB_BINARY_PATH` would override even a versioned request (`bb.rs:49`), which is why it
    stays unset. A versioned request never falls back to another version (`find_bb`, F-007), so no
    other `bb` could have answered.
  - **Coexistence.** Export the `square` fixture as it was at `4cdc2f2` (bb.js 5.2.0) to a temporary
    directory. A raw `POST /prove/ultra-honk` with `x-aztec-version: 5.2.0` returns that commit's
    committed proof byte for byte. `versions/` then holds `5.2.0` and `6.0.0-rc.1`, each
    digest-verified, and a repeat v6 request succeeds without a new download.

Layers: unit · UI-mock e2e · production-bundle smoke · e2e against a local network (branch build and
released artifact).

### Phase 7: network cutover (arc 3; 7a needs the private RPC, 7b the public one)

The private RPC arrives only as `AZTEC_NODE_URL` inside keyed runs. Scripts that hardcode a URL
inline (`sdk` `test:e2e:remote`, `playground` `dev:testnet`) are invoked through their underlying
command in 7a, never edited to carry it. Lessons record node answers, never the URL.

**7a validation gate (private RPC, keyed runs):**
- The FPC scripts' keyless tests pass: malformed amounts, a cap breach, a wrong destination, a node
  or L1 chain mismatch, and disagreeing successive node answers are each refused (or pinned to the
  validated snapshot) before any signer is built.
- `rg -n 'L1FeeJuicePortalManager\.new' packages/playground/scripts` is empty.
- A keyed `node_getNodeInfo` records `nodeVersion` 6.0.0-rc.1 and `l1ChainId` 11155111.
- The salt-0 SponsoredFPC state is recorded in lessons. If it is unfunded:
  1. The keyed `--preflight` manifest (chain, portal, token, mint handler, FPC, amounts) is checked
     against the independent anchor (Security). A disagreeing anchor stops here and surfaces to the
     owner; an anchor that does not cover v6 is recorded.
  2. The disposable key's address and its Sepolia ETH balance are recorded.
  3. The funding run (an `env-exec request` for the RPC, reading the disposable key file) passes
     exactly the manifest's values as `--expect-*`, and bridges no more than A4's total.
  4. The FPC's FeeJuice balance above zero is recorded, and the key file is deleted.
- Keyed, against a `presto-server` from this branch: `test:live`, the playground `test:e2e:smoke`
  (the demo smoke asserts `expectNativeProof`), and the SDK's remote-network test all pass.
- `git grep -nE '/k/[0-9a-f]{32,}'` is empty.

**7b validation gate (public RPC, when the owner has it):**
- The public RPC appears in the four cutover locations, and no v5 RPC string remains
  (`rg -n 'v5\.testnet\.rpc' packages .github` is empty).
- `test:live` and `test:e2e:remote` pass against it, with no key involved.
- `bun run test && bun run lint:actions` exit 0.

Layers: e2e against the live v6 network, native.

## Releases (agent-dispatched per A5; outside the phase gates)

Each step runs only when the previous one is green; any red step stops the release and surfaces.

- **R1: app 1.1.3.** After arc 1 merges:
  1. `gh workflow run release-presto.yml -f mode=publish -f version=1.1.3`.
  2. Watch the gates.
  3. `-f mode=promote-only -f version=1.1.3 -f dry_run=true`, then the real `promote-only`.
  4. `verify-live-feed` green.

  Record run IDs in `lessons/releases.md`. `promote-only 1.1.2` is the rollback lever.
- **R2: SDKs.** After arc 3 merges (so after 7b):
  1. `gh workflow run release-sdk.yml -f packages=all -f dry_run=true`. The plan must show core
     1.2.1, noir 2.0.0-rc.1 and presto 6.0.0-rc.1, all to `testnet`, and banners reused.
  2. The real dispatch.
  3. Watch it through `bump-playground`. The pin PR auto-merges, or the agent merges it once its
     checks pass (A7).
  4. Workers Builds deploys production.
  5. `gh workflow run smoke-playground.yml -f aztec_node_url=<public rpc>` green.
  6. Check `npm view @alejoamiras/presto dist-tags`: `latest` = `5.2.0-revision.5` and `testnet` =
     `6.0.0-rc.1`. The same holds for noir (`1.2.0` and `2.0.0-rc.1`).
  7. Verify the live site: a v6 native proof on playground.presto.build with Presto 1.1.3.

## Delivery

Three PRs, not a stack. Arcs 1 and 2 are independent in code; arc 2 branches from `main` after arc
1 merges, so `plan.md` travels with it, and R1 runs while arc 2 is built. Arc 3 is based on `main`
after both merge. A stack would chain arc 1's release behind arc 3's RPC wait. `code_review:
off` for all three.

| Arc | Branch | Phases | Base | `/code-review` | Then |
|---|---|---|---|---|---|
| 1: bb from barretenberg | `worktree-aztec-v6` | 1 | `main` | off | merge per A7 → R1 |
| 2: prerelease release tooling | `aztec-v6-tooling` | 2, 3 | `main` | off | merge per A7 |
| 3: v6 migration | `aztec-v6-migration` | 4, 5, 6, 7 | `main` after arcs 1 and 2 | off | merge per A7 → R2 |

`plan.md` and `recon.md` are committed in arc 1's PR and updated in later ones. Each PR opens only
after its own quality loop converges; arc 3's also waits for the cross-arc pass, and may open after
7a. 7b then lands on the same PR with a resumed Codex pass over its delta, and arc 3 merges only
after 7b. PR bodies state:
- the release each enables;
- the fail-closed playground window (arc 3);
- any lane the PR does not exercise, such as the packaged e2e, which runs only in the release.

## Post-implementation

1. **No `/code-review`** (`code_review: off`).
2. **Per-arc Codex loop** (after phase 1; after phase 3; after phase 7). Send `/codex high`:
   - the arc's diff, `plan.md`, the decision ledger and the arc map ("arc N of 3; arc 3 renames every
     Aztec dependency and must touch no `published`-filter file; arc 2's reader exists so it need
     not");
   - an adversarial and security ask;
   - these two rules, verbatim:
     - *"Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone."*
     - *"Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact."*
3. **Fix loop.**
   1. Verify each finding against the repo.
   2. Apply the accepted fixes and commit.
   3. Log the round in `lessons/arc-N-review.md`.
   4. Resume the same Codex session with the fix diff.

   Repeat until a round has no new material findings. Still material after 3 rounds: stop and
   surface it. A PR merges only when its loop's final round reports no CRITICAL or HIGH finding
   (A7).
4. **Cross-arc pass** (after arc 3's loop). Open a fresh `/codex high` session over `4cdc2f2..HEAD`,
   asking for:
   - seams between arcs (does arc 3 read every Aztec name through `aztec-manifest.ts`?);
   - duplication;
   - drift from this plan;
   - the same two rules.

   Same loop.
5. **Delivery** per the table:
   - `gh pr create` per arc, with a proper body;
   - `gh pr checks --watch`;
   - the agent merges each arc PR once its checks are green and its Codex loop ends with no
     CRITICAL or HIGH finding (A7), then runs the release that PR enables (A5).
6. **Close-out** (a small `aztec-v6-closeout` PR after R2, merged by the agent under the same bar,
   since the Outcome needs R2's result):
   - `## Outcome` after the front matter;
   - promote to `implementations-plan/lessons.md` (about 8 KiB; dedupe): the `published`-filter
     constraint on bumps, the two age gates, barretenberg as the `bb` source;
   - close the core/noir bump follow-up;
   - add follow-ups: the legacy gate re-armed against the previous presto rc, `latest` promotion when
     Aztec v6 goes stable, the next app release bundling v6 `bb`;
   - archive after the merge.

**Post-implementation hardening:** no `/harden`. The trust boundaries are unchanged and no secret or
permission is added; the supply-chain deltas are recorded above and in `docs/SECURITY_MODEL.md`.

## Decision ledger

| # | Decision | Source | Status |
|---|---|---|---|
| D1 | Outline A (three arcs) over B (one PR) | draft; Codex and Fable concur | adopted |
| D2 | Three independent PRs, not a `gh stack` | draft | adopted; Codex notes arcs 1 and 2 could merge into one PR, kept separate so R1 never waits |
| D3 | One dual-scope `aztec-manifest.ts` reader, in the `published` filter, routing all 13 reads | Codex (tarball chain, filter membership), Fable (legacy installer, count), draft | adopted |
| D4 | Fable: a single constant flipped in arc 3 instead | Fable LOW | **rejected**: both generations' artifacts are read; a build-path module outside the filter makes the filter lie |
| D5 | Swap script resolves the named `bb-prover` and the adapter's peer, not "every dependency" | Codex HIGH (no root exports; peer dropped) | adopted |
| D6 | Tarball consumer (`exact-pin`, `host-manifest`, `sdk-tarball-consumer.sh`, conflict host) migrated | Codex HIGH, Fable HIGH | adopted (arc 2 reader, arc 3 data) |
| D7 | `setup-aztec` installer exemptions and allow-scripts re-reviewed for v6; cache salt bumped | Codex HIGH, Fable MEDIUM | adopted (arc 3) |
| D8 | Phase 2 gate: `planRelease` table tests over synthetic facts, not a live dry run | Codex MEDIUM, Fable MEDIUM | adopted |
| D9 | Supply-chain claims scoped (bundle provenance covers adapters and core only; digest = consistency) | Codex MEDIUM | adopted |
| D10 | Released-artifact gate: `presto-server` 1.1.3 from a cold cache proves v6 Chonk and UltraHonk natively | Codex HIGH | adopted (phase 6; R1 before phase 6) |
| D11 | Local isolation: private `PRESTO_HOME` for the download test; port 5173 claimed; node URL wired | Codex MEDIUM | adopted |
| D12 | FPC run capped, destination-checked, no default RPC; exact-amount bridge | Codex HIGH, Fable MEDIUM | adopted (A4 sets the cap) |
| D13 | A2's core-on-`testnet` exception stated; A7 pin-PR fallback; docs (README, skill, landing) get `@rc` | Codex MEDIUM | adopted |
| D14 | Legacy-SDK gate dormant on a major mismatch (A6), fixture kept | Fable HIGH | adopted pending A6 |
| D15 | Phase 4 grep without the quote anchor, covering shipped `.md` | Fable MEDIUM | adopted |
| D16 | Security residual: maintainers, shared account, provenance, exact pins → `SECURITY_MODEL.md` | Fable LOW | adopted |
| D17 | Prune Windows pins absent from barretenberg; test URL fixture to 5.2.0 | Fable LOW | adopted |
| D18 | bb.js licence text re-sourced from barretenberg | Fable LOW | adopted |
| D19 | `noir-fixture.ts` reuses `resolveAztecBb()` | Codex MEDIUM (scope edit), dedup | adopted |
| D20 | A dual-source app (barretenberg, then aztec-packages) | draft alternative | rejected: no supported version needs it |
| D21 | Released-artifact gate reworked: the headless archive has no bundled `bb`; `native.test.ts` sends `x-aztec-version`; `BB_BINARY_PATH`, `~/.bb` and `PATH` `bb` excluded; coexistence proven by a versioned 5.2.0 request with the v5 fixture | final Codex HIGH | adopted (supersedes D10's wording) |
| D22 | Outcome criteria restated to the real evidence: Chonk = a native deployment the network accepts; UltraHonk = byte identity plus verification | final Codex MEDIUM | adopted |
| D23 | FPC: a keyless preflight manifest (chain, portal, token, mint handler, FPC, amounts) approved first; the keyed run bound to it by `--expect-*`; bootstrap and FPC amounts under one enforced total; keyless refusal tests | final Codex HIGH ×2 | adopted (supersedes D12's mechanics; A4 now has three caps) |
| D24 | Installer exemption: exact names only (no `@aztec-labs/*` glob; the old `@aztec/*` glob dropped too), as `min-release-age-exclude[]` npmrc lines with the parsed list asserted; I7 removed | final Codex HIGH + MEDIUM | adopted (supersedes D7's glob) |
| D25 | Reader contract: `find` is optional and `require` is mandatory; ambiguity always throws; nobody catches its errors | final Codex MEDIUM | adopted |
| D26 | Promotion's prerelease refusal also covers `--rollback` | final Codex (looks-fine note) | adopted |
| D27 | FPC manager built by its public constructor from the one validated node snapshot, never `.new(node)` (v6 re-reads `getNodeInfo()`); the L1 client's chain id checked too; a disagreeing-node test | final Codex round 2 HIGH (verified in the rc.1 tarball) | adopted |
| D28 | Installer graph check on every job, cache hit included: installed Aztec-scoped names must equal the committed list file, with named additions and removals | final Codex round 2 MEDIUM | adopted |
| D29 | v6 artifacts publish to `testnet`, not a new `rc` tag; `distTagFor`, the tag outputs and the allowlist are dropped; the prerelease promotion refusal becomes the only guard on `latest` | owner (A2: the testnet runs rc.1) | adopted (supersedes the `rc` channel and D13's `@rc`) |
| D30 | Funding delegated to the agent: the preflight is approved against an independent anchor (`AztecProtocol/networks` registry, followed on L1), stopping on a missing or disagreeing anchor | owner (A4) | adopted (supersedes "the owner approves the preflight") |
| D31 | Phase 7 split: 7a runs every live check and the funding through keyed runs on the private RPC; 7b commits only the public RPC; arc 3 merges after 7b | owner (private RPC now, public later) | adopted |
| D32 | The agent dispatches R1 and R2 (with a promote dry run first) and merges the pin PR | owner (A5, A7) | adopted |
| D33 | Reference `Token`, and `aztec-standards` leaves the repo with its `LOCKSTEP_PACKAGES` mechanism | owner (A1) | adopted |
| D34 | Funding uses an agent-generated disposable L1 key (0600 file outside the repo, never printed, deleted after) and public faucets; a disagreeing anchor stops the run, a non-covering one is recorded | owner (A4) | adopted (refines D30) |
| D35 | The agent merges the three arc PRs once CI is green and the Codex loop's final round has no CRITICAL or HIGH finding | owner (A7) | adopted |

**Still disputed:** none. **Open for the owner:** A1–A7.

## Audit verdicts

- **Codex (plan audit, GPT-6 Astra `high`, session `01a0e891-ab42-7643-95d2-f2379cc14173`):**
  `reject (with blocking findings: omitted tarball-consumer migration, an arc-2 resolution
  regression, and an uncapped FPC funding operation)`.
  - 11 findings: 5 HIGH, 6 MEDIUM, all verified against the tree and all adopted (D3, D5–D13).
  - Its "looks fine": app-before-SDK sequencing, noir major prerelease, core stable patch,
    `_publish-npm.yml`'s dynamic tag read-back, digest-first downloading, and no release-feed
    migration needed.
- **Fable (plan audit, Plan agent):** `conditional approve (with conditions: legacy gate; tarball
  consumer chain; setup-aztec exclusions and allow-scripts; FPC default RPC; phase 2 gate; phase 4
  grep)`.
  - All six conditions are adopted (D6, D7, D8, D12, D14, D15).
  - Of its four LOWs, three are adopted (D16–D18) and one rejected (D4).
  - It independently confirmed:
    - the `published`-filter constraint is real;
    - promotion already refuses non-`testnet` tags;
    - the provenance purl is fine for prereleases;
    - `raisePin` ordering works once arc 2 lands;
    - banners reuse holds.
- **Codex (final, fresh session `01a0e8a1-7146-7d92-8ca2-6b77d2c3c1fc`), round 1:** `reject (with
  blocking findings: D10's released-artifact gate is unsound, D12 does not enforce the approved
  funding boundary, and D7 exceeds the owner's exact-name exemption decision)`.
  - 6 findings: 4 HIGH, 2 MEDIUM, plus one note. All were verified against the tree
    (`release-presto.yml:527`, `server/prove.rs:57`, `native.test.ts:93`, `batch-fund-fpc.ts:83,255`,
    `deploy-sponsored-fpc.ts:154,179`) and all adopted (D21–D26).
  - Its "looks fine": D4, D5, D6 and D8; arcs 1 and 2 kept separate; outline B still deadlocks; R1
    before phase 6; arc 3's empty filter intersection; the fail-closed window; `rc` routing; core on
    `testnet`; A6.
- **Codex (final session), round 2:** `conditional approve (with conditions: bind transaction
  construction to validated destinations; enforce installer graph/list equality on every run)`.
  - It confirmed that D21, D22, D25 and D26 close their findings.
  - Both conditions were verified. `L1FeeJuicePortalManager.new` in the `6.0.0-rc.1` tarball calls
    `node.getNodeInfo()`, and its constructor is public. The cache-hit path skips the install step
    (`setup-aztec` `cache-hit` guard).
  - Both conditions are adopted as D27 and D28, so no HIGH finding remains open.

## Seeds

Final (approved 2026-09-28). ELI5 companion: an Artifact at
https://claude.ai/artifact/KDx6bBo6EXS1drihmdSFJg, built from the gitignored
`implementations-plan/aztec-v6/eli5.html`. Run inside the `aztec-v6` worktree
(`agent-worktree resume aztec-v6`); one seed per session. `/goal` per wave is recommended.

**Wave 1 (arcs 1 and 2, R1):**

```
/goal Phases 1, 2 and 3 marked ✓ in implementations-plan/aztec-v6/plan.md (the phase headers in the file — not the chat, not the task list), each ✓ backed by that phase's validation gate as written in plan.md reported passing in the transcript; for each phase `LESSONS_FILE=implementations-plan/aztec-v6/lessons/phase-N.md` printed in the transcript; plan.md's `code_review` is `off`, so `/code-review` was NOT run; the codex fix loop converged for arc 1 (after phase 1) and for arc 2 (after phase 3), each evidenced by a resumed codex pass quoted in the transcript reporting no new material findings and no CRITICAL or HIGH finding; the arc 1 PR from `worktree-aztec-v6` and the arc 2 PR from `aztec-v6-tooling` (branched from main after arc 1 merged) were each created only after its loop converged, and each shows green `gh pr checks` and then `gh pr view --json state` = MERGED in the transcript; R1 is complete per plan.md's Releases section (release-presto publish 1.1.3, promote-only dry run, promote-only and verify-live-feed all green, run IDs in lessons/releases.md); `bun run test`, `bun run lint` and `bun run lint:actions` report exit 0 in the transcript. Never force-push a shared branch, commit or print the private RPC, or expand scope beyond plan.md.
```

**Wave 2 (arc 3 through 7a; after R1):**

```
/goal Phases 4, 5, 6 and 7a marked ✓ in implementations-plan/aztec-v6/plan.md (the phase headers in the file — not the chat, not the task list), each ✓ backed by that phase's validation gate as written in plan.md reported passing in the transcript — phase 6 including the released presto-server 1.1.3 cold-cache run (sanitized env, versioned v6 and v5 requests), phase 7a including the SponsoredFPC state recorded and, if it was unfunded, the anchor check, the disposable key's address and the FPC's FeeJuice balance recorded, with every private-RPC command run only as an env-exec keyed run; for each phase `LESSONS_FILE=implementations-plan/aztec-v6/lessons/phase-N.md` printed; `/code-review` was NOT run; the codex fix loop for arc 3 and a FRESH cross-arc codex pass over 4cdc2f2..HEAD each converged, evidenced by a resumed codex pass quoted in the transcript reporting no new material findings and no CRITICAL or HIGH finding; the arc 3 PR from `aztec-v6-migration` exists, created only after both loops converged, its body stating 7b pending, R2 and the fail-closed playground window, with green `gh pr checks` in the transcript; `git grep -nE '/k/[0-9a-f]{32,}'` prints nothing; `bun run test`, `bun run lint` and `bun run lint:actions` report exit 0. Never force-push a shared branch, commit or print the private RPC, use any L1 key but the disposable one, merge arc 3 before 7b, or expand scope beyond plan.md.
```

**Wave 3 (7b, merge, R2, close-out; after the owner supplies the public RPC):**

```
/goal Phase 7b marked ✓ in implementations-plan/aztec-v6/plan.md, backed by its validation gate reported passing in the transcript; a resumed codex pass over the 7b delta quoted in the transcript reports no new material findings and no CRITICAL or HIGH finding; the arc 3 PR shows green `gh pr checks` and then `gh pr view --json state` = MERGED; R2 is complete per plan.md's Releases section (release-sdk dry run, then the real dispatch, the pin PR merged, the Workers Builds deploy, smoke-playground green, and `npm view` showing `latest` = 5.2.0-revision.5 and `testnet` = 6.0.0-rc.1 for presto, 1.2.0 and 2.0.0-rc.1 for noir), run IDs in lessons/releases.md; the `aztec-v6-closeout` PR (Outcome block, lessons promoted, follow-ups moved) is MERGED; `bun run test`, `bun run lint` and `bun run lint:actions` report exit 0. Never force-push a shared branch, commit or print the private RPC, or expand scope beyond plan.md.
```

**Alternative (any wave): `/loop`**

```
/loop 15m Drive implementations-plan/aztec-v6 forward. Never idle waiting for my input. Each firing:
1. Reality check: read implementations-plan/aztec-v6/plan.md and lessons/ (authoritative — not the chat), including Outcome & Quality Bar. If that path is gone, look for implementations-plan/archive/aztec-v6/plan.md — the plan closed: STOP. If plan.md carries an `## Outcome` block: STOP. Task list empty? Rebuild it from plan.md's remaining steps; run `git status` and `git log --oneline -5`; for open PRs `gh pr view --json statusCheckRollup` (no --watch).
2. Waiting on CI or a release run is fine — confirm it progresses (`gh run watch` up to 10 minutes; stuck → inspect logs, log it as blocked in lessons). Use the wait productively without conflicting changes.
3. No task in hand? Take the next step in plan.md order: arc 1 → merge → R1, with arc 2 from the updated main alongside → merge → arc 3 from main (phase 6 needs R1 published) → 7a (keyed runs: file `env-exec request`, give me the `op-remote` line, wait) → PR → 7b once I have supplied the public RPC → merge → R2 → close-out. A missing prerequisite holds only that step. After each meaningful edit run `bun run lint` + `bun run test` (or the specific test file first). Commit (signed, conventional) and push the arc's branch.
4. Stuck, or a decision you'd normally bring to me? `/codex high` with full context, reach a defensible decision, act, and log the consult + verdict in lessons/phase-N.md. Hard limits: never force-push a shared branch, commit or print the private RPC, use any L1 key but the disposable one, or expand scope beyond plan.md — surface and hold.
5. Same step failed 5 times? Stop, reassess with codex, continue down the agreed path.
6. Phase green (its plan.md validation gate passes)? Paste the result, mark ✓ in plan.md, write lessons/phase-N.md, print `LESSONS_FILE=implementations-plan/aztec-v6/lessons/phase-N.md`, run `agent-worktree status aztec-v6 "phase N green: <next>"`, advance. Arc boundary (after 1, 3, 7a)? `/code-review` is off — run the codex loop per plan.md's Post-implementation (arc diff, plan.md, ledger, arc map, adversarial ask, both verbatim rules) until a round has nothing material; arc 3 also needs the fresh cross-arc pass over 4cdc2f2..HEAD. Then open the PR per Delivery and `gh pr checks --watch`. Merge only when checks are green and the final codex round has no CRITICAL or HIGH finding, then dispatch that arc's release per plan.md's Releases section, each step only after the previous one is green.
7. Everything done, or only my public RPC missing? Write the wrap-up: what shipped, every contentious decision codex and I debated with plain-language context, what waits on me. Surface and stop.
Keep the task list current; plan.md stays the source of truth.
```

---
plan: presto-rc3
tier: mid
driver: claude-code
eli5_mode: file
code_review: off
claude_model: opus
codex_model: sol
explainer: off
status: approved 2026-10-13 (director, conditional; conditions under Approval)
created: 2026-10-13
worktree: .claude/worktrees/presto-rc3
branch: worktree-presto-rc3
base: main @ 14c4085
budget: recon 1 agent; code-review off; codex gpt-6.1-sol at high (director's brief)
---

## Summary

Move Presto from Aztec `6.0.0-rc.1` to `6.0.0-rc.3`. In rc.3 the release numbers split.
`@aztec-labs/*` are `6.0.0-rc.3`, but every `@aztec-foundation/*` package they depend on (bb.js,
Noir, l1-artifacts) is `6.0.0-rc.6`. Barretenberg publishes `bb` only as `v6.0.0-rc.6`; there is no
`v6.0.0-rc.3` tag.

Presto downloads and caches `bb` by the string the client sends in `x-aztec-version`, which it uses
as the barretenberg tag. The SDK sends its `stdlib` pin. After a plain bump it asks for
`v6.0.0-rc.3`. That download fails with a 404, and every proof falls back to WASM with no visible
error. presto-noir already sends its bb.js version.

The fix is on the SDK side: the SDK sends the version of the bb.js it pins. Every released Presto
from 1.1.3 on (desktop and headless) then downloads `v6.0.0-rc.6` and proves rc.3, so no app
release is needed. This keeps the repo's version model (`packages/presto/README.md:114`).

One PR, five phases:
1. The SDK sends its bb.js version.
2. The tooling learns split release numbers.
3. The bump, through `aztec:update`, with the Noir fixtures.
4. Gates on a local rc.3 network, against the branch server and two released servers.
5. Keyless testnet reads.

Afterwards the owner publishes `@alejoamiras/presto` 6.0.0-rc.3 and `presto-noir` 2.0.0-rc.2 on
`testnet`.

Size: about 620 lines against the 350 target. The audit trail of three reviews and the text the protocol requires
inline (the codex rules, the open-work table, the seeds) account for about 150 of them.

## Outcome & Quality Bar

**For whom.**
- **inference-money**, the owner's USDC bridge. It proves through `@alejoamiras/presto` in the
  browser and through the released headless `presto-server` 1.1.3 in its e2e. Its build guard
  compares the SDK's `stdlib` pin with its toolchain (`6.0.0-rc.3`).
- **A dApp developer on rc.3**, who wants native proving from one install line.
- **The maintainer of the next bump**, because Aztec's numbers will keep diverging.

**Excellent looks like:**
1. **Released servers prove rc.3 natively.** `presto-server` 1.1.3 (sha256 `90b76733…7c41`) and
   1.2.0-rc.1 each start from a cold cache.
   - Each downloads barretenberg `v6.0.0-rc.6`, digest-first.
   - Each proves a transaction that a local rc.3 node checks with its real verifier and mines.
   - The SDK's phase trail shows `transmit` and no `fallback`.
   - The PR body quotes the asset, the tag, the verifier evidence and the tx hash.
2. **The version the SDK sends cannot drift.** It comes from the SDK's own package metadata, never
   a hand-written string. A unit test fails when it differs from the bb.js that
   `@aztec-labs/bb-prover` pins.
3. **The next rc is one command.** `bun run aztec:update <labs-version>` moves `@aztec-labs/*` to
   that version. It moves each managed foundation package to the single version the labs packages
   pin, and fails closed if they disagree. The installer graph check accepts that split and
   nothing else.
4. **The packed contracts are exact.** The packed `presto` pins `stdlib` 6.0.0-rc.3 and bb.js
   6.0.0-rc.6. The packed `presto-noir` (2.0.0-rc.2) peers exactly bb.js 6.0.0-rc.6. `latest` does
   not move.

**Good enough:**
- No wire change. The header keeps the name `x-aztec-version`, and `/health` and core's types keep
  their field names. The docs say the value is the barretenberg release.
- No new SDK error surface for a failed download. That is an issue (condition 3).
- No presto-core release.
- No testnet transactions.

## Scope

**In:**
- **SDK.** An exact `@aztec-foundation/bb.js` dependency, and `x-aztec-version` read from it.
- **Tooling.** `update-aztec-version.ts`, `check-aztec-update.ts`, `aztec-installer-graph.ts` and
  `setup-aztec` learn the split numbers.
- **The bump** of the SDK, presto-noir (2.0.0-rc.2), the playground and the tarball consumers. It
  covers the exemption lists, the allow-scripts pins, the Windows `bb.exe` pin for 6.0.0-rc.6, the
  Noir fixtures, the packaged-e2e version check, the tray label, comments and docs.
- **Gates** on a local rc.3 network.

**Out (the owner's):**
- publishing, releases, tags, deploys, keyed runs and testnet transactions;
- the `published-sdk.json` pin, which the release bot raises;
- the legacy-fixture re-point, which is possible only after publication;
- any server or core release;
- renaming the header or any field.

## Architecture & Implementation

### Proposed architecture

No new component. There are three changes.

- **The SDK's version source.** `packages/sdk/package.json` gains `"@aztec-foundation/bb.js":
  "6.0.0-rc.6"` in `dependencies`, the exact version that `@aztec-labs/bb-prover@6.0.0-rc.3`
  pins. This adds a direct edge to a package already in the graph.
  - `sdkAztecVersion()` becomes `sdkBbVersion()`. It reads that pin from the manifest the module
    already imports. It is module-internal; `index.ts` does not export it.
  - `PrestoClient` receives the value as `aztecVersion`, and core keeps reporting it as
    `status.sdkAztecVersion`. MIGRATION.md calls both historical names.
- **Split release numbers in the tooling.**
  - `update-aztec-version.ts` gains `resolveTargets(labs)`, which returns `{ labs, foundation }`.
    - It runs `npm view <name>@<labs> dependencies` for every labs package the SDK manifest names
      (names from `listAztecDependencies`, never hard-coded).
    - It aggregates every direct `@aztec-foundation/*` pin across those packages, not only the
      three managed names. A package that pins none is fine (`accounts`, `wallets`,
      `noir-contracts.js` today; `aztec.js` pins only `l1-artifacts`).
    - The aggregate must hold exactly one exact version. An empty aggregate, two versions, or a
      range fails closed, naming each source. Only the managed names are rewritten.
  - `bumpPins` gives foundation names the foundation version and every other managed name the labs
    version. `findMissingPackages` checks each name at its own target. `CRS_CACHE_VERSION` takes
    the foundation version, because the CRS belongs to bb.
  - `check-aztec-update.ts` gets an `import.meta.main` guard and uses the same targets.
  - `aztec-installer-graph.ts` `compareGraph` reviews each name at one version:
    `@aztec/viem` at `VIEM_VERSION`, `@aztec-foundation/*` at the foundation version, the rest at
    labs. The CLI gains a fourth argument. `setup-aztec` reads it with
    `bun scripts/aztec-manifest.ts packages/sdk/package.json bb.js`.
- **The bump** through the adapted `aztec:update 6.0.0-rc.3`. A human then does what the tool
  deliberately leaves:
  - the exemption lists and the allow-scripts pins;
  - `TESTED_BB_VERSIONS` and the presto-noir version;
  - the Windows pin;
  - the fixtures and the docs.

Nothing in `app.yml`'s `published` filter changes: `aztec-manifest.ts`, `npm-packages.ts`,
`get-sdk-publish-version.ts`, `published-playground.ts`, `app.yml` and `published-sdk.json`.

### Key interfaces

```ts
// packages/sdk/src/lib/presto-prover.ts (module-internal)
/** The bb release this SDK proves with: its exact `@aztec-foundation/bb.js` pin. Presto downloads and
 *  caches `bb` by this barretenberg tag, so it is what `x-aztec-version` carries; since Aztec
 *  6.0.0-rc.3 it differs from the `stdlib` version. */
export function sdkBbVersion(): string | undefined;

// scripts/update-aztec-version.ts
export type AztecTargets = { labs: string; foundation: string };
export function targetFor(name: string, targets: AztecTargets): string;
export function foundationVersionOf(pins: Map<string, Map<string, string>>): string; // pure; throws on 0 or >1
export async function resolveTargets(labs: string, sdk: PackageManifest): Promise<AztecTargets>;
export function updatePackageJson(content: string, targets: AztecTargets, skip?: Set<string>): string;

// scripts/aztec-installer-graph.ts
export function compareGraph(graph: AztecGraph, listed: string[], targets: AztecTargets);
// CLI: bun scripts/aztec-installer-graph.ts <prefix> <list-file> <labs-version> <foundation-version>
```

### File-level change map

- **Phase 1:**
  - `packages/sdk/package.json`, `bun.lock`;
  - `packages/sdk/src/lib/presto-prover.ts` and `presto-prover.test.ts` (version source, and the
    header assertions at `:14,113,235-243`);
  - `packages/sdk/{README.md,MIGRATION.md,AGENTS.md}` and `.claude/skills/presto/SKILL.md`.
- **Phase 2:**
  - `scripts/{update-aztec-version,check-aztec-update,aztec-installer-graph}.ts` and their tests
    (`check-aztec-update.test.ts` is new);
  - `.github/actions/setup-aztec/action.yml`.
- **Phase 3:**
  - What `aztec:update` writes: three manifests, `host-dependencies.json` and `CRS_CACHE_VERSION`.
    Also `bun.lock`.
  - `bunfig.toml` and `installer-aztec-packages.txt`, only if the graph changed.
  - `setup-aztec/action.yml`: allow-scripts `lmdb@3.5.7`, the rc.1 comment and the cache salt.
  - presto-noir: `packages/sdk-noir/package.json` (2.0.0-rc.2), `src/lib/tested-versions.ts` and
    test literals; `scripts/tarball-consumer/presto-noir/runtime-check.mjs:15`.
  - `packages/presto/scripts/copy-bb.ts`: the reviewed rc.6 Windows pin.
  - `packages/playground/e2e/presto.packaged-e2e.spec.ts:37-39`: `/health.aztec_version` compared
    with the SDK's bb.js pin.
  - The tray label (`src-tauri/src/tray.rs:117`, `· bb <version>`), with
    `scripts/tray-menu.test.ts` and `packages/presto/README.md:250,262`.
  - Comments: `core/src/server.rs:474-476`, `core/src/versions/version_policy.rs:240,280`, and
    `bb.rs:352` if version-specific.
  - `fixtures/noir/*`.
  - Docs: `README.md`, `CLAUDE.md`, `packages/presto/README.md:99,114,340`,
    `packages/sdk-noir/README.md` (with the two integrator pointers that follow-ups.md defers to its
    next release), `packages/landing/public/llms.txt:7`,
    `docs/{SECURITY_MODEL,RELEASE_RUNBOOK,PLATFORM_SUPPORT}.md`.
  - TS fixes the rc.3 typecheck forces, the dependency-audit allowlist, and the repo-reading tests
    that pin rc.1.
- **Phases 4–5:** no code; the evidence goes in `lessons/`.

### Non-obvious mechanics

- **Why the SDK's own pin.** A browser bundle cannot read a transitive package's `package.json`
  without an `exports` entry, and the SDK already imports its own manifest. Exact pins on both
  edges resolve one bb.js, so the string the SDK sends names the bb.js its prover loads.
- **Request path.** The SDK sends `6.0.0-rc.6`.
  - A new desktop build bundles rc.6 and answers it from the sidecar.
  - A released or headless server misses its cache. `DownloadBudget` applies, then the digest GET
    to `api.github.com/…/barretenberg/releases/tags/v6.0.0-rc.6`, then the tarball GET.
  - `prove.rs:55-113` and `release_metadata.rs:87-102` are unchanged.
- **CI as the regression detector.** In `_e2e.yml:55`, `BB_BINARY_PATH` and `AZTEC_BB_VERSION`
  (from `copy-bb.ts`, now rc.6) make an rc.6 request resolve to the bundled binary. An rc.3 request
  would still download first, get a 404 and fall back, so the e2e's `transmit`/no-`fallback`
  assertion fails.
- **Real verification on a local network.** The local network defaults to `realProofs=false`, and
  its verifier then accepts anything (`aztec/dest/local-network/local-network.js:107`). The SDK
  e2e proves for real (`proverEnabled: true`). Two upstream facts constrain the switch:
  - `BBCircuitVerifier.new` throws without `BB_WORKING_DIRECTORY` (`bb_verifier.js:105`).
  - The bootstrap wallet that funds the test accounts proves only when `realProofs` is true
    (`local-network.js:166-178`). Under `DEBUG_FORCE_TX_PROOF_VERIFICATION` alone, its random
    proofs are rejected and startup fails.

  So phase 4 tries these in order and records which one ran. Each runs inside the container, with
  `BB_WORKING_DIRECTORY` and `BB_BINARY_PATH` on real disk.
  1. `realProofs` on through the node's own config. `node_getNodeInfo` must then report
     `realProofs: true`, and the bootstrap wallet proves for real.
  2. `DEBUG_FORCE_TX_PROOF_VERIFICATION=true` (`aztec-node/dest/factory.js:163-170`), plus a
     scratch-only one-line patch that enables the bootstrap wallet's prover. The exact patch is
     recorded. It never enters the repo.
  3. The fallback: a non-verifying network. This alternate gate carries no real-verification
     evidence. The PR says so, and real-proof validity becomes a closed `known-limit`, settled by
     the owner's `smoke-playground.yml` (release step 5).
- **The legacy gate** goes dormant: its fixture (presto 6.0.0-rc.1) targets another Aztec version.
  Once presto 6.0.0-rc.3 is on npm, it throws "stale" on every SDK PR until the fixture moves to
  it. That move is a post-release step.
- **Fixtures.** Noir stays `1.0.0-rc.3`. So ACIR, `vk`, witness and public inputs should stay
  byte-identical; only the proofs may change.

### Trade-offs & alternatives not taken

- **Read the version from `noir-noirc_abi`'s pin.** Rejected: it couples the version to an
  unrelated package that merely shares the number today.
- **A generated TS constant.** Rejected: more machinery, from the same source.
- **A distinct `download-failed` fallback reason.** Deferred to an issue: it is a new public union
  member in presto-core, so a core release (condition 3).
- **Hand-bumping without fixing the updater.** Rejected: the next rc would skip the foundation
  names again.

## Competing outline B: server-side mapping

The SDK keeps sending `stdlib`'s version. The server learns `aztec → bb`, from a compiled-in table
or from a new `x-bb-version` header.

**For B:** the header keeps its literal meaning, and `/health.versions` becomes truthful.

**Against B:**
- Every installed app stays broken for rc.3 until it updates, inference-money's 1.1.3 included.
- A table needs a server release for every misaligned rc; a header doubles the wire contract.
- It contradicts the documented version model.

**Verdict:** A. The director chose (a) and rejected B as (c). Both auditors concur (D1).

## Security & Adversarial Considerations

- **Threat model.**
  - A compromised upstream: barretenberg releases, the npm scopes, Aztec's installer and the
    installers it pipes.
  - A header value that reaches a path or URL sink.
  - A release-channel mistake.
- **The header stays attacker-controlled at ingress.** The SDK's manifest is its only honest
  source. The server validates every value regardless: charset and traversal guard, canonical
  semver, the revocation list (`prove.rs:97-111`, `version_policy.rs`). No new sink.
- **bb supply chain.** The mechanics do not change: digest-first, a redirect-refusing metadata
  client, caps, `DownloadBudget`. The digest comes from the same control plane as the binary, so
  it is a consistency check, not publisher authentication.
  - The Windows rc.6 pin records the F-008 review: the release page and publisher, the downloaded
    sha256 equal to the API digest `d79cb3ee…d1ac`, a single PE `bb.exe` with no DLLs, the
    embedded sentinel `6.0.0-rc.6`, and the same imported-DLL set as rc.1.
  - Its tag commit is not evidence: rc.1 and rc.6 tag the same commit `654cc60`.
  - Cross-channel evidence for linux: phase 4 compares the downloaded `bb` with the provenance-signed
    `@aztec-foundation/bb.js@6.0.0-rc.6` `build/amd64-linux/bb`.
- **npm supply chain.**
  - Exact pins everywhere, and exact-name exemptions.
  - The graph check still requires the exact name set and every observed version. viem keeps its own
    pin, and the check also runs on a cache hit. The foundation version it accepts is a committed,
    reviewed pin, not a registry read.
  - `@aztec-labs/*` carry registry signatures only. This residual is already in
    `docs/SECURITY_MODEL.md`.
- **Local execution of third-party code.**
  - **In the container:** the Aztec installer, the local network, and both released servers, with
    the `bb` they download. The image is `ubuntu:24.04` plus `ca-certificates`, `curl`, `git`,
    `python3` and `build-essential` (bcrypto's allowed install script runs `node-gyp rebuild`);
    its digest is recorded.
    - It runs as `--user $(id -u):$(id -g)`, with `--cap-drop ALL` and
      `--security-opt no-new-privileges`.
    - It gets no `--privileged`, no host PID namespace and no Docker socket.
    - Mounts: node 24 and npm 12 read-only, and `~/.cache/presto-rc3/{aztec,home,run}` read-write.
      Nothing else from the host home is mounted.
    - It starts with a clean environment.
    - **Retained access:** `--network host`, so its processes can reach this machine's loopback
      services. This is disclosed, not mitigated.
  - **On the host, under `env -i` with a minimal `PATH`:** workspace code, already run there by
    every `bun run test`. That is the branch `presto-server` with its bb.js sidecar, the bun suites,
    and nargo for the fixtures. nargo is the rc.1 install's binary, already on this host and the
    same `1.0.0-rc.3+5a7ee9bf` build. No token or `SSH_AUTH_SOCK` reaches these processes.
  - On a GitHub API 403, the run waits for the quota reset; it never adds a token.
  - **Disclosure:** before the audits, one scratch-`HOME` host install ran the reviewed rc.3
    installer copy (it differs from rc.1's only in `VERSION`). It ran with `noirup` and `foundryup`
    skipped (nargo and foundry were copied from the rc.1 install) and with pinned allow-scripts, and
    executed `aztec --version` once. Phase 3 deletes that tree and redoes the install in the
    container.
- **Least privilege.** No new workflow permission, secret or token.
- **Silent fallback (condition 3).** A deterministic `download_failed` is classified as `transient`
  and shows only through LogTape. The issue records it. The phase 1 unit test and the e2e assertion
  stop a recurrence.

## Assumptions

### Facts (verified 2026-10-13)

1. Labs rc.3 packages pin foundation rc.6. Foundation has no rc.3, and barretenberg has no
   `v6.0.0-rc.3` (recon.md, External facts; both auditors re-checked).
2. The server downloads tag `v<x-aztec-version>` and caches by it (`release_metadata.rs:96-102`,
   `prove.rs:55-113`).
3. The SDK sends `stdlib`'s pin (`presto-prover.ts:79-84,124`). presto-noir sends its hand-written
   `TESTED_BB_VERSION` (`presto-ultra-honk-backend.ts:114`).
4. `aztec:update 6.0.0-rc.3` prints "Skipping unpublished packages" for the three foundation names
   and leaves them at rc.1 (`update-aztec-version.ts:124-129`).
5. `compareGraph` reviews every non-viem name at one release (`aztec-installer-graph.ts:103-106`).
   On the scratch rc.3 tree, its only failures were `@aztec-foundation/*` at rc.6: no addition and
   no removal.
6. In the rc.3 installer tree the script-bearing set is rc.1's seven, with `lmdb` 3.5.6 → 3.5.7
   (published 2026-10-02, same `install` script).
7. Adding bb.js to the SDK breaks no dependency-set check (`published-playground.ts:33-41` is a
   subset check; `exact-pin.ts` reads `stdlib` only). Both auditors confirmed.
8. inference-money runs presto-server 1.1.3 with no `BB_BINARY_PATH` and compares the SDK's
   `stdlib` pin, not `status.sdkAztecVersion`. Sources outside this repo: its
   `apps/showcase/e2e/presto.sh` and `docs/ci-pipeline.md`.
9. The testnet behind the forwarder runs rc.3 (a keyless `node_getNodeInfo`).
10. The SDK e2e's prover port is `PRESTO_PORT` (`sdk-core/src/lib/config.ts:61`).

### Inferences (attack these)

- **I1.** bb rc.6 accepts the flags that 1.1.3 and 1.2.0-rc.1 pass. Detector: phase 4.
- **I2.** rc.3's TS API changes reach this repo only as typecheck-visible breaks. Detectors: the
  three-graph typecheck and phase 4.
- **I3.** Native bb rc.6 reproduces bb.js rc.6 WASM byte for byte for `*-no-zk`. Detectors: phase
  3's live Noir e2e and CI's WebDriver Noir test on all three OSes.
- **I4.** The rc.3 local network starts with rc.1's flags under one of the two real-verification
  options. Detector: phase 4, with option 3 as the recorded fallback.
- **I5.** Outside consumers do not read `status.sdkAztecVersion` as an Aztec version. This is
  unknown beyond inference-money, so MIGRATION.md states the change.

### Asks (answered by the director, 2026-10-13)

- **A1. A server release.** Not needed (a). The gate evidence is the deliverable. An owner release
  of presto 1.2.0-rc.2 (the desktop then bundles rc.6) is optional. B is rejected.
- **A2. Versions.** presto 6.0.0-rc.3, noir 2.0.0-rc.2, core unchanged. The owner publishes.
- **A3. Fallback detection.** An issue, because the change is not small.
- **A4. Containment of local third-party code (new, from the audits).** The installer, the local
  network and the released servers run in a container; workspace code runs on the host under
  `env -i`. The director may instead accept host execution under `env -i`.

## Phases

Unless a gate says otherwise, every gate includes `bun run test` (lint, the three-graph typecheck,
unit) and `bun run lint`. Commits are signed: `env -u SSH_AUTH_SOCK git commit`, then check that
`%G?` is not `N`. PRs open only in Delivery.

### Phase 1: the SDK sends its bb.js version (rc.1 values, so behaviour is unchanged)

**Validation gate:**
- A new test in `presto-prover.test.ts` asserts that `sdkBbVersion()` equals the
  `@aztec-foundation/bb.js` dependency in `@aztec-labs/bb-prover`'s installed manifest. The
  existing header assertions read the bb.js pin.
- Edit the SDK's bb.js pin by hand: the new test must fail. Restore it. Record both runs.
- Run `bun scripts/pack-candidate.ts --package presto --version 0.0.1-local --out <dir>`. Then run
  `bash scripts/sdk-tarball-consumer.sh <tarball> presto --with <each pair>` (the same commands as
  `_ts-package-ci.yml:148-159`). Both pass, and the packed manifest pins bb.js.

### Phase 2: tooling for split release numbers

**Validation gate:**
- `bun run lint:actions` exit 0.
- `update-aztec-version.test.ts` covers each of these:
  - a mixed bump (labs rc.3, foundation rc.6) across all three sections;
  - an unrelated `@aztec-foundation/x` that stays untouched;
  - per-target skips;
  - `foundationVersionOf` with packages that pin no foundation name, and a package whose only pin
    is outside the managed three (both pass);
  - `foundationVersionOf` throwing on an empty aggregate, on two versions (including a
    disagreement outside the managed three), and on a ranged pin, naming the sources.
- `check-aztec-update.test.ts` checks that a foundation name is not "missing" at the labs version.
- `aztec-installer-graph.test.ts` covers each of these:
  - a mixed tree that passes;
  - a foundation name at the labs version that fails by name;
  - a labs name at the foundation version that fails;
  - the existing addition, removal and viem cases.
- `bun run aztec:check prerelease` prints `needsUpdate: true` with no `missing`.

### Phase 3: the rc.3 bump and the Noir fixtures

1. Run `bun run aztec:update 6.0.0-rc.3`, then `bun install`.
2. Do the manual items in the change map.
3. Run the containerized scratch install.
4. Regenerate the fixtures with the rc.1 install's nargo, the same `1.0.0-rc.3` build:
   `AZTEC_NARGO=~/.aztec/versions/6.0.0-rc.1/internal-bin/nargo bun scripts/noir-fixture.ts --regenerate`.

**Validation gate:**
- `bun install --frozen-lockfile` exit 0 with no min-age skips; `bun run lint:actions` exit 0.
- `rg -n '6\.0\.0-rc\.1' packages scripts .github fixtures docs README.md CLAUDE.md -g '!node_modules'`
  lists only the following, each recorded in lessons with its reason:
  - historical rows;
  - the legacy fixture;
  - `license-fallbacks.ts`'s tag (texts pinned to their source);
  - script-test sample data.
- The four builds (`sdk-core`, `sdk`, `sdk-noir`, `playground`) exit 0. The playground's licence
  step fails on any unmapped package.
- `pack-candidate.ts` and `sdk-tarball-consumer.sh` pass for `presto`, `presto-core` and
  `presto-noir`. The packed manifests carry Outcome 4's exact pins.
- `bun run --cwd packages/presto prebuild` writes `AZTEC_VERSION` = `6.0.0-rc.6`.
- The container install, with the step's npmrc and the new allow-scripts list:
  - `npm config get min-release-age-exclude` equals the list;
  - there is no ETARGET and no blocked-scripts warning;
  - `aztec --version` prints `6.0.0-rc.3`;
  - `bun scripts/aztec-installer-graph.ts <prefix> <list> 6.0.0-rc.3 6.0.0-rc.6` matches.
  - The installer's sha256 is recorded.
- `noir-fixture.ts --verify` exits 0, and each manifest records `bbJs: 6.0.0-rc.6`. Lessons list the
  files that changed against `main`.
- `bun run --cwd packages/sdk-noir test:identity` passes.
- A branch `presto-server` runs under `env -i`, with a private `PRESTO_HOME` and a claimed port.
  Then `PRESTO_URL=… bun run --cwd packages/sdk-noir test:e2e` passes with `fallback: "none"`.
- `cargo test --locked --manifest-path packages/presto/core/Cargo.toml` and `bun run lint:clippy`
  exit 0. Also run `cargo check --target x86_64-pc-windows-gnu --lib` in `src-tauri`, because
  `copy-bb.ts` feeds the Windows build.
- `bun run audit:dependencies` exit 0.
- The Windows pin's review is recorded.
- `git diff --name-only origin/main...` intersected with `app.yml`'s `published` list is empty.

### Phase 4: local rc.3 network, branch and released servers (director's condition 1)

Run `aztec start --local-network --port <p> --admin-port <p2>` in the container, with
`ANVIL_PORT=<p3>`, on host networking. Real verification follows the order in Non-obvious
mechanics. The ports come from `~/.agents/ports.md`. Data lives on real disk under
`~/.cache/presto-rc3/`. Teardown is by container name, plus process group on the host.

**Validation gate:**
- `node_getNodeInfo` reports `nodeVersion` 6.0.0-rc.3.
- Record which verification option ran, the value of `realProofs`, and the node log line showing a
  real tx verifier (none under option 3).
- **Branch server, as CI runs it** (`BB_BINARY_PATH` = the sidecar, `AZTEC_BB_VERSION` = rc.6):
  `PRESTO_PORT=<port> PRESTO_URL=… AZTEC_NODE_URL=… bun run --cwd packages/sdk test:e2e` passes. The
  legacy step logs its dormant notice. The native deploy shows `transmit` and no `fallback`.
- **Released servers, from a cold cache.** For 1.1.3 and then 1.2.0-rc.1:
  1. Download the linux x86_64 asset and match it against the release's `.sha256`. For 1.1.3 it
     must also equal `90b76733…7c41`.
  2. Start it in the container, with a clean environment and an empty real-disk `PRESTO_HOME`.
     `BB_BINARY_PATH` and `AZTEC_BB_VERSION` stay unset, `HOME` has no `.bb`, `PATH` has no `bb`,
     and the port is claimed.
  3. Check `/health.version` against the release.
  4. Run the SDK e2e above against it, bound with `PRESTO_PORT`. It must show `transmit`, no
     `fallback`, and a tx mined by the node. Record the tx hash from the node.
  5. Run `sdk-noir test:e2e` against it.
  6. `versions/6.0.0-rc.6/bb.sha256.json` exists. Its archive digest equals barretenberg's
     `950d5d07…0628`, and the binary hashes to its recorded value. No `versions/6.0.0-rc.3` exists.
     The `bb` equals bb.js rc.6's `build/amd64-linux/bb`.
- **Playground** (not native evidence; 5173 claimed): `bun run --cwd packages/playground test:e2e`
  (mocked) passes. Its local-network suite is not run here. On chain 31337 it sends dummy proofs,
  which a verifying node rejects (`src/aztec.ts:217,265`), and it proves only against the default
  ports 59833/59834 (`src/aztec.ts:110`). CI's `app.yml` `local-network-e2e` runs it on the PR
  against a non-verifying network, and the PR must show that job green.
- Every container and process this phase started is gone, and its ports are released.

### Phase 5: keyless testnet reads

**Validation gate:**
- Through the forwarder, `node_getNodeInfo` reports `nodeVersion` 6.0.0-rc.3.
- `AZTEC_NODE_URL=<forwarder> bun packages/playground/scripts/fpc-state.ts --salt 0x0` records
  three things: the rc.3 SponsoredFPC address, its publication status (a private-only FPC works
  unpublished, so deployment stays unknown), and its FeeJuice balance.
- A zero balance becomes an owner issue. No transaction is sent.

## Delivery

Single arc, one branch (`worktree-presto-rc3`), one PR, `gh pr create`. The close-out lands as its
final commits. `code_review: off`. The phases are sequential, because each needs the previous pins,
so there are no lanes. The PR body states:
- the released-asset evidence (asset, sha256, `v6.0.0-rc.6`, the verifier evidence, the tx hash);
- every behavioural change with its file;
- the owner's release order;
- the window in which `main`'s production playground build fails closed, until the pin PR merges;
- the lanes the PR does not exercise (the packaged e2e runs only in a release).

## Post-implementation

1. **No `/code-review`** (`code_review: off`).
2. **Codex audit.** Run `/codex high` on `gpt-6.1-sol` (`run-codex.sh`'s fifth argument). Send:
   - the net diff from `14c4085`, plan.md and the decision ledger;
   - an adversarial ask: version-source drift, header validation, graph-check acceptance and supply
     chain;
   - these two rules, verbatim:
     - *"Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone."*
     - *"Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact."*
3. **Fix loop.**
   1. Verify every finding.
   2. Fix and commit.
   3. Log the round in `lessons/codex-loop.md`.
   4. Resume the same session with the fix diff.
   - Stop when a round has no new material finding.
   - A fix that adds state, a lifecycle, a protocol, a recovery policy or a public contract is a
     plan change. Stop and send `QUESTION`.
   - Still material after 3 rounds: `BLOCKED`.
4. **Delivery.** Push the branch, then `gh pr create`. Run `gh pr checks --watch` until it is
   green, then send `DONE presto-rc3: <url>; CI <state>; versions: …`.
5. **Close-out** (the PR's final commits, after `gh pr create`):
   - Write `## Outcome` after the front matter, with `Known limits:` and `Open items:` lines and a
     line retiring the seeds.
   - Promote lessons into `lessons.md` (≈ 8 KiB budget: dedupe, retire, date-stamp). Candidates:
     - Aztec numbers split by scope, so `x-aztec-version` is the bb release;
     - a local network accepts fake proofs unless `DEBUG_FORCE_TX_PROOF_VERIFICATION` is set;
     - run the Aztec installer in a container.
   - File these issues, deduping first with `gh issue list --state all --search "<words>"`:
     1. `download_failed` is reported as `transient` and is silent (condition 3).
     2. Re-point `audit/fixtures/interop-sdk.json` at presto 6.0.0-rc.3 once it is published.
     3. The rc.3 testnet SponsoredFPC, if phase 5 finds no balance.
     4. Optional: presto 1.2.0-rc.2, so the desktop app bundles rc.6.
     5. Real-proof validity, as a closed `known-limit`, only if phase 4 could not verify for real.
   - Add a one-line `follow-ups.md` entry per issue, and drop the presto-noir part of the
     bundle-v6 README entry.
   - Run `git mv implementations-plan/presto-rc3 implementations-plan/archive/presto-rc3` in its own
     commit, then repair links (`git grep -n presto-rc3`). Move the `index.md` line to
     `archive/index.md`.

   | Situation | Home |
   |---|---|
   | Work inside this implementation | plan.md and the PR |
   | Actionable work that outlives the plan | an issue (domain label, `Record` link) |
   | A product call, or waiting outside the repo | an `owner-decision` / `blocked:external` issue |
   | A suspected exploitable weakness | a private draft advisory only |
   | Rejected, superseded or done | a disposition line in the Outcome |
   | Unsupported conditions or no consequence | a closed `known-limit` issue |
   | Knowledge that prevents a repeat | `lessons.md` |
6. **Teardown after the owner merges.** The trigger is `git fetch -q origin main && git cat-file
   -e FETCH_HEAD:implementations-plan/archive/presto-rc3/plan.md`. Then:
   1. `ExitWorktree` (`keep`).
   2. `agent-worktree done presto-rc3 --merged`, and report its output. Never force past a refusal.
   - After `DONE`, this session arms one background wait for the trigger.
7. **Owner release order (not this session's):**
   0. Merge the audit fix first (#101). Every `release-sdk.yml` publish job requires
      `dependency-audit` to succeed, and a dry run skips that job, so step 1 passes either way.
   1. `release-sdk.yml packages=all dry_run=true`. Expect core 1.2.1 reused, noir 2.0.0-rc.2,
      presto 6.0.0-rc.3 and banners reused, on `testnet`.
   2. The real dispatch. The pin PR auto-merges, and Workers Builds deploys the playground.
   3. Issue 2 (the legacy fixture).
   4. Optional: issue 4.
   5. Issue 3 if needed, then `smoke-playground.yml`.

**Post-implementation hardening:** no `/harden`; there is no new trust boundary.

## Decision ledger

| # | Decision | Source | Status |
|---|---|---|---|
| D1 | Outline A (the SDK sends its bb.js version) over B (server mapping) | draft; director (a); Codex, Opus | adopted |
| D2 | Version source = the SDK's own exact bb.js dependency, tested equal to bb-prover's pin | draft; director condition 2 | adopted |
| D3 | Foundation target = the single version across every direct `@aztec-foundation/*` pin of the managed labs packages (a package may pin none); an empty aggregate or >1 version fails closed; only managed names are rewritten | draft; Opus F6; final Codex 3 | adopted (supersedes "stdlib only") |
| D4 | The graph check reviews foundation names at the SDK's bb.js pin; exact names and versions are still required | draft; both audits | adopted |
| D5 | `CRS_CACHE_VERSION` follows bb.js | recon | adopted |
| D6 | No core change; `download_failed` visibility becomes an issue | director condition 3 | adopted |
| D7 | No server release; released 1.1.3 and 1.2.0-rc.1 are gated instead | director (a), condition 1 | adopted |
| D8 | Keep the header and field names; fix comments and docs, including AGENTS.md, llms.txt and version_policy.rs | draft; Codex 5, Opus F10 | adopted |
| D9 | One PR, close-out in it | draft | adopted |
| D10 | Pack through `pack-candidate.ts` plus `--with`, not `npm pack` | Codex 1, Opus F3 | adopted |
| D11 | `aztec:check prerelease`, plus an `import.meta.main` guard and a test | Codex 2, Opus F7 | adopted |
| D12 | Installer and local network in a disposable container; host runs under `env -i` | Codex 3, Opus F5/F9 | adopted (A4) |
| D13 | Phase 4 harness: clear `AZTEC_BB_VERSION`, `PRESTO_PORT` per server, `/health.version`, the marker's archive digest and binary hash, the tx hash read from the node | Codex 4 | adopted |
| D14 | Real verification on the local network, tried in order: `realProofs` on; the debug flag plus a scratch-only bootstrap patch; else a non-verifying fallback with a closed known limit. `BB_WORKING_DIRECTORY` always set | Opus F1; final Codex 1 | adopted (final Codex showed the debug flag alone cannot start: the bootstrap wallet's proofs are random) |
| D15 | Fixtures move into phase 3, because `noir-fixture.test.ts` fails until they are regenerated | Opus F2 | adopted |
| D16 | The packaged e2e compares `/health.aztec_version` with the bb.js pin | Opus F4 | adopted |
| D17 | The tray label says `bb <version>` | Opus F10 (proposed a known limit) | adopted as a one-line copy fix; the release notes stay, because they correctly name the Aztec version |
| D18 | Tag-commit evidence dropped; the linux `bb` cross-checked against bb.js's provenance-signed build | Opus F8 | adopted |
| D19 | Phase 5 reports publication and balance, not "deployed" | Codex 6 | adopted |
| D20 | The playground gate does not count as native evidence | Opus F11 | adopted |
| D21 | Fact corrections: "silently", recon line refs, presto-noir's source, inference-money's sources | Opus F12 | adopted |
| D22 | ~180-line cut | Opus (f) | partly adopted: control flow, the contracts table and repeats were cut; the Situation/Home table and the verbatim rules stay, because the protocol requires them inline |

| D23 | Released servers and their downloaded `bb` run in the container too; the container spec (user, caps, `no-new-privileges`, mounts, no socket) is written out; `--network host` is disclosed as retained access | final Codex 2 | adopted |
| D24 | Fixtures use the rc.1 install's nargo (same build, already on the host), never a binary the container produced | final Codex 2 | adopted |
| D25 | No local playground local-network run: a verifying node rejects its dummy proofs and its prover is fixed to the default ports; CI's `local-network-e2e` covers it on the PR | final Codex 4 | adopted (smaller than new test wiring) |
| D26 | The container image carries `python3` and `build-essential` | final Codex round 2 | adopted |

**Still disputed:** none.

## Audit verdicts

- **Codex** (gpt-6.1-sol `high`, session `01a13786-8a66-7353-afd7-6c03188ae36a`): `conditional
  approve (with conditions: repair the packaging/check commands, isolate local installer execution,
  and make released-server evidence reproducible)`.
  - 6 findings: 2 HIGH, 3 MEDIUM, 1 LOW. Each was verified against the tree (`pack-candidate.ts`,
    `check-aztec-update.ts:21-28`, `config.ts:61`, `fpc-state.ts:2,29,38`, `version_policy.rs:240,280`)
    and adopted (D10–D13, D19, D8).
  - Its "looks fine": A over B; stdlib's bb.js as the source; no broken dependency-set check;
    per-scope comparison keeps the guard; header validation; no change needed to `_e2e.yml` or
    `_ts-package-ci.yml`.
- **Opus (Plan agent):** `conditional approve` with five conditions: realProofs, runnable gates,
  the packaged e2e and docs, `env -i`, and the cross-checked foundation pins.
  - 12 findings: 1 HIGH, 4 MEDIUM, 7 LOW. All were verified (`local-network.js:107`,
    `factory.js:163-170`, `noir-fixture.test.ts:85-96`, `presto.packaged-e2e.spec.ts:37-39,113`,
    `tray.rs:117`, the tag API).
  - 11 adopted. F10's "known limit" for the tray became a fix (D17). F1's known limit became a real
    verifier flag, with the known limit as its fallback (D14).
- **Final fresh Codex pass** (gpt-6.1-sol `high`, new session `01a13797-6173-74f1-b712-559f4a6b509c`):
  `conditional approve (with conditions: repair the real-verifier and playground gates, specify
  D12's containment boundary, and clarify D3's aggregation contract)`.
  - 4 findings: 2 HIGH, 2 MEDIUM. All were verified (`bb_verifier.js:105`, `local-network.js:166-178`,
    `src/aztec.ts:110,217,265`, the rc.3 manifests) and adopted as D14 (revised), D23, D24, D3
    (revised) and D25.
  - Its "looks fine": D1/D2, D17, the graph's exact membership, the cold-cache evidence, digests as
    consistency checks, the versions, the unchanged core and owner-controlled publishing.
  - **Round 2** (resumed): `conditional approve (with conditions: add native-build prerequisites to
    the container image)`. It confirmed that its four findings are closed. The condition was
    verified (`bcrypto@5.5.2`'s `node-gyp rebuild`) and adopted (D26), so no finding remains open.

## Approval

**Conditional approve, 2026-10-13 (the owner's director).** Conditions:

1. **Container (A4).**
   - One container, named with the run id, on ports claimed from `~/.agents/ports.md`, with its data
     under `~/.cache/presto-rc3/`.
   - Teardown removes exactly that container and the process groups this run owns.
   - Never mount `HOME`, `~/.ssh`, `~/.claude*`, `~/.codex`, `~/.claude-accounts`, the Docker socket
     or any credential directory.
   - `--network host` is accepted. Host-side commands run under `env -i`.
2. **D14.**
   - Prefer option 1.
   - Option 2's patch stays in the container's scratch tree, recorded verbatim in
     `lessons/phase-4.md`.
   - Option 3 means a closed `known-limit` issue plus the owner's smoke.
   - The MILESTONE and the PR body name the option that ran.
3. **Phase 5.** The rc.3 testnet SponsoredFPC `0x2adfb70e…2130` is reported as published. Confirm it
   and read its balance, with no transaction. Name endpoints by role. Never print a URL the repo
   treats as private, in any lesson, PR body or issue.
4. **Consumer contract.**
   - The packed `@alejoamiras/presto` pins `@aztec-labs/stdlib` at exactly `6.0.0-rc.3`, and `latest`
     does not move.
   - No temporary or dated release-age exclude is added. The committed exact-name list (a standing
     owner decision) changes only if the lock's Aztec name set changes, and then it is flagged.
5. **Hard limits** as stated. The Codex loop stops at 3 rounds, then `BLOCKED`. Committed text names
   the change and the property, never a reviewer's narrative.
6. **Reporting.** The status file's `eta` is filled at every step. Each phase gets a MILESTONE with
   its `lessons/phase-N.md` path and gate evidence. `DONE` carries the PR URL, the CI state and the
   three versions.

## Seeds

Final (approved 2026-10-13). Run inside the worktree; one seed per session. `/goal` is recommended.

```
/goal Phases 1–5 marked ✓ in implementations-plan/presto-rc3/plan.md (the phase headers in the file, not the chat or task list), each backed by its validation gate as written there reported passing in the transcript — phase 4 including both released presto-server assets (1.1.3 sha256 90b76733…7c41 and 1.2.0-rc.1) proving natively from a cold cache against a containerized local rc.3 network with real tx verification (or its recorded fallback), the downloaded tag v6.0.0-rc.6, the verifier evidence and the tx hash recorded; `LESSONS_FILE=implementations-plan/presto-rc3/lessons/phase-N.md` printed per phase; `/code-review` NOT run (code_review: off); the codex fix loop on gpt-6.1-sol at high converged over the diff from 14c4085, evidenced by a resumed pass reporting no new material findings quoted in the transcript; exactly one PR, opened only after convergence, whose final commits include the archive move (`git show --stat`), with green `gh pr checks`; `bun run test`, `bun run lint` and `bun run lint:actions` exit 0. Never publish, release, tag, deploy, run keyed commands, send testnet transactions, merge, or push to main.
```

```
/loop 15m Drive implementations-plan/presto-rc3 forward. Each firing: read plan.md and lessons/ (authoritative), rebuild the task list if empty, `git status`, `git log --oneline -5`, PR checks if a PR exists. If plan.md is gone and `git fetch -q origin main && git cat-file -e FETCH_HEAD:implementations-plan/archive/presto-rc3/plan.md` succeeds: ExitWorktree (keep), `agent-worktree done presto-rc3 --merged`, report, stop. Otherwise take the next step in plan.md; after each edit run `bun run lint` and `bun run test` (or the specific test first); commit signed. A phase is green only when its gate as written passes: paste it, mark ✓, write lessons/phase-N.md, print `LESSONS_FILE=…`, `agent-worktree status presto-rc3 "phase N green: <next>"`. After phase 5: the codex loop per Post-implementation, then the PR, the close-out, `gh pr checks --watch`; report and stop. Decisions: `/codex high` on gpt-6.1-sol, logged in lessons. Same step failing 5 times: reassess with codex. Hard limits: no publish, release, tag, deploy, keyed run, testnet transaction, merge or push to main.
```

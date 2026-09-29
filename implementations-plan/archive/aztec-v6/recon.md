# Recon: Aztec v6 rc.1 migration

Snapshot: `main` at `4cdc2f2` (2026-09-28). Three read-only recon passes (bb source, package-scope
surface, release/CI tooling), then direct verification of every load-bearing claim below against the
tree, the npm registry and the GitHub API.

## Reuse map

| Capability needed | Existing code | Verdict |
|---|---|---|
| Fetch bb by version, digest-first, with caps | `packages/presto/core/src/versions/release_metadata.rs` (`download_url` :91-96, digest API :167), `downloader.rs` | **adapt**: change the repository only; keep digest-first, the redirect-refusing metadata client, and the 64 MiB / 512 MiB caps |
| Dev/CI bb download | `scripts/download-bb.ts` :82, :204, :294 | **adapt**: same repository change |
| Windows `bb.exe` supply chain | `packages/presto/scripts/copy-bb.ts` pins :60-99, fetch :156; `scripts/check-windows-bb-pin.ts` :43 | **adapt**: repository change, plus a hand-reviewed `6.0.0-rc.1` pin (F-008 forbids generated pins) |
| Resolve the live bb version | `copy-bb.ts:213-221` `resolveAztecBb()` resolves `@aztec/bb-prover`, then `@aztec/bb.js/package.json` | **adapt**: the new scope names. This one function feeds `AZTEC_VERSION`, the Windows tag and the npm build dir |
| Server version gate | `core/src/versions/version_policy.rs` (strict semver, prerelease accepted) | **reuse-as-is** |
| bb CLI invocation | `core/src/bb.rs:459-466` (`prove --scheme chonk --ivc_inputs_path -o`), `bb/ultra_honk.rs:270,524` (`--scheme ultra_honk --output_format json`) | **reuse-as-is**: v6 bb still takes every flag, now listed only under `--help-extended` (verified by running the v6 linux binary) |
| Chonk request body | Rust treats the msgpack as opaque bytes (`bb.rs:433`) | **reuse-as-is**: v6 adds a `kind` field to each step (`serializePrivateExecutionSteps`), and only bb reads it |
| SDK prover | `packages/sdk/src/lib/presto-prover.ts` extends `BBLazyPrivateKernelProver` | **adapt imports only**: `lazy.d.ts` and `chonk_proof.d.ts` are identical to v5; the base class adds Init4/5 and Inner4/5 plus a `_circuitKind` parameter on `computeGateCountForCircuit`, none of which the SDK overrides |
| `x-aztec-version` | `presto-prover.ts:76-81`, `playground/vite.config.ts:186-189`, `playground/src/aztec.ts:52-53` all read `dependencies["@aztec/stdlib"]` | **adapt**: key name |
| Scope-aware bump | `scripts/update-aztec-version.ts:8-35` (`isAztecManagedDep` = `startsWith("@aztec/")` or the `LOCKSTEP_PACKAGES` allowlist) | **adapt**: accept `@aztec-labs/` and `@aztec-foundation/`. `@aztec/viem` stays an alias target and `@aztec-foundation/aztec-standards` leaves (see below) |
| New-version detector | `scripts/check-aztec-update.ts:20-56` (`@aztec/aztec.js` dist-tags, 11-name list), `.github/workflows/aztec-stable.yml:28,31` (`dist_tag: rc`, `merge_mode: none`), `_aztec-update.yml:82` | **adapt**: `@aztec-labs/aztec.js` carries `prerelease: 6.0.0-rc.1` and **no `rc` tag** (`latest` points at `6.0.0-nightly.20260829`) |
| Age-gate exemption | `bunfig.toml:30-62` (31 exact `@aztec/` names), `scripts/bunfig-aztec-excludes.test.ts:28,42-47` (lock regex `@aztec\/`, off-scope names forbidden) | **adapt**: the owner extended the exemption to exact `@aztec-labs/*` and `@aztec-foundation/*` names (Phase 0) |
| Playground deps and Vite config | `packages/playground/package.json:28-53`, `vite.config.ts:44-48,68-69,113,118,189,208,276` | **adapt** |
| Licence fallbacks | `packages/playground/licensing/license-fallbacks.ts:14,18-63` | **adapt**: rules keyed by package name |
| Published-playground build | `scripts/published-playground.ts:192-196`, `scripts/tarball-consumer/*` | **adapt** |
| Release scripts | `_publish-npm.yml:316`, `release-presto.yml:971`, `.github/scripts/packaged-e2e-swap-sdk.sh:111,158` | **adapt** |
| FeeJuice / SponsoredFPC | `playground/scripts/{deploy-sponsored-fpc,batch-fund-fpc}.ts`, `playground/src/aztec.ts:16,236-248`, `sdk/e2e/{legacy-compatibility,proving}.test.ts` | **adapt**: `SponsoredFPC` stays in `@aztec-labs/noir-contracts.js`; `FeeJuice` leaves it, and `FeeJuiceContract` now comes from `@aztec-labs/aztec.js/protocol` |
| Playground token demo | `playground/src/aztec.ts:22,650-790` imports `TokenContract` from `@aztec-foundation/aztec-standards` | **build new (small)**: that package has **no 6.x** (latest 5.2.0). The reference `Token` in `@aztec-labs/noir-contracts.js@6.0.0-rc.1` exists with a different surface (below) |
| Noir adapter | `packages/sdk-noir` peer `@aztec/bb.js@5.2.0` (`package.json:26-34`), `src/lib/tested-versions.ts` | **adapt**: peer renamed to `@aztec-foundation/bb.js`, a breaking change for consumers, so major |
| Noir fixtures | `fixtures/noir/*/manifest.json`, `scripts/noir-fixture.ts:167,238-239` | **adapt**: regenerate with bb.js 6.0.0-rc.1 and confirm byte identity through `test:identity` |
| CRS cache key | `playground/src/aztec.ts:180-188` `CRS_CACHE_VERSION = "5.2.0"` | **adapt**: bump whenever bb.js changes |
| CI Aztec install | `.github/actions/setup-aztec/action.yml:31` (reads `devDependencies['@aztec/aztec.js']`), `:130` (`install.aztec.network/<v>/install`; 301 to `install.aztec-labs.com`, and `curl -L` follows it) | **adapt**: key name |
| Aztec-derived npm versioning | `scripts/npm-packages.ts:63-66` `VERSION_PATTERNS["aztec-derived"]` = `^\d+\.\d+\.\d+(?:-revision\.\d+)?$`; `isValidVersion` :115; used by `playground-pin.ts:20`, `verify-sdk-package-signatures.ts:81`, `release-plan.ts`, `sdk-release-verification.ts:14` | **adapt**: **rejects `6.0.0-rc.1`** today, while `get-sdk-publish-version.ts:23-40` already produces `6.0.0-rc.1` and then `6.0.0-rc.1.1` |
| Pin ordering | `get-sdk-publish-version.ts:46-58` `revisionOrder` **throws** on any prerelease; used by `playground-pin.ts:56` | **adapt** |
| npm channel | `_publish-npm.yml:23-27` accepts `dist_tag` (default `testnet`); `release-sdk.yml` never passes it | **adapt**: no rc channel today, so an rc would land on `testnet` |
| Promotion to `latest` | `scripts/promote-sdk-latest.ts` (`bun run sdk:promote`, owner-run, local) | **adapt**: no guard stops promoting an Aztec prerelease |

## Verified facts (2026-09-28)

- **npm, v6 rc.1**: `@aztec-labs/{aztec.js,bb-prover,stdlib,simulator,wallets,noir-contracts.js,foundation}@6.0.0-rc.1` and `@aztec-foundation/{bb.js,noir-acvm_js,noir-noirc_abi}@6.0.0-rc.1` exist; `engines.node >=20.10` (repo pins Node 24.20.0). `viem` stays `npm:@aztec/viem@2.38.3` (playground pins 2.38.2). Published 2026-09-23; clears a 7-day age floor on 2026-09-30.
- New transitive names in the graph (none in today's exemption list): `@aztec-foundation/{cdb,ipc-runtime,bb-avm-sim,noir-types,l1-artifacts}`, `@aztec-labs/{telemetry-client,world-state,standard-contracts,wallet-sdk,protocol-contracts,entrypoints,constants,ethereum,blob-lib,…}`. The full set is known only after `bun install`.
- **bb releases**: `AztecProtocol/barretenberg` (not a fork, created 2022-12-06) carries v5.0.0 onward, the nightlies from `v5.0.0-nightly.20260630` (earlier ones, e.g. `v5.0.0-nightly.20260307`, and every v4.x are absent), and `v6.0.0-rc.1` (prerelease, 18 assets, each with a `sha256:` digest). v5.2.0's linux and windows assets carry the same digests in both repositories. `aztec-packages` has only the `v6.0.0-rc.1` git tag and no v6 GitHub release, so **every released Presto app (≤ 1.1.2) cannot fetch any v6 bb.**
- The linux v6 tarball's sha256 equals the API digest (`a03fae96…`); `bb --version` prints `6.0.0-rc.1`. Windows v6 asset digest: `6335a0369a4774346c170a0a755d7e2d7e8d2ba4ef7cc0933f2097cf1b0a6607` (API only; needs the F-008 manual review before pinning).
- **Token surfaces** differ. aztec-standards: `constructor_with_minter`, `transfer_private_to_private(from,to,amount,nonce)`. v6 reference Token: `constructor(admin,name,symbol,decimals)`, `mint_to_private(to,amount)`, `transfer(to,amount)`, `transfer_in_private(from,to,amount,nonce)`, `balance_of_private(owner)`. Its generated JS imports `@aztec-labs/aztec.js/{abi,contracts,fields}`, all declared dependencies.
- **Published state**: `@alejoamiras/presto` `latest` = `testnet` = `5.2.0-revision.5`; core, noir and banners are at `1.2.0` on both tags; the app's GitHub Latest is `presto-v1.1.2`, and `tauri.conf.json` is at `1.1.3-rc.1`. The follow-up "next `release-sdk` must bump presto-core and presto-noir (patch)" is still open.
- A guessed `v6.testnet.rpc.aztec-labs.com` returns nothing. The owner will provide the v6 RPC.
- FPC funding needs `L1_PRIVATE_KEY` and `L1_RPC_URL` (`deploy-sponsored-fpc.ts:17-19`), so it is a keyed run.

## Found by the plan audits (2026-09-28, verified)

- **More inline Aztec reads than the reuse map listed**:
  - the tarball consumer: `scripts/tarball-consumer/exact-pin.ts:20-26`, `host-manifest.ts:26`, and
    `scripts/sdk-tarball-consumer.sh:60,105,111,118`, which counts `@aztec/stdlib` copies and installs
    a conflicting `@aztec/stdlib@5.0.0`;
  - `scripts/install-legacy-sdk.ts:68`, which throws when the legacy fixture's `@aztec/stdlib`
    differs from the workspace's;
  - `scripts/noir-fixture.ts:238`, whose `loadBbJs` duplicates `resolveAztecBb()`.
- **The legacy-compatibility gate** (`_e2e.yml:107-112`) runs whenever `build_presto` is true: on
  every SDK PR (`sdk.yml`) and in `release-sdk.yml`'s e2e. Its fixture,
  `audit/fixtures/legacy-identity.json`, pins the pre-rename SDK at 5.2.0, and
  `scripts/presto-release-readiness.ts:3,43` also reads that file.
- **`Bun.resolveSync` fails on `@aztec/stdlib` and `@aztec/foundation`**, which have no root export,
  so any "resolve every dependency" check needs subpaths or manifest lookup.
- **`.github/actions/setup-aztec/action.yml:88-113` has its own npm age gate**:
  `min_release_age_exclude='@aztec/*'`, plus an `allow-scripts` list pinned to aztec 5.2.0's six
  script packages, and a cache salt at :64. The v6 installer runs `npm install
  @aztec-labs/aztec@$VERSION @aztec-labs/cli-wallet@$VERSION` and ships `bb`, `bb-avm-sim`,
  `aztec-wsdb` and `noir-codegen` from `@aztec-foundation`.
- **FPC scripts:**
  - `deploy-sponsored-fpc.ts:46` and `batch-fund-fpc.ts:53` default to the v5 RPC;
  - `batch-fund-fpc.ts:47` defaults to 1,000,000 FJ, and :200 bridges the wallet's whole L1 balance;
  - `deploy-sponsored-fpc.ts` mints test FJ on L1 through `bridgeTokensPublic(…, mint=true)`.
- **`release-plan.ts` cannot plan on today's `main`:** `requireReusable` throws for `presto-core@1.2.0`
  because it changed after its tag (the open follow-up).
- **Local isolation:**
  - `download_and_verify_bb` deletes the shared version cache unless `PRESTO_HOME` is private;
  - `packages/playground/playwright.config.ts` fixes port 5173 with `reuseExistingServer`.
- **Shipped docs carry imports:** `packages/sdk/README.md` and
  `packages/sdk/.claude/skills/presto/SKILL.md` ship in the tarball; `packages/landing/index.html`
  has an install snippet.
- **Licence rule:** `license-fallbacks.ts:12-14,45-48` sources bb.js's Apache text from
  `aztec-packages@v5.2.0/barretenberg/LICENSE`.
- **Windows pins without a barretenberg release:** 4.2.0, 4.3.1 and 5.0.0-rc.1 (`copy-bb.ts:63-82`).
- **npm maintainers:**
  - `@aztec-foundation`: `aztec-foundation-user-account` (a shared account) and `ludamad`;
  - `@aztec-labs`: `nchamo` and `charlielye`.

  `@aztec-foundation/bb.js@6.0.0-rc.1` has SLSA provenance; `@aztec-labs/*` has none, as with
  `@aztec/*@5.2.0`. `@aztec-foundation/bb.js`'s `prerelease` tag already points at
  `7.0.0-nightly.20260928`.

## Collision and dedup risks

- `LOCKSTEP_PACKAGES` holds `@aztec-foundation/aztec-standards`. Widening the managed scope to `@aztec-foundation/` would sweep any foundation package into the bump. The allowlist must stay exact, and aztec-standards leaves the playground.
- `bunfig-aztec-excludes.test.ts` forbids off-scope names. Extending the exemption without updating the test fails `test:scripts`. Updating the test's lock regex without the exemption lets a new transitive slip past.
- `resolvePublishVersion` and `VERSION_PATTERNS` disagree about prereleases. Fixing only one leaves `release-plan.ts` or `playground-pin.ts` throwing mid-release.

## Absence trail

- No `.github/` file hardcodes `aztec-packages/releases` (searched `rg 'aztec-packages' .github`).
- No uses of `returnTypes`/`decodeFromAbi`, `GasPrice`, `getBlockHashMembershipWitness`, `TxRequest.hash` or `ACVM_*` (v6 changelog removals), searched across `packages/*/src`, `packages/*/e2e` and `packages/*/scripts`.
- No existing rc dist-tag in `release-sdk.yml` (searched `dist_tag`).
- Token coverage exists: `playground/e2e/demo.local-network.spec.ts:76` runs the full token flow
  (WASM, 4-minute budget) un-skipped in `test:e2e:local-network`; the Accelerated variant (:46)
  self-skips without `PRESTO_URL`. The rewrite must keep the Local one green.

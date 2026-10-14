# presto-rc3 — recon

Base: `main` @ `14c4085`. One Sonnet reuse sweep plus the driver's own npm, GitHub and live reads,
2026-10-13. Prior art: `archive/aztec-v6/` (the rc.1 migration) and `archive/bundle-v6/`.

## External facts

- npm: `@aztec-labs/{aztec.js,stdlib,bb-prover,foundation,aztec}@6.0.0-rc.3` exist (aztec.js
  published 2026-10-08T12:17Z, dist-tag `prerelease`). Every one of them pins its
  `@aztec-foundation/*` dependencies at **6.0.0-rc.6**: stdlib → `bb.js`, `noir-noirc_abi`;
  bb-prover → `bb.js`, `noir-types`, `noir-noirc_abi`; simulator → `noir-acvm_js`, `cdb`,
  `bb-avm-sim`, `ipc-runtime`; aztec.js → `l1-artifacts`. `viem` stays `npm:@aztec/viem@2.38.3`.
- `@aztec-foundation/{bb.js,noir-acvm_js,noir-noirc_abi}` have rc.1, 2, 4, 5, 6 and **no rc.3**.
- `AztecProtocol/barretenberg` releases: v6.0.0-rc.1, 2, 4, 5, 6, **no v6.0.0-rc.3**. v6.0.0-rc.6
  (2026-10-08T11:34Z, prerelease, 18 assets, tag → commit `654cc60`): linux amd64 digest
  `950d5d07…0628`, windows amd64 `d79cb3ee…d1ac`.
- Installer `install.aztec-labs.com/6.0.0-rc.3/install` differs from rc.1's only in `VERSION`; its
  `versions` file is unchanged (`noir 1.0.0-rc.3`, `foundry 1.4.1`, `node 24.12.0`).
- The testnet forwarder (`presto-testnet-rpc`) answers `node_getNodeInfo` with `nodeVersion
  6.0.0-rc.3`, `l1ChainId 11155111`, `rollupVersion 3409706519`: the network behind every
  testnet-facing path is already rc.3.
- inference-money's Presto e2e runs the released `presto-server-1.1.3-linux-x86_64.tar.gz` (sha256
  `90b76733…7c41`) with no `BB_BINARY_PATH`, so its `bb` is whatever the request's version downloads.

## Reuse map

| Capability | Existing code | Verdict |
|---|---|---|
| Bump every pin | `scripts/update-aztec-version.ts` (`bumpPins`, `findMissingPackages`) | **adapt**: one version for every managed name; at `6.0.0-rc.3` the three foundation names 404 and are skipped with a one-line notice (they stay rc.1); per-name target needed |
| Update detection | `scripts/check-aztec-update.ts` `main` (:69-97) and `verifyAllPackagesExist` (:47-67) | **adapt**: checks every manifest dep at the labs version, so foundation names read as "missing" |
| Update workflow | `_aztec-update.yml`, `aztec-stable.yml` (dispatch only) | reuse-as-is: same written files |
| Manifest reader | `scripts/aztec-manifest.ts` (`FOUNDATION_PACKAGES` = bb.js, noir-acvm_js, noir-noirc_abi; CLI reads all sections) | reuse-as-is; **never edit**: it is in `app.yml`'s `published` filter |
| Version the SDK sends | `packages/sdk/src/lib/presto-prover.ts:79-84` `sdkAztecVersion()` = stdlib pin | **adapt**: send the bb.js version |
| Server version resolution | `core/src/server/prove.rs:55-113`, `versions/release_metadata.rs:87-102` (tag `v<requested>` from barretenberg), `server.rs:474-478` (`/health.versions` pairs `v, v`) | reuse-as-is: the server already keys everything by the bb release string; one comment is now false |
| Bundled bb | `packages/presto/scripts/copy-bb.ts:207-224` `resolveAztecBb()` (sdk → bb-prover → bb.js, live) | reuse-as-is: resolves rc.6 |
| Windows pin | `copy-bb.ts:66-97` `WINDOWS_BB_CHECKSUMS` (manual-review only, F-008) | adapt: add a reviewed `6.0.0-rc.6` entry |
| bb download tool | `scripts/download-bb.ts` | reuse-as-is |
| Workspace age gate | `bunfig.toml:30` (41 exact names), `scripts/bunfig-aztec-excludes.test.ts` | reuse; names only, re-check against the new lock |
| Installer age gate | `.github/actions/setup-aztec/{action.yml,installer-aztec-packages.txt}` | reuse; re-review the list, `allow-scripts` pins and the rc.1 comment |
| Installer graph check | `scripts/aztec-installer-graph.ts:103-122` `compareGraph(graph, listed, release)` | **adapt**: every non-viem name must equal one `release`; foundation at rc.6 fails every local-network job |
| Noir fixtures | `scripts/noir-fixture.ts --regenerate/--verify`, `fixtures/noir/*/manifest.json` (`bbJs 6.0.0-rc.1`, `nargo 1.0.0-rc.3`) | reuse-as-is: regenerate |
| Noir adapter pairing | `sdk-noir/src/lib/tested-versions.ts:6`, `scripts/tarball-consumer/presto-noir/{runtime-check.mjs:15,host-dependencies.json}` | adapt: rc.6 |
| Release planning | `release-plan.ts`, `get-sdk-publish-version.ts` (base = stdlib pin) | reuse-as-is: presto plans `6.0.0-rc.3`; noir needs a manifest bump (`changedSinceTag`) |
| Legacy interop gate | `scripts/install-legacy-sdk.ts` `legacyGate`, `audit/fixtures/interop-sdk.json` (presto 6.0.0-rc.1) | reuse-as-is: dormant on rc.3; throws "stale" once presto 6.0.0-rc.3 is on npm → post-release fixture update |
| SponsoredFPC | derived at runtime (`playground/src/aztec.ts:240`, `scripts/fpc-state.ts`) | reuse; no hard-coded address anywhere (searched `0x[0-9a-f]{40,}`, `0x[0-9a-fA-F]{64}`, `classId`, `computeAddress`) |
| Native-path assertion | `sdk/e2e/proving.test.ts:84-101` (`transmit`, no `fallback`) | reuse-as-is: catches the silent fallback |

## Collision and dedup risks

- **`published` filter** (`app.yml:66-84`): editing `aztec-manifest.ts`, `npm-packages.ts`,
  `get-sdk-publish-version.ts`, `published-playground.ts`, `app.yml` or `published-sdk.json` runs
  the Published Playground Build, which fails until the SDK is published from `main`. The plan
  touches none of them.
- **`CRS_CACHE_VERSION`** is written by the updater with the labs version; the CRS is bb's.
- **No `aztec-nr` pin** in the repo: the three fixture `Nargo.toml`s have empty `[dependencies]`;
  rc.3's Noir-contract changes (`aztec::facts`, `ContractDeployment`, oracle interface) have no
  footprint (searched `Nargo.toml`, `aztec::`, `aztec-nr`, `getBlockHashMembershipWitness`).
- **Docs that state the old model**: `server.rs:474-476`, `tested-versions.ts:1-5`, `README.md`
  (Presto and Aztec versions), `packages/sdk/README.md:555`, `packages/presto/README.md:114,340`,
  `docs/SECURITY_MODEL.md:110`, `docs/RELEASE_RUNBOOK.md:12`.
- About 195 literal `6.0.0-rc.1` lines in 45 files outside the lock; most script-test hits are
  sample data that must not move.

## Open work

`gh issue list --state open`: none. Open PRs: #91 (Dependabot, unrelated). The other active plan,
`verified-sites-feed`, touches the verified-sites list and release-feed Worker, not Aztec pins.

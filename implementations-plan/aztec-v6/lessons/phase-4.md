# Phase 4: v6 dependencies, imports and CI installer policy

## Changes

- **Scopes.** Every `@aztec/<x>` dependency moved to `@aztec-labs/<x>` at `6.0.0-rc.1`. The exceptions
  are the names published under `@aztec-foundation/`: `bb.js`, `noir-acvm_js`, `noir-noirc_abi`,
  `noir-noir_codegen`, `noir-types`, `l1-artifacts`, `cdb`, `ipc-runtime`, `wsdb*` and
  `bb-avm-sim*`. `viem` stays `npm:@aztec/viem@2.38.3`, the fork v6 itself resolves. Imports were
  renamed mechanically, with the foundation names first and then the rest.
- **Token.** `aztec-standards` is gone (A1). The playground deploys the reference
  `@aztec-labs/noir-contracts.js/Token` with Alice as admin, and therefore as minter. `transfer`
  spends the sender's own private notes, so the demo needs no authwit.
- **FeeJuice.** The v6 `FeeJuiceContract` from `@aztec-labs/aztec.js/protocol` carries its canonical
  address, so the FPC scripts dropped their hardcoded `FEE_JUICE_ADDRESS`.
- **Versions.** sdk-noir is `2.0.0-rc.1` with the bb.js peer at `@aztec-foundation/bb.js@6.0.0-rc.1`
  and `TESTED_BB_VERSIONS = ["6.0.0-rc.1"]`. sdk-core is `1.2.1`. `CRS_CACHE_VERSION` follows Aztec.

## Two age gates, exact names only

Aztec publishes a release and its dependencies the same day, so both gates need an exemption.
Neither takes a glob. A scope-wide pattern would also exempt a new package that someone published
into the scope an hour ago, which is exactly what the gate exists to stop.

| Gate | Where | List | Guard |
|---|---|---|---|
| Bun install | `bunfig.toml` `minimumReleaseAgeExcludes` | 42 names | `bunfig-aztec-excludes.test.ts`: the list equals the lock's Aztec names |
| The Aztec CLI's npm install | `setup-aztec` temporary npmrc, `min-release-age-exclude[]` | `installer-aztec-packages.txt`, 62 names | `scripts/aztec-installer-graph.ts` on every job, cache hit included |

- npm 12 prints `npm config get min-release-age-exclude` comma-joined. The step asserts that it
  equals `paste -sd,` of the list, so a typo cannot silently drop an exemption.
- The installer resolves without a lock. A new first-party package that is already older than the
  gate would install without anyone reviewing it. Only the graph check catches that. It compares
  the union of the prefix's `package-lock.json` and a `node_modules` walk with the list.
  - The first version walked only `node_modules`. It flagged six other-platform optional packages
    (`bb-avm-sim-darwin-*`, `-linux-arm64`, …) as stale exemptions, because they are in the lock but
    never on disk. Adding the lock fixed that. The gate filters those packages too, so they belong
    on the list.
- npm 12 blocks install scripts unless it allows them. The seven pins are exact versions:
  `bcrypto@5.5.2 leveldown@6.1.1 lmdb@3.5.6 msgpackr-extract@3.0.4 protobufjs@7.6.6
  unrs-resolver@1.12.2 @parcel/watcher@2.6.0`.

## Installer evidence (scratch prefix, npm 12.0.2, 2026-09-28)

- `npm config get min-release-age-exclude` matched all 62 listed names.
- `npm install` of `@aztec-labs/aztec` and `@aztec-labs/cli-wallet` gave no ETARGET and no
  blocked-scripts lines. `aztec --version` printed `6.0.0-rc.1`.
- `npm ls --all`: 2,891 lines. The 78 UNMET or extraneous lines are other-platform optionals plus
  one extraneous `zod@3.25.76`. The full tree is not committed: it is almost entirely third-party,
  and its first line is the local install path. The part this gate needs is the Aztec-scoped
  subset below, whose names are exactly the reviewed list: `diff` is empty, and
  `aztec-installer-graph.ts` reports that it matches (62 names).
- Aztec-scoped entries: all `6.0.0-rc.1` except `@aztec/viem@2.38.3`. The reviewed list
  (`.github/actions/setup-aztec/installer-aztec-packages.txt`), by scope:
  - `@aztec-foundation/` (18): bb-avm-sim, bb-avm-sim-darwin-arm64, bb-avm-sim-darwin-x64,
    bb-avm-sim-linux-arm64, bb-avm-sim-linux-x64, bb.js, cdb, ipc-runtime, l1-artifacts,
    noir-acvm_js, noir-noir_codegen, noir-noirc_abi, noir-types, wsdb, wsdb-darwin-arm64,
    wsdb-darwin-x64, wsdb-linux-arm64, wsdb-linux-x64.
  - `@aztec-labs/` (43): accounts, archiver, aztec, aztec-node, aztec.js, bb-prover, blob-client,
    blob-lib, bot, builder, cli, cli-wallet, constants, entrypoints, epoch-cache, ethereum,
    foundation, key-store, kv-store, native, node-keystore, node-lib, noir-contracts.js,
    noir-protocol-circuits-types, noir-test-contracts.js, p2p, protocol-contracts, prover-client,
    prover-node, pxe, sequencer-client, simulator, slasher, sqlite3mc-wasm, standard-contracts,
    stdlib, telemetry-client, txe, validator-client, validator-ha-signer, wallet-sdk, wallets,
    world-state.
  - `@aztec/` (1): viem.

## The v6 installer changed shape

- `install.aztec.network/6.0.0-rc.1/install` redirects to `install.aztec-labs.com`. It runs
  `npm install --prefix ~/.aztec/versions/<v>` for the CLI and wallet.
- Foundry binaries are copied (`cp -Lp`) into `internal-bin/`, and the `aztec` wrapper prepends that
  directory to `PATH`. The old `mv` patch had nothing to patch, so it was removed.
- `bin/` holds only `aztec-*` symlinks. The "Ensure foundry-toolchain forge wins" step is therefore a
  no-op on v6. It was left in place for v5 caches.
- The versions file pins `noir 1.0.0-rc.3`, `foundry 1.4.1` and `node 24.12.0`.

## Local workarounds (dev box only, not in CI)

- `noirup` honoured the machine's `NARGO_HOME` and wrote outside the scratch prefix. I unset
  `NARGO_HOME` and the XDG variables for the scratch run.
- `foundryup` refused because another agent's `anvil` was running. It checks for the name, not for
  ownership. The scratch installer extracted the digest-checked foundry `v1.4.1` tarball itself.
  Never kill the other agent's process to get past this.

## Licences

- `@aztec-foundation/l1-artifacts` failed the licence build as unmapped. It is Aztec's own package,
  so it takes the Aztec rule by exact name (`AZTEC_FOUNDATION_OWN`). A new foundation name still
  fails the build.
- **D18 deviation.** `AztecProtocol/barretenberg` has no LICENSE at `v6.0.0-rc.1`, because it is a
  release-only repository. bb.js's text comes from `aztec-packages/v6.0.0-rc.1/barretenberg/LICENSE`,
  which I checked is byte-identical to the text D18 used.

## Windows bb pin (F-008 review)

`copy-bb.ts` pins `bb.exe` `6.0.0-rc.1` at sha256 `6335a036…6607`, marked manual-review.

- The release is a prerelease published 2026-09-23 by AztecBot, targeting master. It carries a
  lightweight tag on GitHub-verified commit `654cc60`.
- The downloaded digest equals the API digest; the file is 7,118,884 bytes.
- The zip holds a single PE, `bb.exe`, which embeds `BARRETENBERG_VERSION_SENTINEL6.0.0-rc.1`.
- Against the 5.2.0 asset: no bundled DLLs, and the same imported-DLL set.

## `@aztec/` grep: accepted hits

`rg -n --pcre2 '@aztec/(?!viem)' packages scripts .github README.md docs` now hits only:

- `scripts/aztec-manifest.ts` and its tests, which read both generations;
- `scripts/tarball-consumer/exact-pin.test.ts`, which is dual-generation on purpose;
- `scripts/sdk-tarball-consumer.sh:115`, the v5 branch of the conflict-host version;
- labelled v5 lines in `README.md`, `packages/sdk/README.md`, `packages/sdk/MIGRATION.md`, the sdk-noir
  README install line and tested-pairs history, and `docs/SECURITY_MODEL.md`'s trust decision;
- `.github/scripts/packaged-e2e-swap-sdk.sh:62`, a comment. The file is in `app.yml`'s `published`
  filter, and arc 3 must not touch that filter's files.

## Traps

- Stale `@aztec/*` symlinks in `node_modules` masked missing renames: imports still resolved. Only a
  clean `rm -rf node_modules packages/*/node_modules && bun install --frozen-lockfile` exposes them.
- An import error in a test file fails at load. Bun reports it as an error, not as `(fail)`, so a
  grep for `(fail)` misses it.
- `app.yml` is in its own `published` filter. The graph script reaches CI through `sdk.yml`'s
  `scripts/**` and presto's `sdk_integration`, not through `app.yml`.

## Gate status

- Passed locally:
  - `bun install --frozen-lockfile` with no min-age skips;
  - `bun run test` and `bun run lint` exit 0 (after the phase 5 fixtures), and `lint:actions`;
  - the four builds, licence gate included;
  - the three tarball consumers against v6 tarballs;
  - prebuild `AZTEC_VERSION` = `6.0.0-rc.1`;
  - the scratch installer checks above, and the graph check on the scratch tree;
  - the graph test's named addition and removal;
  - an empty `published` intersection.
- Open: the graph check on this PR's CI, on a cache miss and on a cache hit.

## CI evidence on PR #73

- **Cache miss.** Run 36498426854 at `4999936`, SDK E2E job:
  - "Cache not found for input keys: Linux-aztec-6.0.0-rc.1-minage7-npm12-exactexempt-allowscripts7";
  - the install step ran with no ETARGET and no blocked-packages warning;
  - the graph check then reported "Aztec installer graph matches … at 6.0.0-rc.1 (62 names)";
  - the SDK e2e passed 7, failed 0.
- **Cache hit.** Run 36499861024 at `940f6b2`:
  - "Cache hit for: Linux-aztec-6.0.0-rc.1-minage7-npm12-exactexempt-allowscripts7";
  - the install step was skipped;
  - the same graph check matched (62 names).
- **Whole PR.** `gh pr checks 73` reported 69 pass, 11 skipping, 0 fail.
- **New advisory.** `fast-uri` GHSA-qw65-cvwx-89v3 and GHSA-58mr-gqgx-xq4g (published 2026-09-28) failed the dependency audit on `main`'s lock too. The fix bumped `fast-uri` from 3.1.6 to 3.1.8, which is past the 7-day gate.
- **Landing preview.** It failed instantly once, with no build log outside the dashboard, the same shape as #72's. The same build passed locally, and on the next push.
- The rename sweep still hits exactly the set listed above.

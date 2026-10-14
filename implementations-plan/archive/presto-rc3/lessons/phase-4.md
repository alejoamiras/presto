# Phase 4: local rc.3 network, branch and released servers

Run `presto-rc3-p4-20261014T002314Z`, 2026-10-14 00:23–00:29 UTC.

## Verification option: 2

- **Option 1 is not reachable without a patch.** `createLocalNetwork` builds its node config from
  `{ ...getConfigEnvVars(), ...config, ..., realProofs: config.realProofs ?? false }`
  (`@aztec-labs/aztec/dest/local-network/local-network.js:107`). Here `config` is only what
  `aztec start --local-network` passes (`l1Mnemonic`, `l1RpcUrls`, `testAccounts`;
  `cli/aztec_start_action.js:24-28`). So `PROVER_REAL_PROOFS` never reaches it, and `realProofs` is
  `false` whatever the environment says.
- **Option 2 ran.** `DEBUG_FORCE_TX_PROOF_VERIFICATION=true` reaches the node through
  `getConfigEnvVars`, and `aztec-node/dest/factory.js:163` then selects `BatchChonkVerifier`
  (peer) and `QueuedIVCVerifier(BBCircuitVerifier)` (RPC).
  - `BB_BINARY_PATH` was the install's bb.js rc.6 `build/amd64-linux/bb`.
  - `BB_WORKING_DIRECTORY` was a real-disk scratch dir.
- **The bootstrap patch, verbatim.** It applied to the container's scratch install only and was
  reverted at teardown. Paths are relative to
  `~/.aztec/versions/6.0.0-rc.3/node_modules/@aztec-labs/aztec/`.

  ```diff
  --- dest/local-network/local-network.js.orig
  +++ dest/local-network/local-network.js
  @@ -165,7 +165,7 @@
       if (initialAccounts.length) {
           const wallet = await EmbeddedWallet.create(node, {
               pxeConfig: {
  -                proverEnabled: aztecNodeConfig.realProofs
  +                proverEnabled: true
               },
               ephemeral: true
           });
  ```

- **Evidence in the node log.**
  - `bb-prover:batch_chonk_verifier BatchChonkVerifier started` and
    `bb-prover:queued_chonk_verifier Starting QueuedIVCVerifier with 8 concurrent verifiers`.
  - Then one `bb-prover:verifier Chonk verification successful` (`debug:bb-prover:verifier`) per
    tx: 10 in total, the 4 bootstrap txs and the 6 below, with 0 `Failed to verify`.
  - The node still logs `Aztec node is accepting fake proofs`, because that warning keys off
    `realProofs` alone, not off the verifier in use.
- `node_getNodeInfo`: `nodeVersion` `6.0.0-rc.3`, `l1ChainId` 31337. The node exposes no
  `realProofs` field, so the verifier lines are the evidence.
- The local SponsoredFPC (salt 0) is `0x2adfb70e860909f0db8268b3fec80bce52a94559963444f5c0341816b8412130`,
  the address phase 5 reads on testnet.

## Run isolation

- Ports came from `~/.agents/ports.md` under one lease:
  - node, admin and anvil;
  - one port per server;
  - one never-bound port as `PRESTO_HTTPS_PORT`, so no request could reach another instance on
    59834.
- The network ran in `<run>-net`: `--user uid:gid`, `--cap-drop ALL`, `no-new-privileges`,
  `--network host`. The install was mounted read-only, with node 24 and a scratch home.
  `ANVIL_PORT` and `--port`/`--admin-port` were the claimed ports.
- Each released server ran in `<run>-srv-<version>` with the same flags and its binary dir
  read-only. Its environment was exactly `HOME`, `PATH=/usr/bin:/bin` and `PRESTO_HOME`: no
  `BB_BINARY_PATH`, no `AZTEC_BB_VERSION`, no `bb` on `PATH`, and an empty `HOME`.
- The branch server and every bun suite ran on the host under `env -i`, in their own process
  groups.
- Teardown:
  - containers by name: none left;
  - process groups killed: gone;
  - lease rows released: 0 left;
  - patch reverted.
  - The only other `presto-server` on the host belongs to another run, not this one, and was left
    alone.

## Branch server, as CI runs it

- Sidecar bb, `AZTEC_BB_VERSION=6.0.0-rc.6`, no `--allow-all`, as `_e2e.yml` runs it.
- `/health`: `version 1.1.4-rc.1`, `aztec_version 6.0.0-rc.6`, `schemes [chonk, ultra_honk]`.
- `install-legacy-sdk.ts`: `::notice title=Legacy SDK gate dormant::@alejoamiras/presto@6.0.0-rc.1
  targets Aztec 6.0.0-rc.1; the workspace targets 6.0.0-rc.3`.
- `packages/sdk test:e2e`: 7 pass, 0 fail. `should deploy account through the NATIVE presto path`
  asserts `transmit` and no `fallback`.
  - Server log: `Requested Aztec version version=6.0.0-rc.6`, then
    `Starting bb prove version="bundled"`.
  - Node log: verified and received tx
    `0x1b7bcfdf1213defa2344f655e126b3818d55df9583f690c75d3e64b5826f193d`. Receipt: `success`,
    block 5, status `proven`.
  - The WASM test's tx `0x28969679…867b`: `success`, block 6, `proven`.
- `packages/sdk-noir test:e2e`: 6 pass, 1 skip (the optional W cross-check), 0 fail.

## Released servers, cold cache

| | 1.1.3 | 1.2.0-rc.1 |
|---|---|---|
| asset | `presto-server-1.1.3-linux-x86_64.tar.gz` | `presto-server-1.2.0-rc.1-linux-x86_64.tar.gz` |
| sha256 (equals the release's `.sha256` and the API digest) | `90b76733c36ef337f19a326a3263ae0128b83d36bbea9ffb39bb09a4c0c07c41` | `21cecfe17edc70ea7fc19cd9eff29bb0466f8ce56d52d50fd842466f3c1359ab` |
| `/health.version` before the run | `1.1.3`, `bb_available false`, `aztec_version unknown` | `1.2.0-rc.1`, same |
| server log | `Version not cached (or unverified), will download version=6.0.0-rc.6` → `Downloading bb … barretenberg/releases/download/v6.0.0-rc.6/barretenberg-amd64-linux.tar.gz` → `Download integrity verified … digest=950d5d07…0628` → `Starting bb prove version="6.0.0-rc.6"` | same |
| SDK e2e | 7 pass; native tx `0x0cd6a2e46aa0e8a2d484fba5bed12963e33af9d8c3774b96601c0e8afd7de735`, verified, `success`, block 7, `proven` | 7 pass; native tx `0x2355bd98b2a2a67846c8b069a5ca5b99a0e96347093b5c606402f81eca02d297`, verified, `success`, block 9, `proven` |
| sdk-noir e2e | 6 pass, 1 skip | 6 pass, 1 skip |
| `versions/` | only `6.0.0-rc.6`; no `6.0.0-rc.3` | same |
| `bb.sha256.json` | `archive_sha256 950d5d07f6c5f8f331a73af4c503a81e5f4e595d3e313b85f513ec3577920628`, `binary_sha256 3bec00ff8d3b8eb063f3b3027d038c5981012497b755f18af1d50fc6e0548d8a` | same |

**The downloaded `bb` and bb.js rc.6's `build/amd64-linux/bb` do not hash equal.**

- Hashes: `3bec00ff…8d8a` and `fa4b12ad…829f`. The second is also the sidecar's hash.
- Both files are the same size, 44698432 bytes.
- `cmp` finds 11 differing bytes, all at offsets 1248732–1248745. That range is the version-stamp
  slot, after the NUL that ends `BARRETENBERG_VERSION_SENTINEL6.0.0-rc.6`.
- The bytes are leftover padding from two separate stampings: `000000.00000000` in the GitHub
  tarball and `ly.20261008.a` in the npm package.
- Outside that slot the binaries are byte-identical, and both report `6.0.0-rc.6`. So the claim
  holds as "the same build", not as "the same file".

## Playground

- `bun run --cwd packages/playground test:e2e` (mocked) with 5173 claimed: 22 passed.
- The first attempt failed because Playwright's `chromium_headless_shell-1234` (the pinned 1.62.1)
  was not installed. `bunx playwright install chromium` fixed it.
- The local-network suite is CI's (`app.yml` `local-network-e2e`), as planned.

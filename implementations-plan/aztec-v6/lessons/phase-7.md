# Phase 7: network cutover

7a runs against the private v6 testnet RPC. That RPC reaches only owner-approved `env-exec` keyed
runs (template `packages/playground/scripts/testnet-v6.env.example`), so these notes record node
answers, never the URL.

## 7a keyless checks

- `bun test ./scripts` in the playground: 10 pass. The tests cover malformed amounts, cap breaches, a
  wrong destination, node and L1 chain mismatches, disagreeing successive node answers (pinned to
  one snapshot), and the key-file and mint-plan refusals.
- `rg -n 'L1FeeJuicePortalManager\.new' packages/playground/scripts` is empty.

## Recon (keyed run `v6-fpc-recon-d7995754`, HEAD `f8451ef`)

- `node_getNodeInfo`: `nodeVersion` 6.0.0-rc.1, `l1ChainId` 11155111.
- **The salt-0 SponsoredFPC is unfunded.** `0x06a9fa0208c78509921b0487a6b5cd5c2e93baf17de1a18d310f65a3cc1d924b`:
  instance not published, FeeJuice 0.
- The `--preflight` manifest (bootstrap 1000 FJ, FPC 1000 FJ, max total 2000):

  | field | value |
  |---|---|
  | chain | 11155111 |
  | registry | `0xa0bfb1b494fb49041e5c6e8c2c1be09cd171c6ba` |
  | rollupVersion | 2914217885 |
  | portal | `0x5bb7523a95c1fdf1d2a3dd9fb7d497e7f5142d7f` |
  | token | `0x762c132040fda6183066fa3b14d985ee55aa3c18` |
  | handler | `0x5602c39a6e9c5ace589f64f754927bcda4f4bfc9` |
  | fpc | `0x06a9fa0208c78509921b0487a6b5cd5c2e93baf17de1a18d310f65a3cc1d924b` |

- Playground `test:live`: 12 pass, including the live `node_getNodeInfo` probe. SDK
  `e2e/remote-network.test.ts`: 3 pass (non-sandbox chain, valid node info).

## Anchor check (keyless, public L1 RPC)

The independent anchor is the networks registry on Sepolia, `0xa0bf…c6ba`, and its mint handler,
`0x5602…bfc9`. **Verdict: AGREES.**
- The node's registry resolves rollup version 2914217885 to rollup `0x8c2fb2a6…bbd9`.
- That rollup's fee-asset portal and fee asset equal the manifest's portal and token.
- The portal's `UNDERLYING` is the token, and its `ROLLUP` is that rollup.
- The handler's `FEE_ASSET` is the token.
- The anchor registry derives the same portal and token, and the anchor handler equals the
  manifest's.
- The handler mints 1000 FJ per call, so the funding run needs 2 mints.

## Disposable key

- Address: `0xBD7461b512257F5C25351eCbdD749169FfD650c6`. It was generated on this machine into a
  mode-0600 file (in a 0700 directory) outside the repository. The key was never printed.
- Sepolia gas was about 1 gwei at generation. The run's roughly 6 L1 transactions need about
  0.001 ETH.
- The owner funded the address with 0.15 Sepolia ETH (seen at 01:36:31Z).

## Funding (keyed run `v6-fpc-fund-b4923310`, HEAD `9ec1800`)

The `--expect-*` values were exactly the anchor-checked manifest's, with `--max-total 2000`.
- **Six L1 transactions**, each a handler mint, a token approval or a portal deposit, one set for
  each bridge. Nonces 0–5: `0xa131…98a6`, `0x86e4…e90f`, `0xe31f…a7c6`, `0x8328…f748`, `0xfb1f…97bf`,
  `0x8560…5c97`. Gas totalled about 0.0005 ETH.
- The bootstrap account `0x0737…a0ef` claimed 1000 FJ in its deployment (block 700).
- The SponsoredFPC was deployed in block 701.
- The FPC's 1000 FJ was claimed in block 703.
- `fpc-state.ts --salt 0x0` afterwards: `instancePublished: true`, **FeeJuice 1000 FJ**
  (1000000000000000000000 wei).
- **The key file and its directory are deleted.** The roughly 0.1495 ETH left at the disposable
  address is stranded with it, which is fine for Sepolia.
- The playground smoke in the same run never launched a browser. The keyed run's sanitized
  environment drops `PLAYWRIGHT_BROWSERS_PATH`, so Playwright looked in `~/.cache/ms-playwright`,
  which holds another build (1243), instead of `/opt/ms-playwright` (1234). A keyed Playwright run
  must set the path in its own command.

## Playground smoke (keyed run `v6-smoke-36e64687`, HEAD `32ec567`)

The branch `presto-server` (commit `be8e23f`'s server code) ran on the claimed port 59833, with a
private `PRESTO_HOME`, the v6 sidecar through `BB_BINARY_PATH`, and `AZTEC_BB_VERSION=6.0.0-rc.1`.
The command set `PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright`, and Vite ran on the claimed port 5173.

`test:e2e:smoke`: **3 passed, 1 skipped** (1.6 min).
- **Accelerated deploys account.** The spec asserts `expectNativeProof`. The server log shows the
  playground's `x-aztec-version: 6.0.0-rc.1` request running bundled bb over 7 circuits with the
  Chonk scheme, and "Proving succeeded". The testnet then accepted the account deployment, whose
  fee the newly funded SponsoredFPC paid.
- Local (WASM) deploys account.
- The real bb.js WASM Noir proof matches the fixture.
- Skipped by design: the native Noir proof, because an `http:` `PRESTO_URL` names the headless
  server, which the Noir backend does not use.

`test:live` (12 pass) and the SDK's `remote-network.test.ts` (3 pass) ran in the recon run, before
the server was up. Neither contacts Presto: the live test calls only `checkAztecNode`, and the
remote test calls only the node's JSON-RPC. So the server's absence does not change what they
prove.

Teardown: the server's process group was killed and 59833 and 5173 were released. The local
Playwright `test-results/` were deleted, since traces can carry the node URL.

Follow-up for the close-out: `vite.config.ts` now imports `scripts/aztec-manifest.ts`, and Vite
warns that the root package has no `"type": "module"` for its future `configLoader: 'native'`
default. It is a warning only; the current loader builds and serves.

## 7b: the forwarder standing in for the public RPC (D36)

Aztec had not published a public v6 RPC. The owner authorized (Aztec acked) a Worker that forwards
node JSON-RPC to the private RPC, so 7b could commit a URL now.

- **Unit gate:** `packages/testnet-rpc` has 18 tests. A mutation run removed each guard in turn (the
  upstream-echo scrub, the method allowlist, the origin check, the body cap), and each removal failed
  a test.
- **Deploy (keyed run `testnet-rpc-up-8fa2ca55`, HEAD `5d49dc4`):** `forwarder.sh up` deployed
  `presto-testnet-rpc` (version `5e859b8d`), then set `AZTEC_NODE_URL` from stdin.
  - The first request (`…ab981be3`) died at `op-remote create`. Every `# op:` directive in a
    template must name the one item that the run creates. The node URL's item already existed, so
    its directive came out.
- **Keyless checks** against `https://presto-testnet-rpc.alejo-amiras.workers.dev`:
  - `node_getNodeInfo` and `aztec_getNodeInfo` return 200, `nodeVersion` 6.0.0-rc.1 and
    `l1ChainId` 11155111. The CORS allow-origin header echoes the playground.
  - A mixed `aztec_`/`node_` batch returns 200.
  - `p2p_getPeers`, `aztecAdmin_getConfig` and `Origin: https://evil.example` each get 403.
  - The preflight from the playground gets 204, and a GET gets 405.
  - No response carries a key-shaped path.
- **Cutover:** the forwarder URL is in `vite.config.ts`, `dev:testnet`, `test:e2e:remote`,
  `smoke-playground.yml` and the release-contract assertion. `rg -n 'v5\.testnet\.rpc' packages
  .github` is empty.
- **`test:live` first failed (11 of 12).** Under happy-dom the page is `about:blank`, so its fetch
  sends a CORS preflight with `Origin: null`, which the forwarder refuses by design. Allowing `null`
  would let any sandboxed iframe through. The live describe now sets happy-dom's URL to
  `https://playground.presto.build/`, the origin the production bundle calls from, and restores
  `about:blank` afterwards.
  - After the fix, `test:live` passes 12 of 12 and the SDK's `test:e2e:remote` passes 3, with no
    key.
- **Keyless smoke through the forwarder:**
  - Setup: the branch `presto-server` on the claimed port 59833 (v6 sidecar,
    `AZTEC_BB_VERSION=6.0.0-rc.1`) and Vite on 5173, with
    `AZTEC_NODE_URL=<forwarder>`.
  - Result: **3 passed, 1 skipped**. The accelerated account deploy passed with "Proving
    succeeded" in the server log, and the testnet accepted the transaction. That covers the
    wallet's real call mix (batches, `sendTx` with a Chonk proof) under the allowlist and the body
    cap. The local WASM deploy and the WASM Noir proof also passed. The native Noir test was skipped,
    as in 7a.
  - Dev routes the browser through Vite's `/aztec` proxy, so this smoke does not exercise browser
    CORS. `test:live` above does.
  - Teardown: the server's process group was killed, both ports were released, and `test-results/`
    was deleted.
- `bun run test` and `bun run lint:actions` exit 0; `git grep -nE '/k/[0-9a-f]{32,}'` is empty.

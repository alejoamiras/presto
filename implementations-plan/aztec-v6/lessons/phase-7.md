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
  each bridge. Nonces 0–5: `0xa131…98a6`, `0x86e4…0e90f`, `0xe31f…a7c6`, `0x8328…f748`, `0xfb1f…97bf`,
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

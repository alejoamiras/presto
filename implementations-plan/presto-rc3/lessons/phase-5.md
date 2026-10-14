# Phase 5: keyless testnet reads

2026-10-14, through the testnet forwarder the SDK's `test:e2e:remote` names. No key and no
transaction were used, and no upstream node URL was printed.

- `node_getNodeInfo`: `nodeVersion` `6.0.0-rc.3`, `l1ChainId` 11155111.
- `bun packages/playground/scripts/fpc-state.ts --salt 0x0`, run under `env -i`:
  - SponsoredFPC `0x2adfb70e860909f0db8268b3fec80bce52a94559963444f5c0341816b8412130`. The
    local rc.3 network derives the same address (phase 4).
  - `instancePublished: true`.
  - FeeJuice balance: `993999924039988000000` wei (993 FJ).
- The balance is not zero, so no owner issue is filed for it.

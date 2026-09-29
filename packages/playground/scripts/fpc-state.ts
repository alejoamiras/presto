/**
 * Read-only state of a SponsoredFPC: whether its instance is published at the salt's address (it is
 * private-only, so it works unpublished) and its FeeJuice balance. No key, no transaction.
 *
 *   AZTEC_NODE_URL=... bun packages/playground/scripts/fpc-state.ts --salt 0x0
 */

import { parseArgs } from "node:util";
import { Fr } from "@aztec-labs/aztec.js/fields";
import { createAztecNodeClient } from "@aztec-labs/aztec.js/node";
import { getFeeJuiceBalance } from "@aztec-labs/aztec.js/utils";
import { SponsoredFPCContract } from "@aztec-labs/noir-contracts.js/SponsoredFPC";
import { getContractInstanceFromInstantiationParams } from "@aztec-labs/stdlib/contract";

const { values } = parseArgs({ options: { salt: { type: "string" } }, strict: true });
const nodeUrl = process.env.AZTEC_NODE_URL;
if (!nodeUrl) throw new Error("AZTEC_NODE_URL is required; there is no default network");
if (!values.salt) throw new Error("--salt is required (0x0 is the canonical SponsoredFPC)");

const node = createAztecNodeClient(nodeUrl);
const { address } = await getContractInstanceFromInstantiationParams(
  SponsoredFPCContract.artifact,
  {
    salt: Fr.fromHexString(values.salt),
  },
);
const [info, published, balance] = await Promise.all([
  node.getNodeInfo(),
  node.getContract(address),
  getFeeJuiceBalance(address, node),
]);
console.log(
  JSON.stringify(
    {
      nodeVersion: info.nodeVersion,
      l1ChainId: info.l1ChainId,
      fpc: address.toString(),
      instancePublished: published !== undefined,
      feeJuiceWei: balance.toString(),
      feeJuiceFj: (balance / 10n ** 18n).toString(),
    },
    null,
    2,
  ),
);

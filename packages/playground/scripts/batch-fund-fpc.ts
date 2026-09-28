/**
 * Fund an existing SponsoredFPC: mint `--fpc-amount` on L1 through the handler's fixed-size mints,
 * bridge exactly that amount in one deposit, and claim it on L2 from a bootstrap account funded with
 * `--bootstrap-amount`. Never bridges the signer's whole balance.
 *
 * Same two steps and flags as `deploy-sponsored-fpc.ts`: `--preflight` prints the manifest without a
 * key; the funding run adds `--l1-key-file` and every `--expect-*` value, and refuses a mismatch
 * before the key is read.
 *
 *   AZTEC_NODE_URL=... bun packages/playground/scripts/batch-fund-fpc.ts --preflight \
 *     --salt 0x0 --bootstrap-amount 1000 --fpc-amount 1000 --max-total 2000
 */

import { Fr } from "@aztec-labs/aztec.js/fields";
import { createAztecNodeClient } from "@aztec-labs/aztec.js/node";
import { createLogger } from "@aztec-labs/foundation/log";
import { SponsoredFPCContract } from "@aztec-labs/noir-contracts.js/SponsoredFPC";
import { getContractInstanceFromInstantiationParams } from "@aztec-labs/stdlib/contract";
import { createPublicClient, createWalletClient, http, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  bootstrapAccount,
  checkL1Chain,
  checkManifest,
  claimForFpc,
  fundingBudget,
  manifestOf,
  parseFundingArgs,
  portalManagerFrom,
  readKeyFile,
  readSnapshot,
  waitForClaim,
} from "./fpc-funding";

const args = parseFundingArgs(process.argv.slice(2), process.env);
const node = createAztecNodeClient(args.nodeUrl);
const fpc = await getContractInstanceFromInstantiationParams(SponsoredFPCContract.artifact, {
  salt: Fr.fromHexString(args.salt),
});
const snapshot = await readSnapshot(node);
const manifest = manifestOf(snapshot, fpc.address, args);
if (!args.keyed) {
  console.log(JSON.stringify(manifest, null, 2));
  process.exit(0);
}

checkManifest(manifest, args.keyed.expect);
const { l1RpcUrl, keyFile, expect } = args.keyed;
const chain = await checkL1Chain(createPublicClient({ transport: http(l1RpcUrl) }), expect.chain);
const account = privateKeyToAccount(readKeyFile(keyFile));
const l1Client = createWalletClient({ account, chain, transport: http(l1RpcUrl) }).extend(
  publicActions,
);
const manager = portalManagerFrom(
  snapshot,
  // viem's http() transport vs the FallbackTransport the manager is typed for: runtime-compatible.
  l1Client as unknown as Parameters<typeof portalManagerFrom>[1],
  createLogger("batch-fund-fpc"),
);
const bridge = await fundingBudget(manager, account.address, args.maxTotalFj, [
  args.bootstrapFj,
  args.fpcFj,
]);

if (!(await node.getContract(fpc.address))) {
  throw new Error(`no contract at ${fpc.address}; deploy it with deploy-sponsored-fpc.ts`);
}
console.log(
  `  SponsoredFPC ${fpc.address} on chain ${snapshot.chainId}, L1 signer ${account.address}`,
);
const fpcClaim = await bridge(fpc.address, args.fpcFj);
const { wallet, address } = await bootstrapAccount(node, bridge, args.bootstrapFj);
await waitForClaim(node, fpcClaim);
await claimForFpc(wallet, address, fpc.address, fpcClaim);
console.log(`  Done: ${args.fpcFj} FJ claimed for ${fpc.address}`);

/**
 * Deploy a SponsoredFPC (unless it exists) and fund it, bounded and bound to approved destinations.
 *
 * 1. Preflight, no L1 key: prints the manifest (node version, L1 chain, fee juice portal, token, mint
 *    handler, the FPC address the salt gives, amounts) for approval.
 *
 *      AZTEC_NODE_URL=... bun packages/playground/scripts/deploy-sponsored-fpc.ts --preflight \
 *        --salt 0x0 --bootstrap-amount 1000 --fpc-amount 1000 --max-total 2000
 *
 * 2. The funding run: the same flags plus `--l1-key-file <0600 file>` and every approved value as
 *    `--expect-{chain,portal,token,handler,fpc}`; `L1_RPC_URL` names the signer's L1 RPC. Any mismatch
 *    is refused before the key is read. `--fund-only` skips the deployment.
 *
 * The bootstrap account, funded with `--bootstrap-amount`, pays for the L2 transactions, including the
 * FeeJuice claim that credits the FPC with exactly `--fpc-amount`.
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

const argv = process.argv.slice(2);
const fundOnly = argv.includes("--fund-only");
const args = parseFundingArgs(
  argv.filter((arg) => arg !== "--fund-only"),
  process.env,
);
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
  createLogger("deploy-fpc"),
);
const bridgeExact = fundingBudget(args.maxTotalFj);
const bridge = (to: typeof fpc.address, amountFj: bigint) =>
  bridgeExact(manager, account.address, to, amountFj);

console.log(
  `  SponsoredFPC ${fpc.address} on chain ${snapshot.chainId}, L1 signer ${account.address}`,
);
const { wallet, address } = await bootstrapAccount(node, bridge, args.bootstrapFj);

if (!fundOnly && !(await node.getContract(fpc.address))) {
  const { receipt } = await SponsoredFPCContract.deploy(wallet, {
    salt: Fr.fromHexString(args.salt),
    universalDeploy: true,
  }).send({ from: address });
  console.log(`  SponsoredFPC deployed in block ${receipt.blockNumber} (tx ${receipt.txHash})`);
}

const claim = await bridge(fpc.address, args.fpcFj);
await waitForClaim(node, claim);
await claimForFpc(wallet, address, fpc.address, claim);
console.log(`  Done: ${args.fpcFj} FJ claimed for ${fpc.address}`);

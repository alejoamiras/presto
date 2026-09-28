/**
 * Shared guard for the SponsoredFPC funding scripts. A funding run signs L1 transactions whose
 * destinations (fee juice portal, token, mint handler) come from the Aztec node, so the node is read
 * once, that snapshot is checked against the approved values, and nothing a signer touches is read
 * from the node again. Every check runs before the L1 key is loaded.
 */

import { readFileSync, statSync } from "node:fs";
import { parseArgs } from "node:util";
import type { AztecAddress, EthAddress } from "@aztec-labs/aztec.js/addresses";
import { L1FeeJuicePortalManager, type L2AmountClaim } from "@aztec-labs/aztec.js/ethereum";
import type { AztecNode, NodeInfo } from "@aztec-labs/aztec.js/node";
import type { Wallet } from "@aztec-labs/aztec.js/wallet";
import type { Logger } from "@aztec-labs/foundation/log";
import type { Hex } from "viem";
import { foundry, sepolia } from "viem/chains";

/** Caps in whole FJ. Raising one is a reviewed code change, never a flag. */
export const CAPS_FJ = { bootstrap: 1_000n, fpc: 1_000n, total: 2_000n } as const;
const WEI_PER_FJ = 10n ** 18n;
const CHAINS = [sepolia, foundry];

export interface Expected {
  chain: number;
  portal: string;
  token: string;
  handler: string;
  fpc: string;
}

export interface FundingArgs {
  nodeUrl: string;
  salt: string;
  bootstrapFj: bigint;
  fpcFj: bigint;
  maxTotalFj: bigint;
  preflight: boolean;
  /** Absent only in preflight mode. */
  keyed?: { l1RpcUrl: string; keyFile: string; expect: Expected };
}

function wholeFj(flag: string, raw: string | undefined, cap: bigint): bigint {
  if (raw === undefined || !/^[1-9][0-9]{0,6}$/.test(raw)) {
    throw new Error(`${flag} must be a positive whole number of FJ, got ${JSON.stringify(raw)}`);
  }
  const value = BigInt(raw);
  if (value > cap) throw new Error(`${flag} ${value} exceeds the ${cap} FJ cap`);
  return value;
}

function hexAddress(flag: string, raw: string | undefined, bytes: number): string {
  const pattern = new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`);
  if (raw === undefined || !pattern.test(raw))
    throw new Error(`${flag} must be a ${bytes}-byte hex address`);
  return raw.toLowerCase();
}

/** Parses and bounds the CLI. No node or network is touched here. */
export function parseFundingArgs(
  argv: string[],
  env: Record<string, string | undefined>,
): FundingArgs {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: {
      salt: { type: "string" },
      "bootstrap-amount": { type: "string" },
      "fpc-amount": { type: "string" },
      "max-total": { type: "string" },
      preflight: { type: "boolean", default: false },
      "l1-key-file": { type: "string" },
      "expect-chain": { type: "string" },
      "expect-portal": { type: "string" },
      "expect-token": { type: "string" },
      "expect-handler": { type: "string" },
      "expect-fpc": { type: "string" },
    },
  });
  const nodeUrl = env.AZTEC_NODE_URL;
  if (!nodeUrl) throw new Error("AZTEC_NODE_URL is required; there is no default network");
  if (!values.salt || !/^0x[0-9a-fA-F]{1,64}$/.test(values.salt)) {
    throw new Error("--salt must be a hex field element (0x0 is the canonical SponsoredFPC)");
  }
  const bootstrapFj = wholeFj("--bootstrap-amount", values["bootstrap-amount"], CAPS_FJ.bootstrap);
  const fpcFj = wholeFj("--fpc-amount", values["fpc-amount"], CAPS_FJ.fpc);
  const maxTotalFj = wholeFj("--max-total", values["max-total"], CAPS_FJ.total);
  if (bootstrapFj + fpcFj > maxTotalFj) {
    throw new Error(`bootstrap ${bootstrapFj} + FPC ${fpcFj} FJ exceeds --max-total ${maxTotalFj}`);
  }
  const base = {
    nodeUrl,
    salt: values.salt,
    bootstrapFj,
    fpcFj,
    maxTotalFj,
    preflight: values.preflight,
  };
  if (values.preflight) return base;

  const chainRaw = values["expect-chain"];
  if (!chainRaw || !/^[1-9][0-9]*$/.test(chainRaw))
    throw new Error("--expect-chain must be a chain id");
  const l1RpcUrl = env.L1_RPC_URL;
  if (!l1RpcUrl) throw new Error("L1_RPC_URL is required for a funding run");
  if (!values["l1-key-file"]) throw new Error("--l1-key-file is required for a funding run");
  return {
    ...base,
    keyed: {
      l1RpcUrl,
      keyFile: values["l1-key-file"],
      expect: {
        chain: Number(chainRaw),
        portal: hexAddress("--expect-portal", values["expect-portal"], 20),
        token: hexAddress("--expect-token", values["expect-token"], 20),
        handler: hexAddress("--expect-handler", values["expect-handler"], 20),
        fpc: hexAddress("--expect-fpc", values["expect-fpc"], 32),
      },
    },
  };
}

/** The node's answer, read once; the portal manager is built from this and nothing else. */
export interface Snapshot {
  nodeVersion: string;
  chainId: number;
  /** For the anchor check: the registry and rollup version the destinations derive from. */
  registry: EthAddress;
  rollupVersion: number;
  portal: EthAddress;
  token: EthAddress;
  handler: EthAddress;
}

export async function readSnapshot(node: { getNodeInfo(): Promise<NodeInfo> }): Promise<Snapshot> {
  const info = await node.getNodeInfo();
  const { feeJuicePortalAddress, feeJuiceAddress, feeAssetHandlerAddress } =
    info.l1ContractAddresses;
  if (feeJuicePortalAddress.isZero() || feeJuiceAddress.isZero()) {
    throw new Error("the node reports no fee juice portal or token");
  }
  if (!feeAssetHandlerAddress || feeAssetHandlerAddress.isZero()) {
    throw new Error("the node reports no fee asset handler, so nothing can be minted");
  }
  return {
    nodeVersion: info.nodeVersion,
    chainId: info.l1ChainId,
    registry: info.l1ContractAddresses.registryAddress,
    rollupVersion: info.rollupVersion,
    portal: feeJuicePortalAddress,
    token: feeJuiceAddress,
    handler: feeAssetHandlerAddress,
  };
}

/** What the run would do, as the approver sees it. */
export interface Manifest {
  nodeVersion: string;
  chain: number;
  registry: string;
  rollupVersion: number;
  portal: string;
  token: string;
  handler: string;
  fpc: string;
  amountsFj: { bootstrap: string; fpc: string; total: string; maxTotal: string };
}

export function manifestOf(snapshot: Snapshot, fpc: AztecAddress, args: FundingArgs): Manifest {
  return {
    nodeVersion: snapshot.nodeVersion,
    chain: snapshot.chainId,
    registry: snapshot.registry.toString().toLowerCase(),
    rollupVersion: snapshot.rollupVersion,
    portal: snapshot.portal.toString().toLowerCase(),
    token: snapshot.token.toString().toLowerCase(),
    handler: snapshot.handler.toString().toLowerCase(),
    fpc: fpc.toString().toLowerCase(),
    amountsFj: {
      bootstrap: String(args.bootstrapFj),
      fpc: String(args.fpcFj),
      total: String(args.bootstrapFj + args.fpcFj),
      maxTotal: String(args.maxTotalFj),
    },
  };
}

/** Refuses unless every destination equals its approved value; names each mismatch. */
export function checkManifest(manifest: Manifest, expect: Expected): void {
  const mismatches = (["chain", "portal", "token", "handler", "fpc"] as const)
    .filter((key) => String(manifest[key]) !== String(expect[key]))
    .map((key) => `${key}: node ${manifest[key]}, approved ${expect[key]}`);
  if (mismatches.length > 0) throw new Error(`refusing to fund: ${mismatches.join("; ")}`);
}

/** The signer's L1 RPC is a second trust input: it must be on the approved chain too. */
export async function checkL1Chain(client: { getChainId(): Promise<number> }, expected: number) {
  const actual = await client.getChainId();
  if (actual !== expected)
    throw new Error(`refusing to fund: L1 RPC is on chain ${actual}, approved ${expected}`);
  const chain = CHAINS.find((c) => c.id === expected);
  if (!chain)
    throw new Error(`refusing to fund: chain ${expected} is not one this script signs for`);
  return chain;
}

/** Reads a hex private key from a file only its owner can read. The key is never logged. */
export function readKeyFile(path: string): `0x${string}` {
  if ((statSync(path).mode & 0o077) !== 0)
    throw new Error(`${path} must not be readable by others (0600)`);
  const key = readFileSync(path, "utf8").trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error(`${path} does not hold a hex private key`);
  return key as `0x${string}`;
}

export function portalManagerFrom(
  snapshot: Snapshot,
  client: ConstructorParameters<typeof L1FeeJuicePortalManager>[3],
  logger: Logger,
): L1FeeJuicePortalManager {
  return new L1FeeJuicePortalManager(
    snapshot.portal,
    snapshot.token,
    snapshot.handler,
    client,
    logger,
  );
}

/**
 * Mints the exact amount through the handler's fixed-size mint, then bridges exactly that amount,
 * never the account's whole balance. Every bridge draws on one budget capped at `--max-total`.
 */
export function fundingBudget(maxTotalFj: bigint) {
  let spentFj = 0n;
  return async function bridgeExact(
    manager: L1FeeJuicePortalManager,
    minter: Hex,
    to: AztecAddress,
    amountFj: bigint,
  ): Promise<L2AmountClaim> {
    if (spentFj + amountFj > maxTotalFj) {
      throw new Error(
        `bridging ${amountFj} FJ would pass --max-total ${maxTotalFj} (spent ${spentFj})`,
      );
    }
    const tokens = manager.getTokenManager();
    const amount = amountFj * WEI_PER_FJ;
    const perMint = await tokens.getMintAmount();
    if (perMint <= 0n || amount % perMint !== 0n) {
      throw new Error(`${amountFj} FJ is not a whole number of ${perMint}-wei handler mints`);
    }
    spentFj += amountFj;
    for (let i = 0n; i < amount / perMint; i++) await tokens.mint(minter);
    return manager.bridgeTokensPublic(to, amount, false);
  };
}

/**
 * Resolves once a block has inserted the claim's L1-to-L2 message, so a transaction can consume it.
 * Waiting for a message, not a block count, also works where blocks are built only on demand.
 */
export async function waitForClaim(node: AztecNode, claim: L2AmountClaim, timeoutSeconds = 900) {
  const { waitForL1ToL2MessageReady } = await import("@aztec-labs/aztec.js/messaging");
  const { Fr } = await import("@aztec-labs/aztec.js/fields");
  await waitForL1ToL2MessageReady(node, Fr.fromHexString(claim.messageHash), { timeoutSeconds });
}

/**
 * An ephemeral Schnorr account whose deployment claims `amountFj` bridged from L1; it pays for the
 * run's L2 transactions. WASM proving: a script has no Presto.
 */
export async function bootstrapAccount(
  node: AztecNode,
  bridge: (to: AztecAddress, amountFj: bigint) => Promise<L2AmountClaim>,
  amountFj: bigint,
) {
  const [{ EmbeddedWallet }, { BBLazyPrivateKernelProver }, { WASMSimulator }, { NO_FROM }] =
    await Promise.all([
      import("@aztec-labs/wallets/embedded"),
      import("@aztec-labs/bb-prover/client/lazy"),
      import("@aztec-labs/simulator/client"),
      import("@aztec-labs/aztec.js/account"),
    ]);
  const { FeeJuicePaymentMethodWithClaim } = await import("@aztec-labs/aztec.js/fee");
  const { Fq, Fr } = await import("@aztec-labs/aztec.js/fields");
  const wallet = await EmbeddedWallet.create(node, {
    ephemeral: true,
    pxe: {
      proverEnabled: true,
      proverOrOptions: new BBLazyPrivateKernelProver(new WASMSimulator()),
    },
  });
  const account = await wallet.createSchnorrAccount(Fr.random(), Fr.random(), Fq.random());
  console.log(`  Bootstrap account ${account.address}: bridging ${amountFj} FJ`);
  const claim = await bridge(account.address, amountFj);
  await waitForClaim(node, claim);
  const { receipt } = await (await account.getDeployMethod()).send({
    from: NO_FROM,
    fee: { paymentMethod: new FeeJuicePaymentMethodWithClaim(account.address, claim) },
  });
  console.log(
    `  Bootstrap account deployed in block ${receipt.blockNumber} (tx ${receipt.txHash})`,
  );
  return { wallet, address: account.address };
}

/** Claims a bridged deposit into the FPC's FeeJuice balance, paid by `from`. */
export async function claimForFpc(
  wallet: Wallet,
  from: AztecAddress,
  fpc: AztecAddress,
  claim: L2AmountClaim,
) {
  const { FeeJuiceContract } = await import("@aztec-labs/aztec.js/protocol");
  const { receipt } = await FeeJuiceContract.withWallet(wallet)
    .methods.claim(fpc, claim.claimAmount, claim.claimSecret, claim.messageLeafIndex)
    .send({ from });
  console.log(`  Claimed for the FPC in block ${receipt.blockNumber} (tx ${receipt.txHash})`);
}

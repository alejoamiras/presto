import { describe, expect, mock, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AztecAddress, EthAddress } from "@aztec-labs/aztec.js/addresses";
import type { L1FeeJuicePortalManager } from "@aztec-labs/aztec.js/ethereum";
import type { NodeInfo } from "@aztec-labs/aztec.js/node";
import { createLogger } from "@aztec-labs/foundation/log";
import { createWalletClient, http, publicActions } from "viem";
import { sepolia } from "viem/chains";
import {
  checkL1Chain,
  checkManifest,
  fundingBudget,
  manifestOf,
  parseFundingArgs,
  portalManagerFrom,
  readKeyFile,
  readSnapshot,
} from "./fpc-funding";

const eth = (byte: string) => EthAddress.fromString(`0x${byte.repeat(20)}`);
const FPC = AztecAddress.fromBigIntUnsafe(15n);
const ENV = { AZTEC_NODE_URL: "http://127.0.0.1:1", L1_RPC_URL: "http://127.0.0.1:2" };
const approved = {
  chain: 11155111,
  portal: eth("aa").toString(),
  token: eth("bb").toString(),
  handler: eth("cc").toString(),
  fpc: FPC.toString(),
};
const argv = (overrides: Record<string, string> = {}) =>
  Object.entries({
    "--salt": "0x0",
    "--bootstrap-amount": "1000",
    "--fpc-amount": "1000",
    "--max-total": "2000",
    "--l1-key-file": "/nonexistent",
    "--expect-chain": String(approved.chain),
    "--expect-portal": approved.portal,
    "--expect-token": approved.token,
    "--expect-handler": approved.handler,
    "--expect-fpc": approved.fpc,
    ...overrides,
  }).map(([flag, value]) => `${flag}=${value}`);
const nodeInfo = (chain: number, portal: string) =>
  ({
    nodeVersion: "6.0.0-rc.1",
    l1ChainId: chain,
    rollupVersion: 7,
    l1ContractAddresses: {
      registryAddress: eth("99"),
      feeJuicePortalAddress: eth(portal),
      feeJuiceAddress: eth("bb"),
      feeAssetHandlerAddress: eth("cc"),
    },
  }) as unknown as NodeInfo;

describe("parseFundingArgs", () => {
  test("requires the node URL: there is no default network", () => {
    expect(() => parseFundingArgs(argv(), { L1_RPC_URL: ENV.L1_RPC_URL })).toThrow(
      "AZTEC_NODE_URL",
    );
  });

  test("refuses malformed amounts", () => {
    for (const bad of ["", "0", "-1", "1.5", "1e3", "0x10", " 1", "abc", "01"]) {
      expect(() => parseFundingArgs(argv({ "--fpc-amount": bad }), ENV)).toThrow(
        "positive whole number",
      );
    }
  });

  test("refuses a cap breach per amount and in total", () => {
    expect(() => parseFundingArgs(argv({ "--bootstrap-amount": "1001" }), ENV)).toThrow(
      "1000 FJ cap",
    );
    expect(() => parseFundingArgs(argv({ "--max-total": "2001" }), ENV)).toThrow("2000 FJ cap");
    expect(() => parseFundingArgs(argv({ "--max-total": "1500" }), ENV)).toThrow(
      "--max-total 1500",
    );
  });

  test("a funding run needs every approved value; a preflight needs none", () => {
    expect(() => parseFundingArgs(argv({ "--expect-fpc": approved.portal }), ENV)).toThrow(
      "--expect-fpc",
    );
    const preflight = parseFundingArgs(
      [
        "--preflight",
        "--salt",
        "0x0",
        "--bootstrap-amount",
        "1",
        "--fpc-amount",
        "2",
        "--max-total",
        "3",
      ],
      { AZTEC_NODE_URL: ENV.AZTEC_NODE_URL },
    );
    expect(preflight.keyed).toBeUndefined();
    expect(parseFundingArgs(argv(), ENV).keyed?.expect).toEqual({
      ...approved,
      portal: approved.portal.toLowerCase(),
    });
  });
});

describe("the pre-signing checks", () => {
  const args = parseFundingArgs(argv(), ENV);

  test("refuse a wrong destination and a node on another chain, naming each", async () => {
    const lying = await readSnapshot({ getNodeInfo: async () => nodeInfo(1, "dd") });
    expect(() => checkManifest(manifestOf(lying, FPC, args), approved)).toThrow(
      /chain: node 1, approved 11155111; portal: node 0xdd/,
    );
    const honest = await readSnapshot({ getNodeInfo: async () => nodeInfo(11155111, "aa") });
    expect(() => checkManifest(manifestOf(honest, FPC, args), approved)).not.toThrow();
  });

  test("refuse an L1 RPC on another chain", async () => {
    await expect(checkL1Chain({ getChainId: async () => 1 }, 11155111)).rejects.toThrow("chain 1");
    expect((await checkL1Chain({ getChainId: async () => 11155111 }, 11155111)).id).toBe(11155111);
  });

  test("build the manager from the one snapshot, even when the node changes its answer", async () => {
    const answers = [nodeInfo(11155111, "aa"), nodeInfo(11155111, "dd")];
    const getNodeInfo = mock(async () => answers.shift()!);
    const snapshot = await readSnapshot({ getNodeInfo });
    checkManifest(manifestOf(snapshot, FPC, args), approved);
    // An address-only (JSON-RPC) account: the manager needs a signer's address, never a key.
    const client = createWalletClient({
      account: eth("ee").toString() as `0x${string}`,
      chain: sepolia,
      transport: http("http://127.0.0.1:1"),
    }).extend(publicActions);
    const manager = portalManagerFrom(
      snapshot,
      client as unknown as Parameters<typeof portalManagerFrom>[1],
      createLogger("fpc-funding-test"),
    );
    expect(getNodeInfo).toHaveBeenCalledTimes(1);
    expect((manager as unknown as { contract: { address: string } }).contract.address).toBe(
      eth("aa").toString(),
    );
  });

  test("refuse a key file others can read, a symlink, or a file without a key", () => {
    const dir = mkdtempSync(join(tmpdir(), "fpc-key-"));
    try {
      const file = join(dir, "key");
      writeFileSync(file, "not a key\n", { mode: 0o644 });
      chmodSync(file, 0o644);
      expect(() => readKeyFile(file)).toThrow("0600");
      chmodSync(file, 0o600);
      expect(() => readKeyFile(file)).toThrow("hex private key");
      symlinkSync(file, join(dir, "link"));
      expect(() => readKeyFile(join(dir, "link"))).toThrow("ELOOP");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("fundingBudget", () => {
  const WEI = 10n ** 18n;
  const fakeManager = (mintAmount = 1_000n * WEI) => {
    const mint = mock(async () => {});
    const bridgeTokensPublic = mock(async () => ({}));
    const manager = {
      getTokenManager: () => ({ getMintAmount: async () => mintAmount, mint }),
      bridgeTokensPublic,
    } as unknown as L1FeeJuicePortalManager;
    return { manager, mint, bridgeTokensPublic };
  };

  test("mints and bridges exactly the amount, and stops at the total", async () => {
    const { manager, mint, bridgeTokensPublic } = fakeManager();
    const bridge = await fundingBudget(manager, "0x01", 2_000n, [2_000n]);
    await bridge(FPC, 2_000n);
    expect(mint).toHaveBeenCalledTimes(2);
    expect(bridgeTokensPublic).toHaveBeenCalledWith(FPC, 2_000n * WEI, false);
    await expect(bridge(FPC, 1_000n)).rejects.toThrow("--max-total 2000");
    expect(mint).toHaveBeenCalledTimes(2);
  });

  test("refuses, before any mint, a plan the handler cannot mint exactly or only in too many mints", async () => {
    const { manager, mint } = fakeManager();
    await expect(fundingBudget(manager, "0x01", 2_000n, [1_000n, 1_500n])).rejects.toThrow(
      "handler mints",
    );
    const tiny = fakeManager(1n);
    await expect(fundingBudget(tiny.manager, "0x01", 2_000n, [1n])).rejects.toThrow("cap is 20");
    expect(mint).not.toHaveBeenCalled();
    expect(tiny.mint).not.toHaveBeenCalled();
  });
});

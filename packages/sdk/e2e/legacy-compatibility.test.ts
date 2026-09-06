import { expect, test } from "bun:test";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee";
import { Fr } from "@aztec/aztec.js/fields";
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC";
import { WASMSimulator } from "@aztec/simulator/client";
import { getContractInstanceFromInstantiationParams } from "@aztec/stdlib/contract";
import { EmbeddedWallet } from "@aztec/wallets/embedded";
import legacy from "../../../audit/fixtures/legacy-identity.json";
import type { PrestoProver } from "../src/index";
import { deploySchnorrAccount } from "./e2e-helpers";
import { config } from "./e2e-setup";

// CI installs the immutable published tarball, never the legacy workspace or a rewritten alias.
test.skipIf(!process.env.LEGACY_SDK_ENTRY)(
  "published legacy SDK completes a native proof against Presto without WASM fallback",
  async () => {
    if (!config.prestoUrl) throw new Error("This compatibility gate requires the Presto server");
    const sdk = await import(process.env.LEGACY_SDK_ENTRY!);
    const Constructor: typeof PrestoProver = sdk[legacy.proverExport];
    expect(typeof Constructor).toBe("function");
    const endpoint = new URL(config.prestoUrl);
    const phases: string[] = [];
    const prover = new Constructor({
      simulator: new WASMSimulator(),
      onPhase: (phase) => phases.push(phase),
      [legacy.configOption]: {
        host: endpoint.hostname,
        port: Number(endpoint.port),
        httpsOnly: false,
      },
    });
    const check = Reflect.get(prover, legacy.statusMethod);
    expect(typeof check).toBe("function");
    expect((await check.call(prover)).available).toBe(true);
    const node = createAztecNodeClient(config.nodeUrl);
    const wallet = await EmbeddedWallet.create(node, {
      ephemeral: true,
      pxe: { proverEnabled: true, proverOrOptions: prover },
    });
    const fpc = await getContractInstanceFromInstantiationParams(SponsoredFPCContract.artifact, {
      salt: new Fr(0),
    });
    await wallet.registerContract(fpc, SponsoredFPCContract.artifact);
    const deployed = await deploySchnorrAccount(
      wallet,
      new SponsoredFeePaymentMethod(fpc.address),
      "published legacy SDK → Presto",
    );
    expect(deployed).toBeDefined();
    expect(phases).toContain("transmit");
    expect(phases).not.toContain("fallback");
  },
  { timeout: 600_000 },
);

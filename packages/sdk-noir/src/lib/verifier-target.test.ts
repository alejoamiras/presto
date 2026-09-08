import { describe, expect, test } from "bun:test";
import { resolveVerifierTarget, VERIFIER_TARGETS } from "./verifier-target.js";

describe("resolveVerifierTarget (bb.js's getProofSettingsFromOptions, as a target)", () => {
  test("an explicit target wins and every bb target is accepted", () => {
    for (const target of VERIFIER_TARGETS) {
      expect(resolveVerifierTarget({ verifierTarget: target })).toBe(target);
    }
    expect(VERIFIER_TARGETS).toHaveLength(8);
  });

  test.each([
    ["no options", undefined, "noir-recursive"],
    ["empty options", {}, "noir-recursive"],
    ["keccak", { keccak: true }, "evm-no-zk"],
    ["keccakZK", { keccakZK: true }, "evm"],
    ["starknet", { starknet: true }, "starknet-no-zk"],
    ["starknetZK", { starknetZK: true }, "starknet"],
    // bb.js precedence: keccak flags choose the hash before starknet flags; `keccak`/`starknet`
    // (not their ZK spellings) disable ZK.
    ["keccakZK + starknet", { keccakZK: true, starknet: true }, "evm-no-zk"],
    ["keccak + starknetZK", { keccak: true, starknetZK: true }, "evm-no-zk"],
    ["starknetZK + starknet", { starknetZK: true, starknet: true }, "starknet-no-zk"],
    ["false flags", { keccak: false, starknetZK: false }, "noir-recursive"],
  ] as const)("deprecated flags: %s", (_name, options, expected) => {
    expect(resolveVerifierTarget(options)).toBe(expected);
  });

  test("a target combined with a deprecated flag is the same error bb.js raises", () => {
    expect(() => resolveVerifierTarget({ verifierTarget: "evm", keccak: true })).toThrow(
      "Cannot use verifierTarget with legacy options",
    );
    expect(() => resolveVerifierTarget({ verifierTarget: "evm", keccak: false })).not.toThrow();
    expect(() => resolveVerifierTarget({ verifierTarget: "evm-zk" as unknown as "evm" })).toThrow(
      "Unknown verifierTarget",
    );
  });
});

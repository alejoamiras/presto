import type { UltraHonkBackendOptions, VerifierTarget } from "@aztec/bb.js";

/** bb's `-t` values, which are also the wire `verifier_target` and bb.js's `verifierTarget`. */
export const VERIFIER_TARGETS: readonly VerifierTarget[] = [
  "evm",
  "evm-no-zk",
  "noir-recursive",
  "noir-recursive-no-zk",
  "noir-rollup",
  "noir-rollup-no-zk",
  "starknet",
  "starknet-no-zk",
];

/**
 * The target bb.js's `UltraHonkBackend` would prove for `options` — the same resolution its
 * `getProofSettingsFromOptions` applies, so native and WASM proofs of one call agree: an explicit
 * `verifierTarget` (which may not be combined with the deprecated flags), else the deprecated flags
 * with keccak taking precedence over starknet and the ZK variants of each keeping ZK, else the
 * poseidon2 + ZK default (`noir-recursive`).
 */
export function resolveVerifierTarget(options?: UltraHonkBackendOptions): VerifierTarget {
  if (options?.verifierTarget) {
    if (options.keccak || options.keccakZK || options.starknet || options.starknetZK) {
      throw new Error(
        "Cannot use verifierTarget with legacy options (keccak, keccakZK, starknet, starknetZK). " +
          "Use verifierTarget alone.",
      );
    }
    if (!VERIFIER_TARGETS.includes(options.verifierTarget)) {
      throw new Error(`Unknown verifierTarget ${JSON.stringify(options.verifierTarget)}`);
    }
    return options.verifierTarget;
  }
  const keccak = Boolean(options?.keccak || options?.keccakZK);
  const starknet = Boolean(options?.starknet || options?.starknetZK);
  const noZk = Boolean(options?.keccak || options?.starknet);
  if (keccak) return noZk ? "evm-no-zk" : "evm";
  if (starknet) return noZk ? "starknet-no-zk" : "starknet";
  return "noir-recursive";
}

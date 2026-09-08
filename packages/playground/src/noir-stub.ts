import type { Barretenberg } from "@aztec/bb.js";
import type { NoirFixture } from "./noir";

/**
 * A `Barretenberg` stand-in that answers bb.js's `UltraHonkBackend` with the fixture's reference
 * bytes instead of running WASM. For tests and the mocked e2e only: it makes the in-browser path
 * deterministic and network-free (no CRS, no workers), while bb.js's real `UltraHonkBackend`
 * still parses the artifact and the witness in front of it.
 */
export function stubBarretenberg(fixture: NoirFixture): Barretenberg {
  const fields = (bytes: Uint8Array) => {
    const out: Uint8Array[] = [];
    for (let i = 0; i < bytes.length; i += 32) out.push(bytes.subarray(i, i + 32));
    return out;
  };
  const stub = {
    circuitProve: async () => ({
      proof: fields(fixture.proof),
      publicInputs: fields(fixture.publicInputs),
    }),
    circuitComputeVk: async () => ({ bytes: fixture.vk }),
    circuitVerify: async () => ({ verified: true }),
    destroy: async () => {},
  };
  return stub as unknown as Barretenberg;
}

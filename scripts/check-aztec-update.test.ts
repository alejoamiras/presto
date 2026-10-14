import { describe, expect, test } from "bun:test";
import { checkAztecUpdate } from "./check-aztec-update.ts";
import type { AztecRegistry } from "./update-aztec-version.ts";

const SDK = {
  dependencies: {
    "@aztec-foundation/bb.js": "6.0.0-rc.1",
    "@aztec-foundation/noir-acvm_js": "6.0.0-rc.1",
    "@aztec-labs/bb-prover": "6.0.0-rc.1",
    "@aztec-labs/stdlib": "6.0.0-rc.1",
  },
  devDependencies: { "@aztec-labs/aztec.js": "6.0.0-rc.1" },
};

/** A registry holding exactly `published` (spec → direct dependencies). */
function registry(published: Record<string, Record<string, string>>): AztecRegistry {
  return {
    distTags: async () => ({ prerelease: "6.0.0-rc.3" }),
    dependencies: async (spec) => published[spec],
  };
}

const RC3 = {
  "@aztec-labs/aztec.js@6.0.0-rc.3": { "@aztec-foundation/l1-artifacts": "6.0.0-rc.6" },
  "@aztec-labs/bb-prover@6.0.0-rc.3": { "@aztec-foundation/bb.js": "6.0.0-rc.6" },
  "@aztec-labs/stdlib@6.0.0-rc.3": { "@aztec-foundation/noir-acvm_js": "6.0.0-rc.6" },
  "@aztec-foundation/bb.js@6.0.0-rc.6": {},
  "@aztec-foundation/noir-acvm_js@6.0.0-rc.6": {},
};

describe("checkAztecUpdate", () => {
  test("looks each name up at its own target, so a foundation name is not missing at the labs version", async () => {
    expect(await checkAztecUpdate(SDK, "prerelease", registry(RC3))).toEqual({
      current: "6.0.0-rc.1",
      latest: "6.0.0-rc.3",
      needsUpdate: true,
      foundation: "6.0.0-rc.6",
    });
    const { "@aztec-foundation/noir-acvm_js@6.0.0-rc.6": _, ...withoutAcvm } = RC3;
    expect(await checkAztecUpdate(SDK, "prerelease", registry(withoutAcvm))).toMatchObject({
      missing: ["@aztec-foundation/noir-acvm_js"],
    });
  });
});

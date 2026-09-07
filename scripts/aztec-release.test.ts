import { describe, expect, test } from "bun:test";
import { assertAztecReleaseEligible, managedAztecPackages } from "./aztec-release";

const NOW = new Date("2026-09-07T12:00:00.000Z");
const ELIGIBLE = "2026-08-31T12:00:00.000Z";

function registryResponse(name: string, version: string, publishedAt = ELIGIBLE): Response {
  return Response.json({
    name,
    versions: { [version]: {} },
    time: { [version]: publishedAt },
  });
}

describe("Aztec release eligibility", () => {
  test("discovers Aztec packages and exact lockstep companions", () => {
    expect(
      managedAztecPackages([
        JSON.stringify({
          dependencies: {
            "@aztec/aztec.js": "5.2.0",
            "@aztec-foundation/aztec-standards": "5.2.0",
            "@aztec-foundation/unrelated": "1.0.0",
          },
        }),
      ]),
    ).toEqual(["@aztec-foundation/aztec-standards", "@aztec/aztec.js"]);
  });

  test("accepts only a complete, seven-day-old companion set", async () => {
    const packages = ["@aztec/aztec.js", "@aztec-foundation/aztec-standards"];
    await assertAztecReleaseEligible("5.2.0", packages, NOW, async (input) => {
      const name = decodeURIComponent(String(input).split("/").at(-1) ?? "");
      return registryResponse(name, "5.2.0");
    });
  });

  test("rejects forced updates when a companion is missing or too young", async () => {
    const packages = ["@aztec/aztec.js", "@aztec-foundation/aztec-standards"];
    await expect(
      assertAztecReleaseEligible("5.3.0", packages, NOW, async (input) => {
        const name = decodeURIComponent(String(input).split("/").at(-1) ?? "");
        if (name === "@aztec-foundation/aztec-standards") {
          return registryResponse(name, "5.2.0");
        }
        return registryResponse(name, "5.3.0", "2026-09-01T00:00:00.000Z");
      }),
    ).rejects.toThrow("incomplete or ineligible");
  });
});

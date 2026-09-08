import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { NPM_PACKAGES } from "./npm-packages.ts";
import { verifyProvenanceStatement } from "./sdk-release-verification.ts";
import {
  hasVerifiedSdkProvenance,
  verifiedProvenanceStatement,
} from "./verify-sdk-package-signatures.ts";

/** `npm audit signatures --json --include-attestations` for the published presto-core 1.0.0. */
const realReport = () =>
  Bun.file(
    resolve(import.meta.dir, "__fixtures__/npm-audit-signatures-presto-core-1.0.0.json"),
  ).json();
const core = NPM_PACKAGES["presto-core"];

describe("SDK signature verification", () => {
  test("requires verified SLSA provenance for the exact package and version", () => {
    const report = {
      verified: [
        {
          name: "@alejoamiras/presto",
          version: "5.2.0",
          attestations: { provenance: { predicateType: "https://slsa.dev/provenance/v1" } },
        },
      ],
    };
    expect(hasVerifiedSdkProvenance(report, "5.2.0")).toBe(true);
    expect(hasVerifiedSdkProvenance(report, "5.2.1")).toBe(false);
    const sibling = { ...NPM_PACKAGES.presto, name: "@alejoamiras/presto-core" };
    expect(hasVerifiedSdkProvenance(report, "5.2.0", sibling)).toBe(false);
  });

  test("the signed statement comes from the verified provenance bundle npm reported", async () => {
    const report = await realReport();
    const statement = verifiedProvenanceStatement(report, "1.0.0", core);
    const verified = verifyProvenanceStatement(
      statement,
      "1.0.0",
      undefined,
      undefined,
      undefined,
      core,
    );
    expect(verified.commit).toBe("f331a7877a36d4704436023dce204ee92786a319");
    expect(verified.workflow).toBe(".github/workflows/release-sdk.yml");
    // sha512 hex from the statement, in npm's base64 integrity form.
    expect(verified.integrity).toBe(
      `sha512-${Buffer.from("d07b1b33e5729d4c4a460ae2a058a3669e0e5923629a954d30217174730069a0d194b126ce0f09993e3e17c4be68d9696224b5df01e20362fe84637c998bc29e", "hex").toString("base64")}`,
    );
    expect(() => verifiedProvenanceStatement(report, "1.0.1", core)).toThrow(
      "did not cryptographically verify provenance",
    );
    expect(() => verifiedProvenanceStatement(report, "1.0.0", NPM_PACKAGES.presto)).toThrow(
      "did not cryptographically verify provenance",
    );
  });

  test("a verified entry without its provenance bundle, or with only the publish bundle, is refused", async () => {
    const { verified } = await realReport();
    const [entry] = verified;
    const publishOnly = {
      ...entry,
      attestationBundles: entry.attestationBundles.filter(
        (b: { predicateType: string }) => b.predicateType !== "https://slsa.dev/provenance/v1",
      ),
    };
    expect(publishOnly.attestationBundles).toHaveLength(1);
    expect(() => verifiedProvenanceStatement({ verified: [publishOnly] }, "1.0.0", core)).toThrow(
      "no verified provenance bundle",
    );
    const { attestationBundles: _, ...bare } = entry;
    expect(() => verifiedProvenanceStatement({ verified: [bare] }, "1.0.0", core)).toThrow(
      "no verified provenance bundle",
    );
  });
});

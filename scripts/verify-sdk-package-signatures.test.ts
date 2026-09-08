import { describe, expect, test } from "bun:test";
import { NPM_PACKAGES } from "./npm-packages.ts";
import { auditedIntegrity, hasVerifiedSdkProvenance } from "./verify-sdk-package-signatures.ts";

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

  test("the audited integrity is the lockfile's SHA-512 record of the exact version", () => {
    const integrity = `sha512-${"A".repeat(86)}==`;
    const lock = {
      packages: {
        "": { version: "0.0.0" },
        "node_modules/@alejoamiras/presto": { version: "5.2.0", integrity },
        "node_modules/@alejoamiras/presto-core": { version: "1.0.0", integrity: "sha1-abc" },
      },
    };
    expect(auditedIntegrity(lock, "5.2.0", NPM_PACKAGES.presto)).toBe(integrity);
    expect(() => auditedIntegrity(lock, "5.2.1", NPM_PACKAGES.presto)).toThrow("expected 5.2.1");
    expect(() => auditedIntegrity(lock, "1.0.0", NPM_PACKAGES["presto-core"])).toThrow(
      "no SHA-512 integrity",
    );
    expect(() => auditedIntegrity({}, "5.2.0", NPM_PACKAGES.presto)).toThrow("(none)");
  });
});

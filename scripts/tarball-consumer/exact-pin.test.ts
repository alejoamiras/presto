import { describe, expect, test } from "bun:test";
import { NPM_PACKAGES } from "../npm-packages.ts";
import { exactAztecPin } from "./exact-pin.ts";

const aztecDerived = NPM_PACKAGES.presto;
const manifestMode = { ...aztecDerived, versionMode: "manifest" as const };

describe("exact Aztec stdlib pin", () => {
  test("an exact pin is returned verbatim under either scope, including prerelease and build identifiers", () => {
    for (const version of ["5.2.0", "5.0.0-nightly.20260309", "5.2.0-rc.1+build.7"]) {
      expect(exactAztecPin({ dependencies: { "@aztec/stdlib": version } }, aztecDerived)).toEqual({
        name: "@aztec/stdlib",
        version,
      });
    }
    expect(
      exactAztecPin({ dependencies: { "@aztec-labs/stdlib": "6.0.0-rc.1" } }, aztecDerived),
    ).toEqual({ name: "@aztec-labs/stdlib", version: "6.0.0-rc.1" });
  });

  test("a range or malformed spec fails closed", () => {
    for (const pin of [
      "^5.2.0",
      "~5.2.0",
      "5.2",
      "5.2.0-alpha..x",
      "npm:@aztec/stdlib@5.2.0",
      "",
    ]) {
      expect(() => exactAztecPin({ dependencies: { "@aztec/stdlib": pin } }, aztecDerived)).toThrow(
        "not an exact semver",
      );
    }
  });

  test("a missing dependency fails for aztec-derived packages and is absent for manifest packages", () => {
    expect(() => exactAztecPin({ dependencies: {} }, aztecDerived)).toThrow(
      "no Aztec stdlib dependency",
    );
    expect(() => exactAztecPin({}, aztecDerived)).toThrow("no Aztec stdlib dependency");
    expect(exactAztecPin({ dependencies: {} }, manifestMode)).toBeUndefined();
  });

  test("a manifest caught between scopes fails for every package", () => {
    const both = { dependencies: { "@aztec/stdlib": "5.2.0", "@aztec-labs/stdlib": "6.0.0-rc.1" } };
    expect(() => exactAztecPin(both, aztecDerived)).toThrow("ambiguous");
    expect(() => exactAztecPin(both, manifestMode)).toThrow("ambiguous");
  });
});

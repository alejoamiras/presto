import { expect, test } from "bun:test";
import { assertPublishedSdkManifest } from "./published-playground";

test("playground requires the exact published SDK identity and matching Aztec dependency graph", () => {
  const dependencies = { "@aztec/stdlib": "5.2.0", "@aztec/bb-prover": "5.2.0", ms: "^2.1.3" };
  const manifest = { name: "@alejoamiras/presto", version: "5.2.0", dependencies };
  expect(() => assertPublishedSdkManifest(manifest, "5.2.0", dependencies)).not.toThrow();
  expect(() =>
    assertPublishedSdkManifest({ ...manifest, version: "0.0.0" }, "5.2.0", dependencies),
  ).toThrow();
  expect(() =>
    assertPublishedSdkManifest({ ...manifest, name: "@example/other" }, "5.2.0", dependencies),
  ).toThrow();
  expect(() =>
    assertPublishedSdkManifest(manifest, "5.2.0", { ...dependencies, "@aztec/stdlib": "5.1.0" }),
  ).toThrow();
  expect(() =>
    assertPublishedSdkManifest(manifest, "5.2.0", { ...dependencies, ms: "^3.0.0" }),
  ).toThrow();
});

import { expect, test } from "bun:test";
import { assertPublishedSdkManifest, sharedCorePin } from "./published-playground";

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

test("a workspace range resolves to the sibling's version, which the published pin must equal", () => {
  const core = "@alejoamiras/presto-core";
  const workspace = { "@aztec/stdlib": "5.2.0", [core]: "workspace:*" };
  const published = {
    name: "@alejoamiras/presto",
    version: "5.2.0",
    dependencies: { "@aztec/stdlib": "5.2.0", [core]: "1.0.0" },
  };
  expect(() =>
    assertPublishedSdkManifest(published, "5.2.0", workspace, { [core]: "1.0.0" }),
  ).not.toThrow();
  // The workspace core moved ahead of what the published SDK pins: not the playground graph.
  expect(() =>
    assertPublishedSdkManifest(published, "5.2.0", workspace, { [core]: "1.1.0" }),
  ).toThrow("@alejoamiras/presto-core@1.0.0 does not match");
  // No sibling version supplied: a workspace range can never be satisfied by a published pin.
  expect(() => assertPublishedSdkManifest(published, "5.2.0", workspace)).toThrow();
});

test("every adapter the playground runs must pin the one core it installs", () => {
  const core = "@alejoamiras/presto-core";
  const at = (name: string, pin: string) => ({
    name,
    version: "1.0.0",
    dependencies: { [core]: pin },
  });
  expect(sharedCorePin([at("@alejoamiras/presto", "1.0.0")])).toBe("1.0.0");
  expect(
    sharedCorePin([at("@alejoamiras/presto", "1.0.0"), at("@alejoamiras/presto-noir", "1.0.0")]),
  ).toBe("1.0.0");
  expect(() =>
    sharedCorePin([at("@alejoamiras/presto", "1.0.0"), at("@alejoamiras/presto-noir", "1.1.0")]),
  ).toThrow("pin different");
  expect(() => sharedCorePin([{ name: "x", version: "1.0.0", dependencies: {} }])).toThrow();
});

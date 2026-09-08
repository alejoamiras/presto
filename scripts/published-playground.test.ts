import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import {
  assertPeerPin,
  assertPublishedSdkManifest,
  assertVerifiedTarball,
  packageRoot,
  sharedCorePin,
  tarballIntegrity,
} from "./published-playground";

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

test("a published adapter's peer pin must be the peer the playground installs", () => {
  const noir = { name: "@alejoamiras/presto-noir", peerDependencies: { "@aztec/bb.js": "5.2.0" } };
  expect(() => assertPeerPin(noir, "@aztec/bb.js", "5.2.0")).not.toThrow();
  expect(() => assertPeerPin(noir, "@aztec/bb.js", "5.3.0")).toThrow(
    "pins peer @aztec/bb.js@5.2.0",
  );
  expect(() => assertPeerPin({ name: "x" }, "@aztec/bb.js", "5.2.0")).toThrow("(none)");
});

test("packageRoot finds the copy the playground resolves, not a nested one", async () => {
  const playground = resolve(import.meta.dir, "../packages/playground");
  const dir = packageRoot("@aztec/bb.js", playground);
  expect(dir.endsWith("/node_modules/@aztec/bb.js")).toBe(true);
  expect((await Bun.file(`${dir}/package.json`).json()).name).toBe("@aztec/bb.js");
  expect(() => packageRoot("@alejoamiras/no-such-package", playground)).toThrow();
});

test("the deployed tarball must hash to the digest the signed provenance names", () => {
  const bytes = new TextEncoder().encode("tarball bytes");
  const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  expect(tarballIntegrity(bytes)).toBe(integrity);
  const spec = "@alejoamiras/presto@5.2.0";
  expect(() => assertVerifiedTarball(bytes, integrity, spec)).not.toThrow();
  const other = tarballIntegrity(new TextEncoder().encode("other bytes"));
  expect(() => assertVerifiedTarball(bytes, other, spec)).toThrow(
    "does not match its signed provenance digest",
  );
});

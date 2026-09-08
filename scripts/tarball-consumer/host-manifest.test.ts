import { describe, expect, test } from "bun:test";
import { hostManifest } from "./host-manifest.ts";

describe("consumer host manifest", () => {
  test("the tarball under test is the last word on its own package", () => {
    const manifest = hostManifest(
      "@alejoamiras/presto",
      "/tmp/presto.tgz",
      { "@aztec/bb.js": "5.2.0" },
      "5.2.0",
    );
    expect(manifest.dependencies).toEqual({
      "@aztec/bb.js": "5.2.0",
      "@aztec/stdlib": "5.2.0",
      "@alejoamiras/presto": "file:/tmp/presto.tgz",
    });
    expect(manifest.name).toBe("host-5.2.0");
    expect(hostManifest("@alejoamiras/presto", "/tmp/p.tgz").name).toBe("host-default");
  });

  test("a profile extra naming the tested package is rejected", () => {
    expect(() =>
      hostManifest("@alejoamiras/presto", "/tmp/p.tgz", { "@alejoamiras/presto": "testnet" }),
    ).toThrow("must not name the package under test");
  });
});

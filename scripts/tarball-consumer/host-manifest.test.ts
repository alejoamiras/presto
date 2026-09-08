import { describe, expect, test } from "bun:test";
import { hostManifest, parseLocalTarballs } from "./host-manifest.ts";

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

  test("local workspace tarballs install as file: dependencies beside the candidate", () => {
    const manifest = hostManifest("@alejoamiras/presto", "/tmp/p.tgz", {}, undefined, {
      "@alejoamiras/presto-core": "/tmp/core.tgz",
    });
    expect(manifest.dependencies).toEqual({
      "@alejoamiras/presto-core": "file:/tmp/core.tgz",
      "@alejoamiras/presto": "file:/tmp/p.tgz",
    });
    expect(parseLocalTarballs(["@alejoamiras/presto-core=/tmp/core.tgz"])).toEqual({
      "@alejoamiras/presto-core": "/tmp/core.tgz",
    });
    expect(() => parseLocalTarballs(["nope"])).toThrow("expected name=tarball");
    expect(() => parseLocalTarballs(["name="])).toThrow("expected name=tarball");
  });

  test("an extra or local tarball naming the tested package is rejected", () => {
    expect(() =>
      hostManifest("@alejoamiras/presto", "/tmp/p.tgz", { "@alejoamiras/presto": "testnet" }),
    ).toThrow("must not name the package under test");
    expect(() =>
      hostManifest("@alejoamiras/presto", "/tmp/p.tgz", {}, undefined, {
        "@alejoamiras/presto": "/tmp/other.tgz",
      }),
    ).toThrow("must not name the package under test");
  });
});

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as core from "../index.js";

// Doc-sync guard: the barrel, the README, and the manifest describe one package.
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("public contract", () => {
  test("barrel exports the scheme identifiers", () => {
    expect(core.PRESTO_SCHEME_CHONK).toBe("chonk");
    expect(core.PRESTO_SCHEME_ULTRA_HONK).toBe("ultra_honk");
  });

  test("README names the package and the scheme identifiers it exports", () => {
    const readme = read("../../README.md");
    expect(readme).toContain("@alejoamiras/presto-core");
    expect(readme).toContain("PRESTO_SCHEME_ULTRA_HONK");
  });

  test("the manifest is a plain-semver, publishable package with no @aztec dependency", () => {
    const pkg = JSON.parse(read("../../package.json"));
    expect(pkg.name).toBe("@alejoamiras/presto-core");
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/);
    expect(pkg.publishConfig).toEqual({ access: "public" });
    expect(pkg.files).toEqual(["src", "dist"]);
    for (const name of Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies })) {
      expect(name.startsWith("@aztec/")).toBe(false);
    }
  });
});

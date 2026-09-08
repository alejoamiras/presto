import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PrestoUltraHonkBackendOptions, VerifierTarget } from "../index.js";
import * as noir from "../index.js";

// Doc-sync guard: the barrel, the README, and the manifest describe one package.
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("public contract", () => {
  test("barrel exports the runtime + type surface", () => {
    expect(typeof noir.PrestoUltraHonkBackend).toBe("function");
    expect(typeof noir.PrestoUnavailableError).toBe("function");
    expect(typeof noir.PrestoHttpError).toBe("function");
    expect(typeof noir.resolveVerifierTarget).toBe("function");
    expect(noir.TESTED_BB_VERSION).toBe("5.2.0");
    expect(noir.TESTED_BB_VERSIONS).toEqual(["5.2.0"]);
    expect(noir.VERIFIER_TARGETS).toContain("noir-recursive-no-zk");
    const target: VerifierTarget = "evm";
    const options: PrestoUltraHonkBackendOptions = { fallback: "none" };
    expect([target, options.fallback]).toEqual(["evm", "none"]);
  });

  test("README documents the drop-in, the fallback modes, and the tested bb.js version", () => {
    const readme = read("../../README.md");
    for (const needle of [
      "@alejoamiras/presto-noir",
      "PrestoUltraHonkBackend",
      'fallback: "none"',
      "PrestoUnavailableError",
      "TESTED_BB_VERSION",
      "@aztec/bb.js@5.2.0",
      "verifyProof",
    ]) {
      expect(readme).toContain(needle);
    }
  });

  test("the manifest pins the bb.js peer to the tested version and depends on core", () => {
    const pkg = JSON.parse(read("../../package.json"));
    expect(pkg.name).toBe("@alejoamiras/presto-noir");
    expect(pkg.peerDependencies).toEqual({ "@aztec/bb.js": noir.TESTED_BB_VERSION });
    expect(pkg.devDependencies["@aztec/bb.js"]).toBe(noir.TESTED_BB_VERSION);
    expect(pkg.dependencies["@alejoamiras/presto-core"]).toBe("workspace:*");
    expect(Object.keys(pkg.dependencies).some((name) => name.startsWith("@aztec/"))).toBe(false);
    expect(pkg.publishConfig).toEqual({ access: "public" });
    expect(pkg.files).toEqual(["src", "dist"]);
  });
});

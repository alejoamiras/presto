import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type {
  LoopbackPermissionState,
  PrestoUltraHonkBackendOptions,
  VerifierTarget,
} from "../index.js";
import * as noir from "../index.js";

// Doc-sync guard: the barrel, the README, and the manifest describe one package.
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("public contract", () => {
  test("barrel exports the runtime + type surface", () => {
    expect(typeof noir.PrestoUltraHonkBackend).toBe("function");
    expect(typeof noir.PrestoUnavailableError).toBe("function");
    expect(typeof noir.PrestoHttpError).toBe("function");
    expect(typeof noir.resolveVerifierTarget).toBe("function");
    expect(typeof noir.loopbackPermission).toBe("function");
    expect(typeof noir.watchLoopbackPermission).toBe("function");
    expect(noir.TESTED_BB_VERSION).toBe("6.0.0-rc.1");
    expect(noir.TESTED_BB_VERSIONS).toEqual(["6.0.0-rc.1"]);
    expect(noir.VERIFIER_TARGETS).toContain("noir-recursive-no-zk");
    const target: VerifierTarget = "evm";
    const options: PrestoUltraHonkBackendOptions = { fallback: "none" };
    const permission: LoopbackPermissionState = "granted";
    expect([target, options.fallback, permission]).toEqual(["evm", "none", "granted"]);
  });

  test("README documents the drop-in, the fallback modes, and the tested bb.js version", () => {
    const readme = read("../../README.md");
    for (const needle of [
      "@alejoamiras/presto-noir",
      "PrestoUltraHonkBackend",
      'fallback: "none"',
      "PrestoUnavailableError",
      "TESTED_BB_VERSION",
      "@aztec-foundation/bb.js@6.0.0-rc.1",
      "verifyProof",
    ]) {
      expect(readme).toContain(needle);
    }
  });

  test("the manifest pins the bb.js peer to the tested version and depends on core", () => {
    const pkg = JSON.parse(read("../../package.json"));
    expect(pkg.name).toBe("@alejoamiras/presto-noir");
    expect(pkg.peerDependencies).toEqual({ "@aztec-foundation/bb.js": noir.TESTED_BB_VERSION });
    expect(pkg.devDependencies["@aztec-foundation/bb.js"]).toBe(noir.TESTED_BB_VERSION);
    expect(pkg.dependencies["@alejoamiras/presto-core"]).toBe("workspace:*");
    expect(
      Object.keys(pkg.dependencies).some((name) => /^@aztec(?:-labs|-foundation)?\//.test(name)),
    ).toBe(false);
    expect(pkg.publishConfig).toEqual({ access: "public" });
    expect(pkg.files).toEqual(["src", "!src/**/*.test.ts", "dist"]);
  });
});

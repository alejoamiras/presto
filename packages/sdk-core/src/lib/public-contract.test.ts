import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PrestoPhase, PrestoScheme, ProveOutcome, ProveRequest } from "../index.js";
import * as core from "../index.js";

// Doc-sync guard: the barrel, the README, and the manifest describe one package.
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("public contract", () => {
  test("barrel exports the runtime + type surface", () => {
    expect(typeof core.PrestoClient).toBe("function");
    expect(typeof core.PrestoHttpError).toBe("function");
    expect(typeof core.toBase64).toBe("function");
    expect(typeof core.fromBase64).toBe("function");
    expect(core.PRESTO_API_VERSION).toBe(1);
    expect(core.PRESTO_SCHEME_CHONK).toBe("chonk");
    expect(core.PRESTO_SCHEME_ULTRA_HONK).toBe("ultra_honk");
    // Typed consts force the type-only barrel exports to resolve.
    const scheme: PrestoScheme = core.PRESTO_SCHEME_ULTRA_HONK;
    const phase: PrestoPhase = "version-mismatch";
    const request: ProveRequest = {
      path: "/prove",
      contentType: "x",
      body: () => new Uint8Array(),
    };
    const outcome: ProveOutcome = { kind: "fallback", reason: "route-missing" };
    expect([scheme, phase, request.path, outcome.kind]).toEqual([
      "ultra_honk",
      "version-mismatch",
      "/prove",
      "fallback",
    ]);
  });

  test("README documents the client, the outcome, and the scheme identifiers", () => {
    const readme = read("../../README.md");
    expect(readme).toContain("@alejoamiras/presto-core");
    expect(readme).toContain("PrestoClient");
    expect(readme).toContain('kind: "fallback"');
    expect(readme).toContain("PRESTO_SCHEME_ULTRA_HONK");
    expect(readme).toContain("PrestoHttpError");
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

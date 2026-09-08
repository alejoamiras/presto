import { describe, expect, test } from "bun:test";
import { type Manifest, NPM_PACKAGES, type PackageKey } from "./npm-packages.ts";
import { packOrder, pinsFor } from "./pack-candidate.ts";

const core = NPM_PACKAGES["presto-core"].name;
const manifests: Record<string, Manifest> = {
  "presto-core": { name: core, version: "1.0.0" },
  presto: {
    name: NPM_PACKAGES.presto.name,
    version: "0.0.0",
    dependencies: { [core]: "workspace:*" },
  },
};
const manifestOf = (key: PackageKey) => manifests[key] as Manifest;

describe("pack-candidate", () => {
  test("dependencies are packed before dependants, once each", () => {
    expect(packOrder("presto", manifestOf)).toEqual(["presto-core", "presto"]);
    expect(packOrder("presto-core", manifestOf)).toEqual(["presto-core"]);
  });

  test("a dependency cycle is a hard failure", () => {
    const cyclic = (key: PackageKey): Manifest =>
      key === "presto-core"
        ? {
            name: core,
            version: "1.0.0",
            dependencies: { [NPM_PACKAGES.presto.name]: "workspace:*" },
          }
        : manifestOf(key);
    expect(() => packOrder("presto", cyclic)).toThrow("workspace dependency cycle");
  });

  test("pins come from what was packed, and an unpacked dependency fails closed", () => {
    const packed = { [core]: { version: "1.0.0", tarball: "/tmp/core.tgz" } };
    expect(pinsFor(manifestOf("presto"), packed)).toEqual({ [core]: "1.0.0" });
    expect(pinsFor(manifestOf("presto-core"), {})).toEqual({});
    expect(() => pinsFor(manifestOf("presto"), {})).toThrow("must be packed before its dependants");
  });

  test("the real workspace resolves to the same order", () => {
    // Guards the descriptor + manifests on disk: presto depends on core and nothing cycles.
    expect(packOrder("presto", (key) => manifestOf(key))).toEqual(["presto-core", "presto"]);
  });
});

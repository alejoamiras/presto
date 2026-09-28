import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  aztecVersionOf,
  findAztecDependency,
  listAztecDependencies,
  requireAztecDependency,
} from "./aztec-manifest.ts";

const v5Sdk = {
  dependencies: {
    "@aztec/stdlib": "5.2.0",
    "@aztec/bb-prover": "5.2.0",
    "@logtape/logtape": "1.0.0",
  },
  devDependencies: { "@aztec/aztec.js": "5.2.0" },
};
const v6Sdk = {
  dependencies: {
    "@aztec-labs/stdlib": "6.0.0-rc.1",
    "@aztec-labs/bb-prover": "6.0.0-rc.1",
    "@aztec-foundation/noir-acvm_js": "6.0.0-rc.1",
  },
  devDependencies: { "@aztec-labs/aztec.js": "6.0.0-rc.1" },
};

describe("aztec manifest reader", () => {
  test("reads v5 and v6 SDK manifests", () => {
    expect(aztecVersionOf(v5Sdk)).toBe("5.2.0");
    expect(aztecVersionOf(v6Sdk)).toBe("6.0.0-rc.1");
    expect(requireAztecDependency(v6Sdk, "bb-prover", ["dependencies"]).name).toBe(
      "@aztec-labs/bb-prover",
    );
    expect(requireAztecDependency(v5Sdk, "aztec.js", ["devDependencies"])).toEqual({
      name: "@aztec/aztec.js",
      version: "5.2.0",
    });
  });

  test("reads the Noir adapter's bb.js peer under both scopes", () => {
    for (const name of ["@aztec/bb.js", "@aztec-foundation/bb.js"]) {
      const adapter = {
        devDependencies: { [name]: "6.0.0-rc.1" },
        peerDependencies: { [name]: "6.0.0-rc.1" },
      };
      expect(
        requireAztecDependency(adapter, "bb.js", ["devDependencies", "peerDependencies"]),
      ).toEqual({
        name,
        version: "6.0.0-rc.1",
      });
    }
  });

  test("both scopes, or one name at two versions, is ambiguous for find and require", () => {
    const both = { dependencies: { "@aztec/stdlib": "5.2.0", "@aztec-labs/stdlib": "6.0.0-rc.1" } };
    const split = {
      devDependencies: { "@aztec/bb.js": "5.2.0" },
      peerDependencies: { "@aztec/bb.js": "5.1.0" },
    };
    expect(() => findAztecDependency(both, "stdlib", ["dependencies"])).toThrow("ambiguous");
    expect(() => requireAztecDependency(both, "stdlib", ["dependencies"])).toThrow("ambiguous");
    expect(() =>
      findAztecDependency(split, "bb.js", ["devDependencies", "peerDependencies"]),
    ).toThrow("ambiguous");
  });

  test("none present: find returns undefined, require throws", () => {
    expect(findAztecDependency({}, "stdlib", ["dependencies"])).toBeUndefined();
    expect(findAztecDependency(v5Sdk, "stdlib", ["devDependencies"])).toBeUndefined();
    expect(() => requireAztecDependency({}, "stdlib", ["dependencies"])).toThrow(
      "no Aztec stdlib dependency",
    );
    expect(() => findAztecDependency(v5Sdk, "../stdlib", ["dependencies"])).toThrow("invalid");
  });

  test("lists release packages only, leaving unrelated foundation packages out", () => {
    const manifest = {
      dependencies: {
        ...v6Sdk.dependencies,
        "@aztec-foundation/aztec-standards": "6.0.0-rc.1",
        "@aztec-foundation/x": "1.0.0",
      },
      devDependencies: v6Sdk.devDependencies,
    };
    expect(
      listAztecDependencies(manifest, ["dependencies", "devDependencies"]).map((d) => d.name),
    ).toEqual([
      "@aztec-foundation/noir-acvm_js",
      "@aztec-labs/aztec.js",
      "@aztec-labs/bb-prover",
      "@aztec-labs/stdlib",
    ]);
  });

  test("the CLI prints the SDK's pin, or its name", () => {
    const cli = (...args: string[]) =>
      Bun.spawnSync(["bun", resolve(import.meta.dir, "aztec-manifest.ts"), ...args], {
        cwd: resolve(import.meta.dir, ".."),
      });
    const version = cli("packages/sdk/package.json");
    expect(version.exitCode).toBe(0);
    expect(version.stdout.toString().trim()).toMatch(/^\d+\.\d+\.\d+/);
    expect(cli("packages/sdk/package.json", "aztec.js", "--name").stdout.toString().trim()).toMatch(
      /^@aztec(-labs)?\/aztec\.js$/,
    );
    const missing = cli("packages/sdk-core/package.json");
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr.toString()).toContain("no Aztec stdlib dependency");
  });
});

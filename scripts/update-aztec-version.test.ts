import { describe, expect, test } from "bun:test";
import { updateHostDependencies, updatePackageJson, validateVersion } from "./update-aztec-version";

describe("validateVersion", () => {
  test("accepts nightly format", () => {
    expect(validateVersion("5.0.0-nightly.20260224")).toBe(true);
  });

  test("accepts rc format", () => {
    expect(validateVersion("4.1.0-rc.4")).toBe(true);
  });

  test("accepts stable semver", () => {
    expect(validateVersion("5.0.0")).toBe(true);
    expect(validateVersion("4.1.0")).toBe(true);
  });

  test("rejects invalid format", () => {
    expect(validateVersion("not-a-version")).toBe(false);
  });
});

describe("updatePackageJson", () => {
  const samplePkg = JSON.stringify(
    {
      name: "test",
      dependencies: {
        "@aztec/stdlib": "4.1.0-rc.4",
        "@aztec/bb-prover": "4.1.0-rc.4",
        "@aztec-foundation/aztec-standards": "5.0.1",
        "@aztec-foundation/some-other-package": "1.2.3",
        ky: "^1.14.3",
      },
      devDependencies: {
        "@aztec/simulator": "4.1.0-rc.4",
        typescript: "^5.9.3",
      },
    },
    null,
    2,
  );

  test("updates all @aztec/* dependencies to new version", () => {
    const result = updatePackageJson(samplePkg, "5.0.0-nightly.20260224");
    const pkg = JSON.parse(result);
    expect(pkg.dependencies["@aztec/stdlib"]).toBe("5.0.0-nightly.20260224");
    expect(pkg.dependencies["@aztec/bb-prover"]).toBe("5.0.0-nightly.20260224");
    expect(pkg.devDependencies["@aztec/simulator"]).toBe("5.0.0-nightly.20260224");
  });

  test("bumps an exact @aztec peer dependency too (the Noir adapter's bb.js peer)", () => {
    const withPeer = JSON.stringify({
      peerDependencies: { "@aztec/bb.js": "5.2.0" },
      devDependencies: { "@aztec/bb.js": "5.2.0" },
    });
    const pkg = JSON.parse(updatePackageJson(withPeer, "5.3.0"));
    expect(pkg.peerDependencies["@aztec/bb.js"]).toBe("5.3.0");
    expect(pkg.devDependencies["@aztec/bb.js"]).toBe("5.3.0");
  });

  test("does not touch non-@aztec dependencies", () => {
    const result = updatePackageJson(samplePkg, "5.0.0-nightly.20260224");
    const pkg = JSON.parse(result);
    expect(pkg.dependencies.ky).toBe("^1.14.3");
    expect(pkg.devDependencies.typescript).toBe("^5.9.3");
  });

  test("bumps lockstep companions but not other @aztec-foundation packages", () => {
    const result = updatePackageJson(samplePkg, "5.0.2");
    const pkg = JSON.parse(result);
    // aztec-standards ships generated code with undeclared @aztec/aztec.js imports —
    // it must move in lockstep with the @aztec/* pins.
    expect(pkg.dependencies["@aztec-foundation/aztec-standards"]).toBe("5.0.2");
    // The allowlist is exact — the scope alone must not opt a package in.
    expect(pkg.dependencies["@aztec-foundation/some-other-package"]).toBe("1.2.3");
  });

  test("respects skipPackages set", () => {
    const skip = new Set(["@aztec/simulator"]);
    const result = updatePackageJson(samplePkg, "5.0.0-nightly.20260224", skip);
    const pkg = JSON.parse(result);
    expect(pkg.dependencies["@aztec/stdlib"]).toBe("5.0.0-nightly.20260224");
    expect(pkg.devDependencies["@aztec/simulator"]).toBe("4.1.0-rc.4");
  });

  test("updates to stable version", () => {
    const result = updatePackageJson(samplePkg, "4.1.0");
    const pkg = JSON.parse(result);
    expect(pkg.dependencies["@aztec/stdlib"]).toBe("4.1.0");
    expect(pkg.dependencies["@aztec/bb-prover"]).toBe("4.1.0");
    expect(pkg.devDependencies["@aztec/simulator"]).toBe("4.1.0");
  });

  test("updates from stable version to newer", () => {
    const stablePkg = JSON.stringify(
      {
        name: "test",
        dependencies: { "@aztec/stdlib": "4.1.0" },
      },
      null,
      2,
    );
    const result = updatePackageJson(stablePkg, "4.2.0-rc.1");
    const pkg = JSON.parse(result);
    expect(pkg.dependencies["@aztec/stdlib"]).toBe("4.2.0-rc.1");
  });
});

describe("updateHostDependencies", () => {
  test("bumps the Noir consumer host's bb.js pin like a manifest section", () => {
    const updated = updateHostDependencies(
      JSON.stringify({ "@aztec/bb.js": "5.2.0", left: "^1.0.0" }),
      "5.3.0",
    );
    expect(JSON.parse(updated)).toEqual({ "@aztec/bb.js": "5.3.0", left: "^1.0.0" });
  });

  test("the committed host pin equals the adapter's peer pin", async () => {
    const root = new URL("..", import.meta.url);
    const host = await Bun.file(
      new URL("scripts/tarball-consumer/presto-noir/host-dependencies.json", root),
    ).json();
    const adapter = await Bun.file(new URL("packages/sdk-noir/package.json", root)).json();
    expect(host["@aztec/bb.js"]).toBe(adapter.peerDependencies["@aztec/bb.js"]);
  });
});

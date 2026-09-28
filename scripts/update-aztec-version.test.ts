import { describe, expect, test } from "bun:test";
import {
  CRS_FILE,
  HOST_DEPENDENCY_FILES,
  PACKAGE_JSON_FILES,
  updateHostDependencies,
  updatePackageJson,
  validateVersion,
} from "./update-aztec-version";

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
    // Matches the release shape, but npm reads an unsafe-integer base as a mutable tag.
    expect(validateVersion("9007199254740993.0.0")).toBe(false);
  });
});

describe("updatePackageJson", () => {
  const samplePkg = JSON.stringify(
    {
      name: "test",
      dependencies: {
        "@aztec-labs/stdlib": "4.1.0-rc.4",
        "@aztec-labs/bb-prover": "4.1.0-rc.4",
        "@aztec-foundation/aztec-standards": "5.0.1",
        "@aztec-foundation/some-other-package": "1.2.3",
        ky: "^1.14.3",
      },
      devDependencies: {
        "@aztec-labs/simulator": "4.1.0-rc.4",
        typescript: "^5.9.3",
      },
    },
    null,
    2,
  );

  test("updates all Aztec dependencies to the new version", () => {
    const result = updatePackageJson(samplePkg, "5.0.0-nightly.20260224");
    const pkg = JSON.parse(result);
    expect(pkg.dependencies["@aztec-labs/stdlib"]).toBe("5.0.0-nightly.20260224");
    expect(pkg.dependencies["@aztec-labs/bb-prover"]).toBe("5.0.0-nightly.20260224");
    expect(pkg.devDependencies["@aztec-labs/simulator"]).toBe("5.0.0-nightly.20260224");
  });

  test("bumps an exact Aztec peer dependency too (the Noir adapter's bb.js peer)", () => {
    const withPeer = JSON.stringify({
      peerDependencies: { "@aztec-foundation/bb.js": "5.2.0" },
      devDependencies: { "@aztec-foundation/bb.js": "5.2.0" },
    });
    const pkg = JSON.parse(updatePackageJson(withPeer, "5.3.0"));
    expect(pkg.peerDependencies["@aztec-foundation/bb.js"]).toBe("5.3.0");
    expect(pkg.devDependencies["@aztec-foundation/bb.js"]).toBe("5.3.0");
  });

  test("does not touch non-Aztec dependencies", () => {
    const result = updatePackageJson(samplePkg, "5.0.0-nightly.20260224");
    const pkg = JSON.parse(result);
    expect(pkg.dependencies.ky).toBe("^1.14.3");
    expect(pkg.devDependencies.typescript).toBe("^5.9.3");
  });

  test("leaves @aztec-foundation packages outside Aztec's release set alone", () => {
    const pkg = JSON.parse(updatePackageJson(samplePkg, "5.0.2"));
    expect(pkg.dependencies["@aztec-foundation/aztec-standards"]).toBe("5.0.1");
    expect(pkg.dependencies["@aztec-foundation/some-other-package"]).toBe("1.2.3");
  });

  test("bumps v6-scoped release packages, exact foundation names only", () => {
    const v6 = JSON.stringify({
      dependencies: {
        "@aztec-labs/stdlib": "6.0.0-rc.1",
        "@aztec-foundation/noir-acvm_js": "6.0.0-rc.1",
        "@aztec-foundation/x": "6.0.0-rc.1",
      },
      peerDependencies: { "@aztec-foundation/bb.js": "6.0.0-rc.1" },
    });
    const pkg = JSON.parse(updatePackageJson(v6, "6.0.0-rc.2"));
    expect(pkg.dependencies["@aztec-labs/stdlib"]).toBe("6.0.0-rc.2");
    expect(pkg.dependencies["@aztec-foundation/noir-acvm_js"]).toBe("6.0.0-rc.2");
    expect(pkg.peerDependencies["@aztec-foundation/bb.js"]).toBe("6.0.0-rc.2");
    expect(pkg.dependencies["@aztec-foundation/x"]).toBe("6.0.0-rc.1");
  });

  test("respects skipPackages set", () => {
    const skip = new Set(["@aztec-labs/simulator"]);
    const result = updatePackageJson(samplePkg, "5.0.0-nightly.20260224", skip);
    const pkg = JSON.parse(result);
    expect(pkg.dependencies["@aztec-labs/stdlib"]).toBe("5.0.0-nightly.20260224");
    expect(pkg.devDependencies["@aztec-labs/simulator"]).toBe("4.1.0-rc.4");
  });

  test("updates to stable version", () => {
    const result = updatePackageJson(samplePkg, "4.1.0");
    const pkg = JSON.parse(result);
    expect(pkg.dependencies["@aztec-labs/stdlib"]).toBe("4.1.0");
    expect(pkg.dependencies["@aztec-labs/bb-prover"]).toBe("4.1.0");
    expect(pkg.devDependencies["@aztec-labs/simulator"]).toBe("4.1.0");
  });

  test("updates from stable version to newer", () => {
    const stablePkg = JSON.stringify(
      {
        name: "test",
        dependencies: { "@aztec-labs/stdlib": "4.1.0" },
      },
      null,
      2,
    );
    const result = updatePackageJson(stablePkg, "4.2.0-rc.1");
    const pkg = JSON.parse(result);
    expect(pkg.dependencies["@aztec-labs/stdlib"]).toBe("4.2.0-rc.1");
  });
});

describe("updateHostDependencies", () => {
  test("bumps the Noir consumer host's bb.js pin like a manifest section", () => {
    const updated = updateHostDependencies(
      JSON.stringify({ "@aztec-foundation/bb.js": "5.2.0", left: "^1.0.0" }),
      "5.3.0",
    );
    expect(JSON.parse(updated)).toEqual({ "@aztec-foundation/bb.js": "5.3.0", left: "^1.0.0" });
  });

  test("the committed host pin equals the adapter's peer pin", async () => {
    const root = new URL("..", import.meta.url);
    const host = await Bun.file(
      new URL("scripts/tarball-consumer/presto-noir/host-dependencies.json", root),
    ).json();
    const adapter = await Bun.file(new URL("packages/sdk-noir/package.json", root)).json();
    expect(host["@aztec-foundation/bb.js"]).toBe(
      adapter.peerDependencies["@aztec-foundation/bb.js"],
    );
  });
});

describe("the Aztec update workflow", () => {
  test("stages exactly what the updater writes, plus the lockfile", async () => {
    const source = await Bun.file(
      new URL("../.github/workflows/_aztec-update.yml", import.meta.url),
    ).text();
    type Step = { uses?: string; with?: { paths?: string } };
    const workflow = Bun.YAML.parse(source) as { jobs: { update: { steps: Step[] } } };
    const push = workflow.jobs.update.steps.find(
      (step) => step.uses === "./.github/actions/bot-push",
    );
    const staged = (push?.with?.paths ?? "").split("\n").filter(Boolean).sort();
    const written = [...PACKAGE_JSON_FILES, ...HOST_DEPENDENCY_FILES, CRS_FILE, "bun.lock"].sort();
    expect(staged).toEqual(written);
  });
});

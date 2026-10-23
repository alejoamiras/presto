import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import {
  buildSteps,
  PINNED_NPM_BIN,
  pinnedNpmProblem,
  pinnedNpmVersion,
  stepPath,
  type Toolchain,
  toolchainProblems,
} from "./workers-build";

const PUBLISHED = ["bun", "scripts/published-playground.ts"];

describe("buildSteps", () => {
  test("only a playground build of main installs the published SDK", () => {
    expect(buildSteps("playground", "main")).toEqual([
      ["bun", "install", "--frozen-lockfile", "--ignore-scripts"],
      PUBLISHED,
      ["bun", "run", "--cwd", "packages/playground", "build"],
    ]);
    expect(buildSteps("playground", "feature/main")).not.toContainEqual(PUBLISHED);
    expect(buildSteps("landing", "main")).toEqual([
      ["bun", "install", "--frozen-lockfile", "--ignore-scripts"],
      ["bun", "run", "--cwd", "packages/landing", "build"],
    ]);
  });

  test("rejects an unknown site or a missing branch", () => {
    expect(() => buildSteps("release-feed", "main")).toThrow("usage");
    expect(() => buildSteps("../sdk", "main")).toThrow("usage");
    expect(() => buildSteps("landing", undefined)).toThrow("WORKERS_CI_BRANCH");
    expect(() => buildSteps("landing", "")).toThrow("WORKERS_CI_BRANCH");
  });
});

describe("toolchainProblems", () => {
  const ok: Toolchain = { workersCi: true, bun: "1.4.0", pinnedBun: "1.4.0", has: () => true };

  test("a matching toolchain passes for both sites", () => {
    expect(toolchainProblems("playground", ok)).toEqual([]);
    expect(toolchainProblems("landing", { ...ok, has: () => false })).toEqual([]);
  });

  test("Workers Builds must run the pinned Bun; other callers bring their own", () => {
    expect(toolchainProblems("landing", { ...ok, bun: "1.4.2" })).toEqual([
      "Bun 1.4.2 does not match .bun-version 1.4.0; set BUN_VERSION",
    ]);
    expect(toolchainProblems("landing", { ...ok, workersCi: false, bun: "1.4.2" })).toEqual([]);
  });

  test("the playground needs bash and tar on every branch", () => {
    expect(toolchainProblems("playground", { ...ok, has: (c) => c !== "tar" })).toEqual([
      "tar is not on PATH",
    ]);
  });
});

describe("the playground's npm", () => {
  const fakeNpm = (dir: string, version: string) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "npm"), `#!/bin/sh\necho ${version}\n`);
    chmodSync(join(dir, "npm"), 0o755);
  };

  test("resolves from the pin ahead of the image's npm, and only for the playground", () => {
    const pin = resolve("/repo", PINNED_NPM_BIN);
    expect(stepPath("playground", "/repo", "/image/bin")).toBe(`${pin}${delimiter}/image/bin`);
    expect(stepPath("playground", "/repo", undefined)).toBe(pin);
    expect(stepPath("landing", "/repo", "/image/bin")).toBe("/image/bin");
  });

  test("direct and nested calls reach the pin; a missing or different pin is refused", () => {
    const root = mkdtempSync(join(tmpdir(), "workers-build-"));
    try {
      fakeNpm(join(root, PINNED_NPM_BIN), "11.21.1");
      fakeNpm(join(root, "image"), "12.0.0");
      const path = stepPath(
        "playground",
        root,
        `${join(root, "image")}${delimiter}${process.env.PATH}`,
      );
      expect(pinnedNpmProblem(root, path, "11.21.1")).toBeUndefined();
      const nested = Bun.spawnSync(
        [
          process.execPath,
          "-e",
          'console.log(Bun.spawnSync(["npm", "--version"]).stdout.toString())',
        ],
        { env: { ...process.env, PATH: path }, stdout: "pipe" },
      );
      expect(nested.stdout.toString().trim()).toBe("11.21.1");
      expect(pinnedNpmProblem(root, path, "11.21.0")).toBe("npm 11.21.1 is not the pinned 11.21.0");
      rmSync(join(root, PINNED_NPM_BIN, "npm"));
      expect(pinnedNpmProblem(root, path, "11.21.1")).toBe(
        `npm resolves to ${join(root, "image", "npm")}, not ${PINNED_NPM_BIN}/npm`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("the manifest must pin an exact npm 11 or later", () => {
    expect(pinnedNpmVersion({ devDependencies: { npm: "11.21.1" } })).toBe("11.21.1");
    for (const npm of ["^11.21.1", "10.9.2", "11.01.0", undefined]) {
      const manifest: { devDependencies: Record<string, string> } = {
        devDependencies: npm ? { npm } : {},
      };
      expect(() => pinnedNpmVersion(manifest)).toThrow("expected an exact 11.x or later");
    }
  });
});

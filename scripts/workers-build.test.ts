import { describe, expect, test } from "bun:test";
import { buildSteps, type Toolchain, toolchainProblems } from "./workers-build";

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
  const ok: Toolchain = {
    workersCi: true,
    bun: "1.4.0",
    pinnedBun: "1.4.0",
    npm: "11.6.2",
    has: () => true,
  };

  test("a matching toolchain passes for both sites", () => {
    expect(toolchainProblems("playground", ok)).toEqual([]);
    expect(toolchainProblems("landing", { ...ok, npm: undefined, has: () => false })).toEqual([]);
  });

  test("Workers Builds must run the pinned Bun; other callers bring their own", () => {
    expect(toolchainProblems("landing", { ...ok, bun: "1.4.2" })).toEqual([
      "Bun 1.4.2 does not match .bun-version 1.4.0; set BUN_VERSION",
    ]);
    expect(toolchainProblems("landing", { ...ok, workersCi: false, bun: "1.4.2" })).toEqual([]);
  });

  test("the playground needs npm 11 plus bash and tar on every branch", () => {
    expect(toolchainProblems("playground", { ...ok, npm: "10.9.2" })).toEqual([
      "npm 10.9.2 is older than 11; set NODE_VERSION",
    ]);
    expect(
      toolchainProblems("playground", { ...ok, npm: undefined, has: (c) => c !== "tar" }),
    ).toEqual(["npm (missing) is older than 11; set NODE_VERSION", "tar is not on PATH"]);
  });
});

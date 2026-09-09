import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  parseCliArgs,
  parseDependencyPins,
  preparePublishManifest,
  publishedExports,
} from "./prepare-sdk-publish.ts";

const PUBLISHED_EXPORTS = { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } };

const src = {
  name: "@alejoamiras/presto",
  version: "0.0.0",
  exports: "./src/index.ts",
  files: ["src", "dist", ".claude", "MIGRATION.md"],
  dependencies: { "@aztec/stdlib": "5.0.1" },
  publishConfig: { access: "public", exports: "./src/index.ts" },
};

describe("preparePublishManifest (SDK publish rewrite)", () => {
  test("repoints main/types/exports at dist and sets the resolved version", () => {
    const out = preparePublishManifest(src, "5.0.1-revision.2");
    expect(out.version).toBe("5.0.1-revision.2");
    expect(out.main).toBe("./dist/index.js");
    expect(out.types).toBe("./dist/index.d.ts");
    expect(out.exports).toEqual(PUBLISHED_EXPORTS);
  });

  test("drops publishConfig.exports, keeps access, preserves files + deps", () => {
    const out = preparePublishManifest(src, "1.0.0");
    expect((out.publishConfig as Record<string, unknown>).exports).toBeUndefined();
    expect((out.publishConfig as Record<string, unknown>).access).toBe("public");
    // files (incl. MIGRATION.md) and deps must survive verbatim — the tarball's contents depend on it.
    expect(out.files).toEqual(src.files);
    expect(out.dependencies).toEqual(src.dependencies);
  });

  test("every source subpath publishes as its dist pair; devDependencies never ship", () => {
    const banners = {
      ...src,
      exports: { ".": "./src/index.ts", "./register": "./src/register.ts" },
      devDependencies: { "@alejoamiras/presto": "workspace:*" },
    };
    const out = preparePublishManifest(banners, "1.0.0");
    expect(out.exports).toEqual({
      ...PUBLISHED_EXPORTS,
      "./register": { types: "./dist/register.d.ts", default: "./dist/register.js" },
    });
    expect(out.main).toBe("./dist/index.js");
    expect(out.devDependencies).toBeUndefined();
    expect(publishedExports("./src/index.ts")).toEqual(PUBLISHED_EXPORTS);
  });

  test("an export the build cannot emit fails closed", () => {
    for (const bad of [
      { ".": "./dist/index.js" },
      { ".": "./src/index.ts", "./x": { default: "./src/x.ts" } },
      { "./register": "./src/register.ts" },
      undefined,
    ]) {
      expect(() => preparePublishManifest({ ...src, exports: bad }, "1.0.0")).toThrow(/exports/);
    }
  });

  test("does not mutate the input manifest", () => {
    const copy = structuredClone(src);
    preparePublishManifest(src, "9.9.9");
    expect(src).toEqual(copy);
  });

  test("pins workspace ranges to the sibling publish versions in every dependency field", () => {
    const out = preparePublishManifest(
      {
        ...src,
        dependencies: { "@alejoamiras/presto-core": "workspace:*", "@aztec/stdlib": "5.0.1" },
        peerDependencies: { "@alejoamiras/presto-core": "workspace:^" },
      },
      "1.0.0",
      { "@alejoamiras/presto-core": "1.2.3" },
    );
    expect(out.dependencies).toEqual({
      "@alejoamiras/presto-core": "1.2.3",
      "@aztec/stdlib": "5.0.1",
    });
    expect(out.peerDependencies).toEqual({ "@alejoamiras/presto-core": "1.2.3" });
  });

  test("a workspace dependency without an exact supplied version fails closed", () => {
    const withCore = { ...src, dependencies: { "@alejoamiras/presto-core": "workspace:*" } };
    expect(() => preparePublishManifest(withCore, "1.0.0")).toThrow(
      "no publish version was supplied",
    );
    for (const bad of ["latest", "^1.2.3", "file:../core", "1.2"]) {
      expect(() =>
        preparePublishManifest(withCore, "1.0.0", { "@alejoamiras/presto-core": bad }),
      ).toThrow("is not an exact semver version");
    }
  });
});

describe("prepare-sdk-publish CLI", () => {
  test("the CLI reads the path from the second positional whether the version comes from argv or $VERSION", () => {
    expect(parseCliArgs(["5.2.0", "package.json"], {})).toEqual({
      version: "5.2.0",
      manifestPath: "package.json",
      pins: {},
    });
    expect(parseCliArgs(["5.2.0", "package.json"], { VERSION: "5.2.0" }).manifestPath).toBe(
      "package.json",
    );
    expect(parseCliArgs([], { VERSION: "5.2.0" })).toMatchObject({
      version: "5.2.0",
      manifestPath: "package.json",
    });
    expect(() => parseCliArgs([], {})).toThrow("usage");
  });

  test("the workflow's exact invocation rewrites a manifest on disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "prepare-sdk-publish-"));
    const manifestPath = join(dir, "package.json");
    writeFileSync(
      manifestPath,
      `${JSON.stringify({ ...src, dependencies: { "@alejoamiras/presto-core": "workspace:*" } })}\n`,
    );
    const result = Bun.spawnSync(
      [
        "bun",
        resolve(import.meta.dir, "prepare-sdk-publish.ts"),
        "5.2.0",
        "package.json",
        "--dep",
        "@alejoamiras/presto-core=1.2.3",
      ],
      { cwd: dir, env: { ...process.env, VERSION: "5.2.0" }, stdout: "pipe", stderr: "pipe" },
    );
    expect(result.exitCode).toBe(0);
    const written = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(written.version).toBe("5.2.0");
    expect(written.dependencies).toEqual({ "@alejoamiras/presto-core": "1.2.3" });
    expect(written.exports).toEqual(PUBLISHED_EXPORTS);
    rmSync(dir, { recursive: true, force: true });
  });

  test("--dep name=version pairs are taken from argv and the rest is kept in order", () => {
    expect(
      parseDependencyPins(["1.0.0", "--dep", "@alejoamiras/presto-core=1.2.3", "package.json"]),
    ).toEqual({ pins: { "@alejoamiras/presto-core": "1.2.3" }, rest: ["1.0.0", "package.json"] });
    expect(() => parseDependencyPins(["--dep", "nope"])).toThrow("name=version");
    expect(() => parseDependencyPins(["--dep"])).toThrow("name=version");
  });
});

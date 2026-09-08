import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  CONSUMER_PROFILE_ROOT,
  DEFAULT_PACKAGE,
  isValidVersion,
  NPM_PACKAGES,
  packageFromArgs,
  provenanceSubject,
  readManifest,
  releaseTag,
  resolvePackage,
} from "./npm-packages.ts";

const root = resolve(import.meta.dir, "..");

describe("npm package descriptor", () => {
  test("every entry names a real workspace package with a matching manifest and a consumer profile", () => {
    const names = new Set<string>();
    const dirs = new Set<string>();
    for (const [key, pkg] of Object.entries(NPM_PACKAGES)) {
      expect(names.has(pkg.name)).toBe(false);
      expect(dirs.has(pkg.dir)).toBe(false);
      names.add(pkg.name);
      dirs.add(pkg.dir);
      expect(readManifest(pkg, root).name).toBe(pkg.name);
      const profile = join(root, CONSUMER_PROFILE_ROOT, pkg.consumerProfile);
      for (const file of ["index.ts", "runtime-check.mjs", "tsconfig.json"]) {
        expect(existsSync(join(profile, file))).toBe(true);
      }
      expect(resolvePackage(key)).toBe(pkg);
    }
    expect(resolvePackage()).toBe(NPM_PACKAGES[DEFAULT_PACKAGE]);
  });

  test("an unknown package is a hard failure that names the valid keys", () => {
    expect(() => resolvePackage("nope")).toThrow(
      'unknown package "nope"; expected one of presto, presto-core',
    );
    expect(() => packageFromArgs(["--package"])).toThrow("--package needs a value");
    expect(() => packageFromArgs(["--package", "--dry-run"])).toThrow("--package needs a value");
  });

  test("--package is taken from anywhere in argv and the rest is preserved in order", () => {
    expect(packageFromArgs(["5.2.0", "--package", "presto", "--dry-run"])).toEqual({
      pkg: NPM_PACKAGES.presto,
      rest: ["5.2.0", "--dry-run"],
    });
    expect(packageFromArgs(["--package=presto"]).rest).toEqual([]);
    expect(packageFromArgs([]).pkg).toBe(NPM_PACKAGES.presto);
  });

  test("version patterns keep the revision suffix exclusive to aztec-derived packages", () => {
    const aztec = NPM_PACKAGES.presto;
    const manifest = { ...aztec, versionMode: "manifest" as const };
    expect(isValidVersion(aztec, "5.2.0")).toBe(true);
    expect(isValidVersion(aztec, "5.2.0-revision.3")).toBe(true);
    expect(isValidVersion(aztec, "5.2.0-rc.1")).toBe(false);
    expect(isValidVersion(manifest, "1.0.0")).toBe(true);
    expect(isValidVersion(manifest, "1.0.0-rc.1")).toBe(true);
    expect(isValidVersion(manifest, "1.0.0-revision.1")).toBe(false);
    expect(isValidVersion(manifest, "1.0")).toBe(false);
  });

  test("provenance subject and release tag are derived from the package name", () => {
    expect(provenanceSubject(NPM_PACKAGES.presto, "5.2.0")).toBe(
      "pkg:npm/%40alejoamiras/presto@5.2.0",
    );
    expect(releaseTag(NPM_PACKAGES.presto, "5.2.0")).toBe("@alejoamiras/presto@5.2.0");
  });
});

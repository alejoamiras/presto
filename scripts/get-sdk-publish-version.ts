/**
 * Determine the publish version for one package (`--package <key>`, default `presto`).
 *
 * `aztec-derived` packages follow the pinned Aztec version (the argument, or the package's Aztec
 * `stdlib` dependency, under either scope) and get a revision suffix when that base is already on npm:
 *
 *   5.0.0-nightly.20260224 → 5.0.0-nightly.20260224.1 → .2   (prereleases extend the identifier)
 *   4.2.0                  → 4.2.0-revision.1 → -revision.2   (stable + "." + number is not semver)
 *
 * `manifest` packages publish the manifest version verbatim, exactly once: a version already on npm
 * is a hard failure here. Whether an identical published artifact can be reused instead of failing
 * is the release preflight's decision, not this script's.
 *
 * Usage: bun scripts/get-sdk-publish-version.ts [--package <key>] [base-version]
 */

import { aztecVersionOf } from "./aztec-manifest.ts";
import {
  isPrerelease,
  type NpmPackage,
  packageFromArgs,
  readManifest,
  VERSION_PATTERNS,
} from "./npm-packages.ts";

/**
 * Pure function: given a base version and the list of already-published
 * versions, return the version string to publish.
 */
export function resolvePublishVersion(baseVersion: string, publishedVersions: string[]): string {
  if (!publishedVersions.includes(baseVersion)) {
    return baseVersion;
  }

  const isPrerelease = baseVersion.includes("-");
  const prefix = isPrerelease ? `${baseVersion}.` : `${baseVersion}-revision.`;
  const revisions = publishedVersions
    .filter((v) => v.startsWith(prefix))
    .map((v) => Number(v.slice(prefix.length)))
    .filter((n) => Number.isInteger(n) && n > 0);

  const maxRevision = revisions.length > 0 ? Math.max(...revisions) : 0;
  const nextRevision = maxRevision + 1;
  return isPrerelease
    ? `${baseVersion}.${nextRevision}`
    : `${baseVersion}-revision.${nextRevision}`;
}

/**
 * Comparator for `aztec-derived` versions in publish order: prereleases (semver order among
 * themselves) < `X.Y.Z` < `X.Y.Z-revision.N`. Semver puts a revision before its own base.
 */
export function aztecDerivedOrder(a: string, b: string): number {
  const parts = (v: string) => {
    if (!VERSION_PATTERNS["aztec-derived"].test(v)) {
      throw new Error(`${JSON.stringify(v)} is not an aztec-derived version`);
    }
    const m = /^(\d+)\.(\d+)\.(\d+)(?:-revision\.(\d+))?/.exec(v) as RegExpExecArray;
    const stage = isPrerelease(v) ? -1 : m[4] === undefined ? 0 : 1;
    return [m[1], m[2], m[3], stage, m[4] ?? "0"].map(Number);
  };
  const x = parts(a);
  const y = parts(b);
  const i = x.findIndex((n, k) => n !== y[k]);
  if (i >= 0) return Math.sign((x[i] as number) - (y[i] as number));
  return x[3] === -1 ? Bun.semver.order(a, b) : 0;
}

/** The version to publish for `pkg`; a manifest version already on npm is never suffixed. */
export function resolvePackageVersion(
  pkg: NpmPackage,
  baseVersion: string,
  publishedVersions: string[],
): string {
  if (pkg.versionMode === "aztec-derived") {
    return resolvePublishVersion(baseVersion, publishedVersions);
  }
  if (publishedVersions.includes(baseVersion)) {
    throw new Error(
      `${pkg.name}@${baseVersion} is already on npm; bump the manifest version (manifest versions are never suffixed)`,
    );
  }
  return baseVersion;
}

/** The base version: the argument, else the manifest version or its Aztec `stdlib` pin. */
export function baseVersionFor(
  pkg: NpmPackage,
  manifest: { version?: string; dependencies?: Record<string, string> },
  argument?: string,
): string {
  if (argument) return argument;
  if (pkg.versionMode === "manifest") {
    if (!manifest.version) throw new Error(`${pkg.name}: package.json has no version`);
    return manifest.version;
  }
  try {
    return aztecVersionOf(manifest);
  } catch (error) {
    throw new Error(`${pkg.name}: ${(error as Error).message}; cannot derive the base version`);
  }
}

async function getPublishedVersions(name: string): Promise<string[]> {
  const proc = Bun.spawn(["npm", "view", name, "versions", "--json"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    if (stderr.includes("E404")) {
      return [];
    }
    throw new Error(`npm view failed (exit ${exitCode}): ${stderr}`);
  }

  const stdout = await new Response(proc.stdout).text();
  const parsed = JSON.parse(stdout);
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function main() {
  const { pkg, rest } = packageFromArgs(process.argv.slice(2));
  const base = baseVersionFor(
    pkg,
    readManifest(pkg) as Parameters<typeof baseVersionFor>[1],
    rest[0],
  );
  const versions = await getPublishedVersions(pkg.name);
  console.log(resolvePackageVersion(pkg, base, versions));
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

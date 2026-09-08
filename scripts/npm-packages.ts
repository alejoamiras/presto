/**
 * The closed list of npm packages the release tooling can publish, verify, and promote. Every script
 * that used to hardcode `@alejoamiras/presto` takes one of these instead (`--package <key>`, default
 * `presto`), so a new package is one entry here plus its consumer profile.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * How a package's publish version is chosen.
 * - `aztec-derived`: the version follows the pinned Aztec release; a republish of the same base gets a
 *   `-revision.N` suffix (prereleases get `.N`).
 * - `manifest`: the version is the one in `package.json`, published verbatim exactly once; a version
 *   that is already on npm is never suffixed — the release either reuses the identical published
 *   artifact or fails and demands a bump.
 */
export type VersionMode = "aztec-derived" | "manifest";

export interface NpmPackage {
  /** The npm name, e.g. `@alejoamiras/presto`. */
  readonly name: string;
  /** Workspace directory, relative to the repository root. */
  readonly dir: string;
  readonly versionMode: VersionMode;
  /** Directory under `scripts/tarball-consumer/` holding the consumer host's files. */
  readonly consumerProfile: string;
}

export const NPM_PACKAGES = {
  presto: {
    name: "@alejoamiras/presto",
    dir: "packages/sdk",
    versionMode: "aztec-derived",
    consumerProfile: "presto",
  },
} as const satisfies Record<string, NpmPackage>;

export type PackageKey = keyof typeof NPM_PACKAGES;

export const DEFAULT_PACKAGE: PackageKey = "presto";

export const CONSUMER_PROFILE_ROOT = "scripts/tarball-consumer";

/** `aztec-derived` versions are stable or stable + `-revision.N`; `manifest` versions are plain semver. */
export const VERSION_PATTERNS: Record<VersionMode, RegExp> = {
  "aztec-derived": /^\d+\.\d+\.\d+(?:-revision\.\d+)?$/,
  manifest: /^\d+\.\d+\.\d+(?:-(?!revision\.)[0-9A-Za-z.-]+)?$/,
};

export function isPackageKey(key: string): key is PackageKey {
  return Object.hasOwn(NPM_PACKAGES, key);
}

/** The descriptor for `key`, or a hard failure naming the valid keys. */
export function resolvePackage(key: string = DEFAULT_PACKAGE): NpmPackage {
  if (!isPackageKey(key)) {
    throw new Error(
      `unknown package ${JSON.stringify(key)}; expected one of ${Object.keys(NPM_PACKAGES).join(", ")}`,
    );
  }
  return NPM_PACKAGES[key];
}

/**
 * Split `--package <key>` (anywhere in `args`) from the remaining arguments. A missing flag selects
 * the default package; a flag without a value is an error.
 */
export function packageFromArgs(args: readonly string[]): { pkg: NpmPackage; rest: string[] } {
  const rest: string[] = [];
  let key: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "--package") {
      const value = args[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error("--package needs a value");
      }
      key = value;
      i += 1;
    } else if (arg.startsWith("--package=")) {
      key = arg.slice("--package=".length);
    } else {
      rest.push(arg);
    }
  }
  return { pkg: resolvePackage(key), rest };
}

export function isValidVersion(pkg: NpmPackage, version: string): boolean {
  return VERSION_PATTERNS[pkg.versionMode].test(version);
}

/**
 * One exact semver.org version: no ranges, no empty identifiers, no leading zeros. npm treats a
 * malformed spec like `5.2.0-alpha..x` as a mutable TAG — the opposite of a pin.
 */
export const EXACT_SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/** The SLSA provenance subject npm records for a published version (purl: scope `@` is `%40`). */
export function provenanceSubject(pkg: NpmPackage, version: string): string {
  return `pkg:npm/${pkg.name.replace(/^@/, "%40")}@${version}`;
}

/** The git tag and GitHub release name for a published version. */
export function releaseTag(pkg: NpmPackage, version: string): string {
  return `${pkg.name}@${version}`;
}

export interface Manifest {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  [key: string]: unknown;
}

/** The package's workspace manifest, read from disk. */
export function readManifest(
  pkg: NpmPackage,
  root: string = resolve(import.meta.dir, ".."),
): Manifest {
  return JSON.parse(readFileSync(join(root, pkg.dir, "package.json"), "utf8"));
}

/** The descriptor keys this manifest depends on through `workspace:` ranges, in any dependency field. */
export function workspaceDependencies(manifest: Manifest): PackageKey[] {
  const keys: PackageKey[] = [];
  const fields = [manifest.dependencies, manifest.peerDependencies, manifest.optionalDependencies];
  for (const deps of fields) {
    for (const [name, range] of Object.entries(deps ?? {})) {
      if (!range.startsWith("workspace:")) continue;
      const key = (Object.keys(NPM_PACKAGES) as PackageKey[]).find(
        (k) => NPM_PACKAGES[k].name === name,
      );
      if (!key) throw new Error(`${name} is a workspace dependency but not a publishable package`);
      if (!keys.includes(key)) keys.push(key);
    }
  }
  return keys;
}

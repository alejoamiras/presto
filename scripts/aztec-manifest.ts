/**
 * Reads Aztec dependencies from a package manifest of either generation: `@aztec/<bare>` through v5,
 * `@aztec-labs/<bare>` or `@aztec-foundation/<bare>` from v6. Every script and workflow that needs an
 * Aztec package name or version from a manifest goes through here, so a scope change is one edit.
 * Dependency-free on purpose: release jobs run it with a bare Bun, before any install.
 *
 * Usage: bun scripts/aztec-manifest.ts <package.json> [bare=stdlib] [--name]
 * Prints the version (or, with --name, the package name) found across dependencies, devDependencies
 * and peerDependencies; exits 1 when it is missing or ambiguous.
 */
import { readFileSync } from "node:fs";

export type Section = "dependencies" | "devDependencies" | "peerDependencies";

export const ALL_SECTIONS: readonly Section[] = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
];

export type PackageManifest = { [S in Section]?: Record<string, string> };

export interface AztecDependency {
  name: string;
  version: string;
}

const SCOPES = ["@aztec/", "@aztec-labs/", "@aztec-foundation/"] as const;

/** `@aztec-foundation` also holds unrelated packages; only these are Aztec release artifacts. */
export const FOUNDATION_PACKAGES: ReadonlySet<string> = new Set([
  "@aztec-foundation/bb.js",
  "@aztec-foundation/noir-acvm_js",
  "@aztec-foundation/noir-noirc_abi",
]);

/** A package Aztec publishes in lockstep with each release. */
export function isAztecPackage(name: string): boolean {
  return (
    name.startsWith("@aztec/") || name.startsWith("@aztec-labs/") || FOUNDATION_PACKAGES.has(name)
  );
}

/**
 * The dependency named `@aztec/<bare>`, `@aztec-labs/<bare>` or `@aztec-foundation/<bare>` across
 * `sections`, or `undefined`. One name listed in several sections at one version is one match; two
 * names, or two versions, throw, so a manifest caught between generations never passes silently.
 */
export function findAztecDependency(
  manifest: PackageManifest,
  bare: string,
  sections: readonly Section[],
): AztecDependency | undefined {
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(bare)) {
    throw new Error(`invalid Aztec package name ${JSON.stringify(bare)}`);
  }
  const candidates = new Set(SCOPES.map((scope) => `${scope}${bare}`));
  const found = new Map<string, AztecDependency>();
  for (const section of sections) {
    for (const [name, version] of Object.entries(manifest[section] ?? {})) {
      if (candidates.has(name)) found.set(`${name}@${version}`, { name, version });
    }
  }
  if (found.size > 1) {
    throw new Error(
      `ambiguous Aztec dependency ${bare}: ${[...found.keys()].join(", ")} in ${sections.join(", ")}`,
    );
  }
  return found.values().next().value;
}

/** As `findAztecDependency`, but a missing dependency also throws. */
export function requireAztecDependency(
  manifest: PackageManifest,
  bare: string,
  sections: readonly Section[],
): AztecDependency {
  const found = findAztecDependency(manifest, bare, sections);
  if (!found) {
    throw new Error(`no Aztec ${bare} dependency (any scope) in ${sections.join(", ")}`);
  }
  return found;
}

/** The Aztec release a package is built against: its required `stdlib` dependency pin. */
export function aztecVersionOf(manifest: PackageManifest): string {
  return requireAztecDependency(manifest, "stdlib", ["dependencies"]).version;
}

/** Every Aztec release package in `sections`, by name. */
export function listAztecDependencies(
  manifest: PackageManifest,
  sections: readonly Section[],
): AztecDependency[] {
  const found = new Map<string, AztecDependency>();
  for (const section of sections) {
    for (const [name, version] of Object.entries(manifest[section] ?? {})) {
      if (isAztecPackage(name)) found.set(name, { name, version });
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const printName = args.includes("--name");
  const [path, bare = "stdlib", ...extra] = args.filter((arg) => arg !== "--name");
  if (!path || extra.length > 0) {
    console.error("usage: bun scripts/aztec-manifest.ts <package.json> [bare=stdlib] [--name]");
    process.exit(1);
  }
  try {
    const manifest = JSON.parse(readFileSync(path, "utf8")) as PackageManifest;
    const dependency = requireAztecDependency(manifest, bare, ALL_SECTIONS);
    console.log(printName ? dependency.name : dependency.version);
  } catch (error) {
    console.error(`${path}: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

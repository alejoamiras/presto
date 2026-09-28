/**
 * The Aztec `stdlib` dependency a packed manifest pins, derived from the artifact under test — never a
 * hardcode (which silently manufactures the very skew the consumer gate exists to catch after every
 * Aztec bump) and never the workspace manifest (which skews whenever an older tarball is tested).
 *
 * Usage: bun scripts/tarball-consumer/exact-pin.ts [--package <key>] <tarball>
 * Prints `<name> <version>`, or nothing for a package that does not ship the dependency.
 */
import {
  type AztecDependency,
  findAztecDependency,
  type PackageManifest,
  requireAztecDependency,
} from "../aztec-manifest.ts";
import { isExactSemver, type NpmPackage, packageFromArgs } from "../npm-packages.ts";

/**
 * An `aztec-derived` package must pin `stdlib` exactly: exact pins are what make the consumer's Aztec
 * graph a singleton, and a range here would still resolve but silently weaken that contract. A
 * `manifest` package may omit the dependency entirely.
 */
export function exactAztecPin(
  manifest: PackageManifest,
  pkg: NpmPackage,
): AztecDependency | undefined {
  const pin =
    pkg.versionMode === "aztec-derived"
      ? requireAztecDependency(manifest, "stdlib", ["dependencies"])
      : findAztecDependency(manifest, "stdlib", ["dependencies"]);
  if (pin && !isExactSemver(pin.version)) {
    throw new Error(
      `${pkg.name}: the tarball pins ${pin.name} as ${JSON.stringify(pin.version)}, not an exact semver; the exact-pin invariant is broken`,
    );
  }
  return pin;
}

if (import.meta.main) {
  const { pkg, rest } = packageFromArgs(process.argv.slice(2));
  const tarball = rest[0];
  if (!tarball) {
    console.error("usage: bun scripts/tarball-consumer/exact-pin.ts [--package <key>] <tarball>");
    process.exit(1);
  }
  const extracted = Bun.spawnSync(["tar", "-xzOf", tarball, "package/package.json"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (extracted.exitCode !== 0) {
    console.error(`cannot read package/package.json from ${tarball}: ${extracted.stderr}`);
    process.exit(1);
  }
  try {
    const pin = exactAztecPin(JSON.parse(extracted.stdout.toString()), pkg);
    console.log(pin ? `${pin.name} ${pin.version}` : "");
  } catch (error) {
    console.error(`${pkg.name}: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

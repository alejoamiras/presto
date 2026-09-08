/**
 * The `@aztec/stdlib` version a packed manifest pins, derived from the artifact under test — never a
 * hardcode (which silently manufactures the very skew the consumer gate exists to catch after every
 * Aztec bump) and never the workspace manifest (which skews whenever an older tarball is tested).
 *
 * Usage: bun scripts/tarball-consumer/exact-pin.ts [--package <key>] <tarball>
 * Prints the pin, or nothing for a package that does not ship the dependency.
 */
import { EXACT_SEMVER, type NpmPackage, packageFromArgs } from "../npm-packages.ts";

/**
 * An `aztec-derived` package must pin `@aztec/stdlib` exactly (the F13 deps-vs-peers decision: exact
 * pins are what make the consumer's `@aztec` graph a singleton); a range here would still resolve but
 * silently weaken that contract. A `manifest` package may omit the dependency entirely.
 */
export function exactAztecPin(
  manifest: { dependencies?: Record<string, string> },
  pkg: NpmPackage,
): string | undefined {
  const pin = manifest.dependencies?.["@aztec/stdlib"];
  if (pin === undefined) {
    if (pkg.versionMode === "aztec-derived") {
      throw new Error(
        `${pkg.name}: the tarball manifest has no dependencies["@aztec/stdlib"]; the exact-host pin cannot be derived`,
      );
    }
    return undefined;
  }
  if (!EXACT_SEMVER.test(pin)) {
    throw new Error(
      `${pkg.name}: the tarball pins @aztec/stdlib as ${JSON.stringify(pin)}, not an exact semver; the exact-pin invariant is broken`,
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
    console.log(exactAztecPin(JSON.parse(extracted.stdout.toString()), pkg) ?? "");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

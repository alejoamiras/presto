/**
 * The consumer host's package.json: the tarball under test, the profile's extra host dependencies,
 * and an optional `@aztec/stdlib` pin. The tarball entry is written last and an extra that names the
 * tested package is rejected, so a profile can never swap the candidate for a registry version.
 *
 * Usage: bun scripts/tarball-consumer/host-manifest.ts <dir> <tarball> <package-name> [aztec-version] [extras.json]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function hostManifest(
  name: string,
  tarball: string,
  extras: Record<string, string> = {},
  aztecVersion?: string,
): Record<string, unknown> {
  if (Object.hasOwn(extras, name)) {
    throw new Error(`host-dependencies.json must not name the package under test (${name})`);
  }
  const dependencies: Record<string, string> = { ...extras };
  if (aztecVersion) dependencies["@aztec/stdlib"] = aztecVersion;
  dependencies[name] = `file:${tarball}`;
  return {
    name: `host-${aztecVersion || "default"}`,
    version: "0.0.0",
    private: true,
    dependencies,
  };
}

if (import.meta.main) {
  const [dir, tarball, name, aztecVersion, extrasPath] = process.argv.slice(2);
  if (!dir || !tarball || !name) {
    console.error(
      "usage: host-manifest.ts <dir> <tarball> <package-name> [aztec-version] [extras.json]",
    );
    process.exit(1);
  }
  const extras = extrasPath ? JSON.parse(readFileSync(extrasPath, "utf8")) : {};
  const manifest = hostManifest(name, tarball, extras, aztecVersion || undefined);
  writeFileSync(join(dir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

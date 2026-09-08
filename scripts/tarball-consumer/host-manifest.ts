/**
 * The consumer host's package.json: the tarball under test, the profile's extra host dependencies,
 * an optional `@aztec/stdlib` pin, and any workspace dependencies supplied as local tarballs
 * (bootstrap mode, before they exist on npm). The tarball entry is written last and an extra or
 * local tarball that names the tested package is rejected, so a profile can never swap the
 * candidate for another artifact.
 *
 * Usage: bun scripts/tarball-consumer/host-manifest.ts <dir> <tarball> <package-name> [aztec-version] [extras.json] [name=tarball ...]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function hostManifest(
  name: string,
  tarball: string,
  extras: Record<string, string> = {},
  aztecVersion?: string,
  local: Record<string, string> = {},
): Record<string, unknown> {
  for (const source of [extras, local]) {
    if (Object.hasOwn(source, name)) {
      throw new Error(`host dependencies must not name the package under test (${name})`);
    }
  }
  const dependencies: Record<string, string> = { ...extras };
  if (aztecVersion) dependencies["@aztec/stdlib"] = aztecVersion;
  for (const [dep, path] of Object.entries(local)) dependencies[dep] = `file:${path}`;
  dependencies[name] = `file:${tarball}`;
  return {
    name: `host-${aztecVersion || "default"}`,
    version: "0.0.0",
    private: true,
    dependencies,
  };
}

/** `name=path` pairs (the `--with` arguments of the consumer script). */
export function parseLocalTarballs(pairs: string[]): Record<string, string> {
  const local: Record<string, string> = {};
  for (const pair of pairs) {
    const at = pair.indexOf("=");
    if (at <= 0 || at === pair.length - 1) throw new Error(`expected name=tarball, got ${pair}`);
    local[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return local;
}

if (import.meta.main) {
  const [dir, tarball, name, aztecVersion, extrasPath, ...withPairs] = process.argv.slice(2);
  if (!dir || !tarball || !name) {
    console.error(
      "usage: host-manifest.ts <dir> <tarball> <package-name> [aztec-version] [extras.json] [name=tarball ...]",
    );
    process.exit(1);
  }
  const extras = extrasPath ? JSON.parse(readFileSync(extrasPath, "utf8")) : {};
  const manifest = hostManifest(
    name,
    tarball,
    extras,
    aztecVersion || undefined,
    parseLocalTarballs(withPairs),
  );
  writeFileSync(join(dir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

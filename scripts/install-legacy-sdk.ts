import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readdir, readFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import legacy from "../audit/fixtures/interop-sdk.json";
import { aztecVersionOf } from "./aztec-manifest";
import { parseNpmPackResult } from "./npm-pack-result";

/**
 * The published SDK proves on the workspace's Aztec network, so the gate runs only when both target
 * the same Aztec version, and otherwise goes dormant and returns why. A mismatch alone never fails:
 * an Aztec bump always lands before a presto built for it can be published.
 */
export function legacyGate(legacyAztec: string, currentAztec: string): string | undefined {
  if (legacyAztec === currentAztec) return undefined;
  return `targets Aztec ${legacyAztec}; the workspace targets ${currentAztec}`;
}

/**
 * The published versions built for `aztec`: the base itself, or a revision of it (`.N` on a
 * prerelease base, `-revision.N` on a stable one). One of these on npm makes a dormant gate stale.
 */
export function publishedFor(versions: readonly string[], aztec: string): string[] {
  const revision = aztec.includes("-") ? `${aztec}.` : `${aztec}-revision.`;
  return versions.filter(
    (v) => v === aztec || (v.startsWith(revision) && /^[1-9]\d*$/.test(v.slice(revision.length))),
  );
}

/**
 * Give the extracted tarball a node_modules that resolves its third-party dependencies through the
 * workspace's exact pinned graphs: the SDK's node_modules first, then core's (the published core
 * needs `ms`). Entries already present, the published siblings, are kept; a scope present in
 * several sources is merged one level down.
 */
async function linkWorkspaceDependencies(target: string, sources: string[]): Promise<void> {
  const missing = (path: string) =>
    lstat(path).then(
      () => false,
      () => true,
    );
  const linkInto = async (dir: string, name: string, from: string) => {
    const to = join(dir, name);
    if (await missing(to)) await symlink(from, to, "dir");
  };
  await mkdir(target, { recursive: true });
  for (const source of sources) {
    for (const entry of await readdir(source)) {
      if (entry.startsWith(".")) continue;
      const from = join(source, entry);
      if (!entry.startsWith("@")) {
        await linkInto(target, entry, from);
        continue;
      }
      // A scope is a real directory so packages from every source can sit side by side.
      const scope = join(target, entry);
      await mkdir(scope, { recursive: true });
      for (const pkg of await readdir(from)) await linkInto(scope, pkg, join(from, pkg));
    }
  }
}

// Prints the installed entry on stdout; prints nothing (and a notice on stderr) when dormant.
if (import.meta.main) {
  const root = resolve(import.meta.dir, "..");
  const directory = await mkdtemp(join(tmpdir(), "presto-legacy-sdk-"));
  const run = (args: string[]) => {
    const result = Bun.spawnSync(args, { cwd: directory, stdout: "pipe", stderr: "pipe" });
    if (result.exitCode !== 0) throw new Error(result.stderr.toString());
    return result.stdout.toString();
  };
  // npm pack refuses a range here: the identity check requires the exact version it returns.
  const packVerified = async (name: string, version: string, integrity: string) => {
    const packed = parseNpmPackResult(
      JSON.parse(run(["npm", "pack", "--ignore-scripts", "--json", `${name}@${version}`])),
      name,
      version,
    );
    const tarball = join(directory, packed.filename);
    const actual = `sha512-${createHash("sha512")
      .update(await readFile(tarball))
      .digest("base64")}`;
    if (actual !== integrity) throw new Error(`${name}@${version} tarball integrity mismatch`);
    return tarball;
  };

  run([
    "tar",
    "-xzf",
    await packVerified(legacy.sdkPackage, legacy.sdkVersion, legacy.sdkIntegrity),
  ]);
  const packageDir = join(directory, "package");
  const manifest = await Bun.file(join(packageDir, "package.json")).json();
  const current = await Bun.file(join(root, "packages/sdk/package.json")).json();
  if (manifest.name !== legacy.sdkPackage || manifest.version !== legacy.sdkVersion) {
    throw new Error("Historical SDK identity mismatch");
  }
  const currentAztec = aztecVersionOf(current);
  const dormant = legacyGate(aztecVersionOf(manifest), currentAztec);
  if (dormant) {
    const listed = JSON.parse(run(["npm", "view", legacy.sdkPackage, "versions", "--json"]));
    const stale = publishedFor(Array.isArray(listed) ? listed : [listed], currentAztec);
    if (stale.length > 0) {
      throw new Error(
        `${legacy.sdkPackage}@${stale.at(-1)} targets Aztec ${currentAztec}: point audit/fixtures/interop-sdk.json at it`,
      );
    }
    // The Actions runner reads workflow commands from stderr as well as stdout.
    console.error(
      `::notice title=Legacy SDK gate dormant::${legacy.sdkPackage}@${legacy.sdkVersion} ${dormant}`,
    );
    process.exit(0);
  }

  // The client under test is the whole publication: its siblings (the transport in core) come from
  // npm at the exact versions it pins, never from workspace source.
  const pinned: Record<string, string> = legacy.sdkDependencies;
  for (const [name, version] of Object.entries<string>(manifest.dependencies ?? {})) {
    if (!name.startsWith("@alejoamiras/")) continue;
    const integrity = pinned[name];
    if (!integrity) throw new Error(`${name} needs an integrity pin in sdkDependencies`);
    const target = join(packageDir, "node_modules", name);
    await mkdir(target, { recursive: true });
    run([
      "tar",
      "-xzf",
      await packVerified(name, version, integrity),
      "-C",
      target,
      "--strip-components=1",
    ]);
  }
  await linkWorkspaceDependencies(join(packageDir, "node_modules"), [
    join(root, "packages/sdk/node_modules"),
    join(root, "packages/sdk-core/node_modules"),
  ]);
  const exports = manifest.exports?.["."] ?? manifest.exports;
  const entry = typeof exports === "string" ? exports : (exports?.import ?? exports?.default);
  if (typeof entry !== "string" || !entry.startsWith("./dist/") || entry.includes("..", 2)) {
    throw new Error("Historical SDK must expose its published dist entry");
  }
  console.log(resolve(packageDir, entry));
}

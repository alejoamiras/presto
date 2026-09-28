import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readdir, readFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import legacy from "../audit/fixtures/legacy-identity.json";
import { aztecVersionOf } from "./aztec-manifest";
import { parseNpmPackResult } from "./npm-pack-result";

/**
 * The published legacy SDK and the workspace must speak one Aztec protocol. Across an Aztec major
 * they cannot interoperate at all, so the gate goes dormant and this returns why; within a major any
 * other difference means a stale fixture, and this throws.
 */
export function legacyGate(legacyAztec: string, currentAztec: string): string | undefined {
  if (legacyAztec === currentAztec) return undefined;
  const major = (version: string) => version.split(".")[0];
  if (major(legacyAztec) !== major(currentAztec)) {
    return `targets Aztec ${legacyAztec}; the workspace targets ${currentAztec}`;
  }
  throw new Error(
    `Legacy interoperability fixture must use the same Aztec protocol version (${legacyAztec} vs ${currentAztec})`,
  );
}

/**
 * Give the extracted tarball a node_modules that resolves the historical SDK's dependencies through
 * the workspace's exact pinned graphs. Entries come from the SDK's node_modules first, then from
 * core's for anything the SDK no longer depends on itself (the transport's `ms`); a scope present
 * in both is merged one level down.
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

  const packed = parseNpmPackResult(
    JSON.parse(
      run([
        "npm",
        "pack",
        "--ignore-scripts",
        "--json",
        `${legacy.sdkPackage}@${legacy.sdkVersion}`,
      ]),
    ),
    legacy.sdkPackage,
    legacy.sdkVersion,
  );
  const tarball = join(directory, packed.filename);
  const integrity = `sha512-${createHash("sha512")
    .update(await readFile(tarball))
    .digest("base64")}`;
  if (integrity !== legacy.sdkIntegrity)
    throw new Error("Historical SDK tarball integrity mismatch");
  run(["tar", "-xzf", tarball]);
  const packageDir = join(directory, "package");
  const manifest = await Bun.file(join(packageDir, "package.json")).json();
  const current = await Bun.file(join(root, "packages/sdk/package.json")).json();
  if (manifest.name !== legacy.sdkPackage || manifest.version !== legacy.sdkVersion) {
    throw new Error("Historical SDK identity mismatch");
  }
  const dormant = legacyGate(aztecVersionOf(manifest), aztecVersionOf(current));
  if (dormant) {
    // The Actions runner reads workflow commands from stderr as well as stdout.
    console.error(
      `::notice title=Legacy SDK gate dormant::${legacy.sdkPackage}@${legacy.sdkVersion} ${dormant}`,
    );
    process.exit(0);
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

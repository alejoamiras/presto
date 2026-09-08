/**
 * Every dependency the consumer host installs beside the candidate (its `host-dependencies.json`:
 * the peers a real consumer must bring) must resolve to ONE copy in the host's tree. A second copy
 * means the packed candidate's own resolution disagrees with the host's — for a peer like
 * `@aztec/bb.js` that is two WASM runtimes and two `Barretenberg` types, the exact hazard a peer
 * dependency exists to prevent.
 *
 *   bun scripts/tarball-consumer/assert-singletons.ts <host-dir> <host-dependencies.json>
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Directory entries (including symlinked packages) of `dir`, or none when it does not exist. */
function subdirectories(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/** Every `node_modules/<name>` directory under `root`, at any depth. */
export function installedCopies(root: string, name: string): string[] {
  const found: string[] = [];
  const visitPackage = (dir: string, packageName: string) => {
    if (packageName === name) found.push(dir);
    visitNodeModules(join(dir, "node_modules"));
  };
  const visitNodeModules = (dir: string) => {
    for (const entry of subdirectories(dir)) {
      if (entry.startsWith(".")) continue;
      // Scoped packages sit one level down; every package may hold its own nested node_modules.
      if (entry.startsWith("@")) {
        for (const pkg of subdirectories(join(dir, entry))) {
          visitPackage(join(dir, entry, pkg), `${entry}/${pkg}`);
        }
      } else visitPackage(join(dir, entry), entry);
    }
  };
  visitNodeModules(join(root, "node_modules"));
  return found;
}

export function assertSingletons(root: string, names: string[]): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const name of names) {
    const copies = installedCopies(root, name);
    if (copies.length !== 1) {
      throw new Error(
        `${name} is installed ${copies.length} times in the consumer host; a peer must be a singleton` +
          (copies.length ? `: ${copies.join(", ")}` : ""),
      );
    }
    resolved[name] = copies[0] as string;
  }
  return resolved;
}

if (import.meta.main) {
  const [hostDir, extrasPath] = process.argv.slice(2);
  if (!hostDir || !extrasPath) {
    console.error("usage: assert-singletons.ts <host-dir> <host-dependencies.json>");
    process.exit(2);
  }
  try {
    const names = Object.keys(JSON.parse(readFileSync(extrasPath, "utf8")));
    for (const [name, path] of Object.entries(assertSingletons(hostDir, names))) {
      console.log(`${name}: one copy at ${path}`);
    }
  } catch (error) {
    console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

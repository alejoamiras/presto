/**
 * After a bootstrap-mode install, prove the candidate resolves a `--with` dependency to the supplied
 * tarball and nothing else: npm keeps a root `file:` copy AND fetches a registry copy beneath the
 * candidate when the pin and the tarball disagree, and the runtime checks would then pass against
 * the wrong artifact. Walks `npm ls <name> --json --all`: exactly one installation, resolved from
 * the tarball.
 *
 *   bun scripts/tarball-consumer/assert-local-dependency.ts <host-dir> <name> <tarball>
 */
import { execFileSync } from "node:child_process";
import { basename } from "node:path";

interface LsNode {
  version?: string;
  resolved?: string;
  dependencies?: Record<string, LsNode>;
}

/**
 * Every installation of `name` in an `npm ls --json --all` tree, at any depth. A deduped reference
 * (a dependant satisfied by an ancestor's copy) is listed with a `version` only; an installation
 * carries `resolved`.
 */
export function installations(tree: LsNode, name: string): LsNode[] {
  const found: LsNode[] = [];
  const walk = (node: LsNode) => {
    for (const [dep, child] of Object.entries(node.dependencies ?? {})) {
      if (dep === name && child.resolved !== undefined) found.push(child);
      walk(child);
    }
  };
  walk(tree);
  return found;
}

export function assertLocalDependency(tree: LsNode, name: string, tarball: string): string {
  const installed = installations(tree, name);
  if (installed.length !== 1) {
    throw new Error(
      `${name} is installed ${installed.length} times; the candidate must resolve the supplied tarball alone`,
    );
  }
  const [only] = installed;
  const resolved = only?.resolved ?? "";
  if (!resolved.startsWith("file:") || basename(resolved) !== basename(tarball)) {
    throw new Error(`${name} resolved from ${resolved || "the registry"}, not ${tarball}`);
  }
  return only?.version ?? "";
}

if (import.meta.main) {
  const [hostDir, name, tarball] = process.argv.slice(2);
  if (!hostDir || !name || !tarball) {
    console.error("usage: assert-local-dependency.ts <host-dir> <name> <tarball>");
    process.exit(2);
  }
  const tree = JSON.parse(
    execFileSync("npm", ["ls", name, "--json", "--all"], { cwd: hostDir, encoding: "utf8" }),
  );
  try {
    console.log(`${name}@${assertLocalDependency(tree, name, tarball)} resolved from the tarball`);
  } catch (error) {
    console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

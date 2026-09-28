/**
 * Compares the Aztec-scoped packages the Aztec CLI installer resolved under an install prefix with
 * the reviewed list that exempts them from npm's release-age gate. The installer resolves unlocked,
 * so a new first-party package already older than the gate installs without the list noticing;
 * only this name comparison catches it, and it must run whether or not the install step was cached.
 * The exemption is by name, so every `@aztec-labs` and `@aztec-foundation` package must also be at
 * the release being installed: any other version skipped the gate unreviewed.
 *
 * The graph is the prefix's `package-lock.json` (every platform's optional packages, which the age
 * gate also filters) joined with what is on disk, so a package missing from the lock still counts.
 *
 * Usage: bun scripts/aztec-installer-graph.ts <install-prefix> <list-file> <aztec-version>
 */

import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const AZTEC_NAME = /^@aztec(?:-labs|-foundation)?\/[a-z0-9][a-z0-9._-]*$/;
/** `@aztec/viem` is Aztec's viem fork at its own version; the release scopes share one. */
const RELEASE_SCOPE = /^@aztec-(?:labs|foundation)\//;

/** Aztec-scoped package name → every version installed or locked under that name. */
export type AztecGraph = Map<string, Set<string>>;

function record(graph: AztecGraph, name: unknown, version: unknown) {
  if (typeof name !== "string" || !AZTEC_NAME.test(name)) return;
  const versions = graph.get(name) ?? new Set<string>();
  versions.add(String(version));
  graph.set(name, versions);
}

/** `read()`, or `undefined` when its path does not exist; any other failure throws. */
function unlessMissing<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;
    if (code === "ENOENT" || code === "ENOTDIR") return undefined;
    throw error;
  }
}

/** Every Aztec-scoped package installed anywhere under `prefix/node_modules`. */
export function installedAztecPackages(prefix: string): AztecGraph {
  const graph: AztecGraph = new Map();
  const visitPackage = (dir: string) => {
    const text = unlessMissing(() => readFileSync(join(dir, "package.json"), "utf8"));
    if (text === undefined) return;
    const { name, version } = JSON.parse(text);
    record(graph, name, version);
    // A symlinked package (a `file:` dependency) is not part of this tree's resolution.
    if (!lstatSync(dir).isSymbolicLink()) walk(join(dir, "node_modules"));
  };
  const walk = (nodeModules: string) => {
    for (const entry of unlessMissing(() => readdirSync(nodeModules)) ?? []) {
      if (entry.startsWith(".")) continue;
      const path = join(nodeModules, entry);
      if (entry.startsWith("@")) {
        for (const scoped of readdirSync(path)) visitPackage(join(path, scoped));
      } else {
        visitPackage(path);
      }
    }
  };
  walk(join(prefix, "node_modules"));
  return graph;
}

/** Every Aztec-scoped package in `prefix/package-lock.json`; throws when the lock is absent. */
export function lockedAztecPackages(prefix: string): AztecGraph {
  const lock = JSON.parse(readFileSync(join(prefix, "package-lock.json"), "utf8")) as {
    packages?: Record<string, { name?: string; version?: string }>;
  };
  const graph: AztecGraph = new Map();
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    if (path === "") continue;
    const name =
      entry.name ?? path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
    record(graph, name, entry.version);
  }
  return graph;
}

export function aztecGraph(prefix: string): AztecGraph {
  const graph = lockedAztecPackages(prefix);
  for (const [name, versions] of installedAztecPackages(prefix)) {
    for (const version of versions) record(graph, name, version);
  }
  return graph;
}

/** The reviewed list: one exact Aztec-scoped name per line, no globs, no duplicates. */
export function parseReviewedList(text: string): string[] {
  const names = text.split("\n").filter((line) => line.trim() !== "");
  for (const name of names) {
    if (!AZTEC_NAME.test(name)) throw new Error(`not an exact Aztec package name: "${name}"`);
  }
  const dup = names.find((name, i) => names.indexOf(name) !== i);
  if (dup) throw new Error(`listed twice: ${dup}`);
  return names;
}

export function compareGraph(graph: AztecGraph, listed: string[], release: string) {
  const installed = [...graph.keys()].sort();
  const offRelease = installed.flatMap((name) =>
    RELEASE_SCOPE.test(name)
      ? [...(graph.get(name) ?? [])].filter((v) => v !== release).map((v) => `${name}@${v}`)
      : [],
  );
  return {
    added: installed.filter((name) => !listed.includes(name)),
    removed: listed.filter((name) => !installed.includes(name)),
    offRelease,
  };
}

if (import.meta.main) {
  const [prefix, listFile, release] = process.argv.slice(2);
  if (!prefix || !listFile || !release) {
    console.error(
      "usage: bun scripts/aztec-installer-graph.ts <install-prefix> <list-file> <aztec-version>",
    );
    process.exit(2);
  }
  const listed = parseReviewedList(readFileSync(listFile, "utf8"));
  const graph = aztecGraph(prefix);
  if (graph.size === 0) {
    console.error(`::error::no Aztec packages found under ${prefix}`);
    process.exit(1);
  }
  const { added, removed, offRelease } = compareGraph(graph, listed, release);
  for (const name of added) {
    console.error(`::error::installed but not in ${listFile} (unreviewed package): ${name}`);
  }
  for (const name of removed) {
    console.error(`::error::in ${listFile} but not installed (stale exemption): ${name}`);
  }
  for (const pkg of offRelease) {
    console.error(`::error::not at Aztec ${release}, so its exemption was not reviewed: ${pkg}`);
  }
  if (added.length > 0 || removed.length > 0 || offRelease.length > 0) process.exit(1);
  console.log(`Aztec installer graph matches ${listFile} at ${release} (${graph.size} names)`);
}

/**
 * Compares the Aztec-scoped packages the Aztec CLI installer resolved under an install prefix with
 * the reviewed list that exempts them from npm's release-age gate. The installer resolves unlocked,
 * so a new first-party package already older than the gate installs without the list noticing;
 * only this name comparison catches it, and it must run whether or not the install step was cached.
 *
 * The graph is the prefix's `package-lock.json` (every platform's optional packages, which the age
 * gate also filters) joined with what is on disk, so a package missing from the lock still counts.
 *
 * Usage: bun scripts/aztec-installer-graph.ts <install-prefix> <list-file>
 */

import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const AZTEC_NAME = /^@aztec(?:-labs|-foundation)?\/[a-z0-9][a-z0-9._-]*$/;

/** Every distinct Aztec-scoped package name installed anywhere under `prefix/node_modules`. */
export function installedAztecNames(prefix: string): string[] {
  const names = new Set<string>();
  const visitPackage = (dir: string) => {
    let name: unknown;
    try {
      name = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).name;
    } catch {
      return;
    }
    if (typeof name === "string" && AZTEC_NAME.test(name)) names.add(name);
    // A symlinked package (a `file:` dependency) is not part of this tree's resolution.
    if (!lstatSync(dir).isSymbolicLink()) walk(join(dir, "node_modules"));
  };
  const walk = (nodeModules: string) => {
    let entries: string[];
    try {
      entries = readdirSync(nodeModules);
    } catch {
      return;
    }
    for (const entry of entries) {
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
  return [...names].sort();
}

/** Every Aztec-scoped name in `prefix/package-lock.json`; throws when the lock is absent. */
export function lockedAztecNames(prefix: string): string[] {
  const lock = JSON.parse(readFileSync(join(prefix, "package-lock.json"), "utf8")) as {
    packages?: Record<string, { name?: string }>;
  };
  const names = new Set<string>();
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    const name =
      entry.name ?? path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
    if (path !== "" && AZTEC_NAME.test(name)) names.add(name);
  }
  return [...names].sort();
}

export function aztecGraph(prefix: string): string[] {
  return [...new Set([...lockedAztecNames(prefix), ...installedAztecNames(prefix)])].sort();
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

export function compareGraph(installed: string[], listed: string[]) {
  return {
    added: installed.filter((name) => !listed.includes(name)),
    removed: listed.filter((name) => !installed.includes(name)),
  };
}

if (import.meta.main) {
  const [prefix, listFile] = process.argv.slice(2);
  if (!prefix || !listFile) {
    console.error("usage: bun scripts/aztec-installer-graph.ts <install-prefix> <list-file>");
    process.exit(2);
  }
  const listed = parseReviewedList(readFileSync(listFile, "utf8"));
  const installed = aztecGraph(prefix);
  if (installed.length === 0) {
    console.error(`::error::no Aztec packages found under ${prefix}`);
    process.exit(1);
  }
  const { added, removed } = compareGraph(installed, listed);
  for (const name of added) {
    console.error(`::error::installed but not in ${listFile} (unreviewed package): ${name}`);
  }
  for (const name of removed) {
    console.error(`::error::in ${listFile} but not installed (stale exemption): ${name}`);
  }
  if (added.length > 0 || removed.length > 0) process.exit(1);
  console.log(`Aztec installer graph matches ${listFile} (${installed.length} names)`);
}

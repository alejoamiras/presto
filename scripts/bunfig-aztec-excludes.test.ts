import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// bunfig.toml's minimumReleaseAgeExcludes must track bun.lock's resolved Aztec graph EXACTLY
// (exact names only — Bun silently ignores globs, and the age filter applies to transitive
// resolution too). The list is hand-maintained on every Aztec bump; this test is the
// enforcement the list's own maintenance comment prescribes, in both directions:
//  - a lock name missing from the excludes would fail the NEXT <7-day-old bump's install;
//  - a stale exclude (name no longer in the lock) silently keeps a permanent age-gate
//    exemption for a package that could re-enter the tree unreviewed.
// Runs under `bun run test:scripts`, which every Aztec bump PR triggers via the SDK pipeline.

const ROOT = join(import.meta.dir, "..");
const AZTEC_NAME = /^@aztec(?:-labs|-foundation)?\/[^"@/]+$/;

function bunfigExcludes(): string[] {
  const toml = readFileSync(join(ROOT, "bunfig.toml"), "utf8");
  const block = toml.match(/minimumReleaseAgeExcludes\s*=\s*\[([\s\S]*?)\]/);
  if (!block?.[1]) throw new Error("minimumReleaseAgeExcludes not found in bunfig.toml");
  return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1] as string);
}

function lockAztecNames(): string[] {
  const lock = readFileSync(join(ROOT, "bun.lock"), "utf8");
  // Resolved entries look like "<scope>/<name>@<version>" (in keys and value tuples alike).
  // [^"@]+ stops the name before the version's @; captures ending in "/" would be nested-path
  // keys, not package names — filter them defensively.
  const names = [...lock.matchAll(/"(@aztec(?:-labs|-foundation)?\/[^"@]+)@/g)]
    .map((m) => m[1] as string)
    .filter((name) => !name.endsWith("/"));
  return [...new Set(names)].sort();
}

describe("bunfig minimumReleaseAgeExcludes", () => {
  const excludes = bunfigExcludes();
  const lockNames = lockAztecNames();

  test("lock parsing found both v6 scopes (pattern-rot guard)", () => {
    expect(lockNames.some((name) => name.startsWith("@aztec-labs/"))).toBe(true);
    expect(lockNames.some((name) => name.startsWith("@aztec-foundation/"))).toBe(true);
  });

  test("only exact Aztec-scoped names are exempted from the age gate", () => {
    const offScope = excludes.filter((name) => !AZTEC_NAME.test(name));
    expect(offScope).toEqual([]);
  });

  test("every resolved Aztec package is excluded (else a <7-day-old bump fails install)", () => {
    const missing = lockNames.filter((name) => !excludes.includes(name));
    expect(missing).toEqual([]);
  });

  test("no stale excludes: every entry still resolves in bun.lock", () => {
    const stale = excludes.filter((name) => !lockNames.includes(name));
    expect(stale).toEqual([]);
  });
});

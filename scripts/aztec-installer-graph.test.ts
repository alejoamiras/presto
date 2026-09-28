import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aztecGraph, compareGraph, parseReviewedList } from "./aztec-installer-graph.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const RELEASE = "6.0.0-rc.1";

/**
 * An install prefix with each `path → name` package on disk and in `package-lock.json`, plus
 * `lockOnly` entries (another platform's optional packages) in the lock alone. Every package is at
 * its reviewed version unless `versions` names another.
 */
function prefix(
  installed: Record<string, string>,
  lockOnly: Record<string, string> = {},
  versions: Record<string, string> = {},
): string {
  const root = mkdtempSync(join(tmpdir(), "aztec-graph-"));
  roots.push(root);
  const version = (path: string) => versions[path] ?? (path === VIEM ? "2.38.3" : RELEASE);
  for (const [path, name] of Object.entries(installed)) {
    mkdirSync(join(root, path), { recursive: true });
    writeFileSync(
      join(root, path, "package.json"),
      JSON.stringify({ name, version: version(path) }),
    );
  }
  const packages = Object.fromEntries(
    Object.keys({ ...installed, ...lockOnly }).map((path) => [path, { version: version(path) }]),
  );
  writeFileSync(
    join(root, "package-lock.json"),
    JSON.stringify({ packages: { "": {}, ...packages } }),
  );
  return root;
}

const VIEM = "node_modules/@aztec-labs/aztec/node_modules/@aztec/viem";
const INSTALLED = {
  "node_modules/@aztec-labs/aztec": "@aztec-labs/aztec",
  [VIEM]: "@aztec/viem",
  "node_modules/snappy": "snappy",
};
const OTHER_PLATFORM = { "node_modules/@aztec-foundation/wsdb-darwin-arm64": "" };
const LISTED = ["@aztec-foundation/wsdb-darwin-arm64", "@aztec-labs/aztec", "@aztec/viem"];
const clean = { added: [], removed: [], offRelease: [] };

describe("installer graph check", () => {
  test("lock and disk together match the list: nested, three scopes, other platforms", () => {
    const graph = aztecGraph(prefix(INSTALLED, OTHER_PLATFORM));
    expect([...graph.keys()].sort()).toEqual(LISTED);
    expect(compareGraph(graph, LISTED, RELEASE)).toEqual(clean);
  });

  test("names an unlisted package, however long ago it was published", () => {
    // The age gate let it in (it cleared quarantine), so only the name comparison sees it. It
    // is on disk but absent from the lock, which must not hide it either.
    const root = prefix(INSTALLED, OTHER_PLATFORM);
    const extra = join(root, "node_modules/@aztec-labs/old-new");
    mkdirSync(extra, { recursive: true });
    writeFileSync(
      join(extra, "package.json"),
      JSON.stringify({ name: "@aztec-labs/old-new", version: RELEASE }),
    );
    expect(compareGraph(aztecGraph(root), LISTED, RELEASE)).toEqual({
      ...clean,
      added: ["@aztec-labs/old-new"],
    });
  });

  test("names a listed package the tree no longer resolves", () => {
    expect(compareGraph(aztecGraph(prefix(INSTALLED)), LISTED, RELEASE)).toEqual({
      ...clean,
      removed: ["@aztec-foundation/wsdb-darwin-arm64"],
    });
  });

  test("names a listed package at any version but its reviewed one, which its exemption let skip the gate", () => {
    const nested =
      "node_modules/@aztec-labs/aztec/node_modules/@aztec-foundation/wsdb-darwin-arm64";
    const graph = aztecGraph(
      prefix(
        INSTALLED,
        { ...OTHER_PLATFORM, [nested]: "" },
        { [nested]: "6.0.0-rc.2", [VIEM]: RELEASE },
      ),
    );
    expect(compareGraph(graph, LISTED, RELEASE)).toEqual({
      ...clean,
      offRelease: ["@aztec-foundation/wsdb-darwin-arm64@6.0.0-rc.2", `@aztec/viem@${RELEASE}`],
    });
  });

  test("an unreadable package manifest fails the check instead of hiding the package", () => {
    const root = prefix(INSTALLED, OTHER_PLATFORM);
    writeFileSync(join(root, "node_modules/@aztec-labs/aztec/package.json"), "{");
    expect(() => aztecGraph(root)).toThrow();
  });

  test("the list takes exact names only", () => {
    expect(() => parseReviewedList("@aztec-labs/*\n")).toThrow("not an exact Aztec package name");
    expect(() => parseReviewedList("left-pad\n")).toThrow("not an exact Aztec package name");
    expect(() => parseReviewedList("@aztec/viem\n@aztec/viem\n")).toThrow("listed twice");
  });
});

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aztecGraph, compareGraph, parseReviewedList } from "./aztec-installer-graph.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/**
 * An install prefix with each `path → name` package on disk and in `package-lock.json`, plus
 * `lockOnly` entries (another platform's optional packages) in the lock alone.
 */
function prefix(installed: Record<string, string>, lockOnly: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "aztec-graph-"));
  roots.push(root);
  for (const [path, name] of Object.entries(installed)) {
    mkdirSync(join(root, path), { recursive: true });
    writeFileSync(join(root, path, "package.json"), JSON.stringify({ name, version: "1.0.0" }));
  }
  const packages = Object.fromEntries(
    Object.entries({ ...installed, ...lockOnly }).map(([path]) => [path, { version: "1.0.0" }]),
  );
  writeFileSync(
    join(root, "package-lock.json"),
    JSON.stringify({ packages: { "": {}, ...packages } }),
  );
  return root;
}

const INSTALLED = {
  "node_modules/@aztec-labs/aztec": "@aztec-labs/aztec",
  "node_modules/@aztec-labs/aztec/node_modules/@aztec/viem": "@aztec/viem",
  "node_modules/snappy": "snappy",
};
const OTHER_PLATFORM = { "node_modules/@aztec-foundation/wsdb-darwin-arm64": "" };
const LISTED = ["@aztec-foundation/wsdb-darwin-arm64", "@aztec-labs/aztec", "@aztec/viem"];

describe("installer graph check", () => {
  test("lock and disk together match the list: nested, three scopes, other platforms", () => {
    const graph = aztecGraph(prefix(INSTALLED, OTHER_PLATFORM));
    expect(graph).toEqual(LISTED);
    expect(compareGraph(graph, LISTED)).toEqual({ added: [], removed: [] });
  });

  test("names an unlisted package, however long ago it was published", () => {
    // The age gate let it in (it cleared quarantine), so only the name comparison sees it. It
    // is on disk but absent from the lock, which must not hide it either.
    const root = prefix(INSTALLED, OTHER_PLATFORM);
    const extra = join(root, "node_modules/@aztec-labs/old-new");
    mkdirSync(extra, { recursive: true });
    writeFileSync(join(extra, "package.json"), JSON.stringify({ name: "@aztec-labs/old-new" }));
    expect(compareGraph(aztecGraph(root), LISTED)).toEqual({
      added: ["@aztec-labs/old-new"],
      removed: [],
    });
  });

  test("names a listed package the tree no longer resolves", () => {
    expect(compareGraph(aztecGraph(prefix(INSTALLED)), LISTED)).toEqual({
      added: [],
      removed: ["@aztec-foundation/wsdb-darwin-arm64"],
    });
  });

  test("the list takes exact names only", () => {
    expect(() => parseReviewedList("@aztec-labs/*\n")).toThrow("not an exact Aztec package name");
    expect(() => parseReviewedList("left-pad\n")).toThrow("not an exact Aztec package name");
    expect(() => parseReviewedList("@aztec/viem\n@aztec/viem\n")).toThrow("listed twice");
  });
});

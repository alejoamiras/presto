import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertSingletons, installedCopies } from "./assert-singletons";

let host: string;
beforeAll(() => {
  host = mkdtempSync(join(tmpdir(), "presto-singletons-"));
  // Root copies of a scoped peer and a plain package, plus a nested duplicate under the candidate.
  for (const dir of [
    "node_modules/@aztec-foundation/bb.js",
    "node_modules/pako",
    "node_modules/@alejoamiras/presto-noir/node_modules/pako",
    "node_modules/@alejoamiras/presto-noir/node_modules/@aztec-labs/other",
    "node_modules/.bin",
  ]) {
    mkdirSync(join(host, dir), { recursive: true });
  }
});
afterAll(() => rmSync(host, { recursive: true, force: true }));

test("a peer installed once passes; a nested duplicate fails with both paths named", () => {
  expect(installedCopies(host, "@aztec-foundation/bb.js")).toHaveLength(1);
  expect(assertSingletons(host, ["@aztec-foundation/bb.js"])["@aztec-foundation/bb.js"]).toEndWith(
    "node_modules/@aztec-foundation/bb.js",
  );
  expect(installedCopies(host, "pako")).toHaveLength(2);
  expect(() => assertSingletons(host, ["pako"])).toThrow(/pako is installed 2 times.*presto-noir/);
  expect(() => assertSingletons(host, ["@aztec-labs/missing"])).toThrow("installed 0 times");
});

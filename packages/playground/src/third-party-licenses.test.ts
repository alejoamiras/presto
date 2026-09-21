import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LICENSE_FALLBACKS } from "../licensing/license-fallbacks.ts";
import { collectNotices, packageRootOf, renderNotices } from "../licensing/third-party-licenses.ts";

const tree = mkdtempSync(join(tmpdir(), "presto-licenses-"));
afterAll(() => rmSync(tree, { recursive: true, force: true }));

function install(path: string, manifest: object, files: Record<string, string> = {}): string {
  const root = join(tree, "node_modules", path);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify(manifest));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(root, name), body);
  return join(root, "dist", "index.js");
}

describe("packageRootOf", () => {
  test("resolves the innermost package, scoped or not, through Bun's store layout", () => {
    expect(packageRootOf("/r/node_modules/.bun/a@1/node_modules/@s/pkg/dist/x.js?worker")).toBe(
      "/r/node_modules/.bun/a@1/node_modules/@s/pkg",
    );
    expect(packageRootOf("\0/r/node_modules/plain/index.js")).toBe("/r/node_modules/plain");
    expect(packageRootOf("C:\\r\\node_modules\\plain\\index.js")).toBe("C:/r/node_modules/plain");
  });

  test("ignores first-party and virtual modules", () => {
    expect(packageRootOf("/r/packages/playground/src/main.ts")).toBeUndefined();
    expect(packageRootOf("\0virtual:noir-fixture")).toBeUndefined();
  });
});

describe("collectNotices", () => {
  test("reproduces shipped LICENSE and NOTICE files once per package, sorted", () => {
    const zed = install(
      "zed",
      { name: "zed", version: "2.0.0", license: "MIT" },
      { LICENSE: "zed terms" },
    );
    const dual = install(
      "@s/dual",
      { name: "@s/dual", version: "1.0.0", license: "Apache-2.0" },
      { "LICENSE.md": "apache terms", NOTICE: "attribution", "README.md": "not a licence" },
    );
    const notices = collectNotices([zed, dual, `${dual}?v=1`, "/r/src/own.ts"]);
    expect(notices.map((n) => n.name)).toEqual(["@s/dual", "zed"]);
    expect(notices[0].texts).toEqual([
      { file: "LICENSE.md", text: "apache terms" },
      { file: "NOTICE", text: "attribution" },
    ]);
    expect(renderNotices(notices)).toContain("zed 2.0.0\nLicense: MIT");
  });

  test("fails closed, naming every package whose terms cannot be reproduced", () => {
    const a = install("bare-a", { name: "bare-a", version: "1.0.0", license: "MIT" });
    const b = install("bare-b", { name: "bare-b", version: "3.1.0" });
    expect(() => collectNotices([a, b], LICENSE_FALLBACKS)).toThrow(
      /bare-a@1\.0\.0, bare-b@3\.1\.0/,
    );
  });

  test("falls back to the vendored upstream text, keeping a declared licence and the note", () => {
    const stdlib = install("@aztec/stdlib", { name: "@aztec/stdlib", version: "5.2.0" });
    const bb = install("@aztec/bb.js", { name: "@aztec/bb.js", version: "5.2.0", license: "MIT" });
    const abi = install("@aztec/noir-noirc_abi", {
      name: "@aztec/noir-noirc_abi",
      version: "5.2.0",
      license: "(MIT OR Apache-2.0)",
    });
    const [bbNotice, abiNotice, stdlibNotice] = collectNotices(
      [stdlib, bb, abi],
      LICENSE_FALLBACKS,
    );

    expect(stdlibNotice.license).toBe("Apache-2.0");
    expect(stdlibNotice.texts[0].file).toContain("aztec-packages/blob/v5.2.0/LICENSE");
    expect(stdlibNotice.texts[0].text).toContain("Apache License");

    expect(bbNotice.license).toBe("MIT");
    expect(bbNotice.note).toContain("declares MIT");
    expect(abiNotice.texts.map((t) => t.text.split("\n")[0].trim())).toEqual([
      "MIT License",
      "Apache License",
    ]);
  });
});

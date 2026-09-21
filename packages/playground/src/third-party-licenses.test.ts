import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LICENSE_POLICY } from "../licensing/license-fallbacks.ts";
import { collectNotices, packageRootOf, renderNotices } from "../licensing/third-party-licenses.ts";

const TERMS =
  "Permission is hereby granted, free of charge, to any person obtaining a copy. ".repeat(2);
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
      { LICENSE: `zed ${TERMS}` },
    );
    const dual = install(
      "@s/dual",
      { name: "@s/dual", version: "1.0.0", license: "Apache-2.0" },
      { "LICENSE.md": `apache ${TERMS}`, NOTICE: "attribution", "README.md": "not a licence" },
    );
    const notices = collectNotices([zed, dual, `${dual}?v=1`, "/r/src/own.ts"]);
    expect(notices.map((n) => n.name)).toEqual(["@s/dual", "zed"]);
    expect(notices[0].texts).toEqual([
      { file: "LICENSE.md", text: `apache ${TERMS}`.trim() },
      { file: "NOTICE", text: "attribution" },
    ]);
    expect(renderNotices(notices)).toContain("zed 2.0.0\nLicense: MIT");
  });

  test("fails closed, naming every package whose terms cannot be reproduced", () => {
    const a = install("bare-a", { name: "bare-a", version: "1.0.0", license: "MIT" });
    // Attribution, an empty file and a bare SPDX id are not terms.
    const b = install(
      "bare-b",
      { name: "bare-b", version: "3.1.0" },
      { NOTICE: `credit ${TERMS}`, LICENSE: "", "LICENSE.spdx": "MIT" },
    );
    expect(() => collectNotices([a, b], LICENSE_POLICY)).toThrow(/bare-a@1\.0\.0, bare-b@3\.1\.0/);
  });
});

describe("licence policy", () => {
  test("adds a host's reviewed inlined packages, and fails when its source maps disagree", () => {
    const map = (sources: string[]) => JSON.stringify({ sources });
    const pnpm = (name: string, version: string) =>
      `../../../node_modules/.pnpm/${name}@${version}/node_modules/${name}/index.js`;
    const reviewed = [
      pnpm("base64-js", "1.5.1"),
      pnpm("ieee754", "1.2.1"),
      "../../../node_modules/.pnpm/buffer@6.0.3_patch_hash=abc/node_modules/buffer/index.js",
      "../index.ts",
    ];
    const host = install(
      "vite-plugin-node-polyfills",
      { name: "vite-plugin-node-polyfills", version: "0.28.0", license: "MIT" },
      { LICENSE: TERMS },
    );
    const shims = join(tree, "node_modules/vite-plugin-node-polyfills/shims");
    const write = (shim: string, sources: string[]) => {
      mkdirSync(join(shims, shim, "dist"), { recursive: true });
      writeFileSync(join(shims, shim, "dist/index.js.map"), map(sources));
    };
    write("buffer", reviewed);
    write("global", ["../index.ts"]);
    write("process", [pnpm("process", "0.11.10")]);

    const notices = collectNotices([host], LICENSE_POLICY);
    expect(notices.map((n) => `${n.name}@${n.version} ${n.license}`)).toEqual([
      "base64-js@1.5.1 MIT",
      "buffer@6.0.3 MIT",
      "ieee754@1.2.1 BSD-3-Clause",
      "process@0.11.10 MIT",
      "vite-plugin-node-polyfills@0.28.0 MIT",
    ]);

    write("process", [pnpm("process", "0.12.0"), pnpm("@scope+extra", "2.0.0")]);
    expect(() => collectNotices([host], LICENSE_POLICY)).toThrow(
      /re-check: @scope\/extra@2\.0\.0, process@0\.11\.10, process@0\.12\.0/,
    );
  });

  test("a conjunctive licence needs a reviewed supplement for the half its file omits", () => {
    const pako = install(
      "pako",
      { name: "pako", version: "2.2.0", license: "(MIT AND Zlib)" },
      { LICENSE: TERMS },
    );
    const other = install(
      "both",
      { name: "both", version: "1.0.0", license: "MIT AND ISC" },
      { LICENSE: TERMS },
    );
    const [notice] = collectNotices([pako], LICENSE_POLICY);
    expect(notice.texts.map((t) => t.text).join("\n")).toContain("Jean-loup Gailly");
    expect(() => collectNotices([other], LICENSE_POLICY)).toThrow(/both@1\.0\.0 \(MIT AND ISC\)/);
  });

  test("falls back to the vendored upstream text, keeping a declared licence and the note", () => {
    const stdlib = install("@aztec/stdlib", { name: "@aztec/stdlib", version: "5.2.0" });
    const bb = install("@aztec/bb.js", { name: "@aztec/bb.js", version: "5.2.0", license: "MIT" });
    const abi = install("@aztec/noir-noirc_abi", {
      name: "@aztec/noir-noirc_abi",
      version: "5.2.0",
      license: "(MIT OR Apache-2.0)",
    });
    // Aztec's own package despite the `noir-` prefix: must not inherit noir-lang's terms.
    const circuits = install("@aztec/noir-protocol-circuits-types", {
      name: "@aztec/noir-protocol-circuits-types",
      version: "5.2.0",
    });
    const [bbNotice, abiNotice, circuitsNotice, stdlibNotice] = collectNotices(
      [stdlib, bb, abi, circuits],
      LICENSE_POLICY,
    );
    expect(circuitsNotice.license).toBe("Apache-2.0");

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

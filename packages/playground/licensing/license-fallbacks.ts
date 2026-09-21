import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { LicenseFallback } from "./third-party-licenses.ts";

const text = (file: string) => readFileSync(join(import.meta.dirname, "licenses", file), "utf8");

const NOIR = "https://github.com/noir-lang/noir";
const AZTEC = "https://github.com/AztecProtocol/aztec-packages";
const NOIR_MIT_ONLY = new Set(["@aztec/noir-acvm_js"]);

/**
 * Upstream licence texts for bundled packages that publish none. Every `@aztec/*` package ships
 * without a licence file, and most without a `license` field, so the texts are vendored from the
 * repositories the packages are built from. A package no rule matches fails the build.
 */
export const LICENSE_FALLBACKS: readonly LicenseFallback[] = [
  {
    match: (name) => NOIR_MIT_ONLY.has(name),
    license: "MIT",
    source: () => `${NOIR}/blob/master/LICENSE-MIT`,
    texts: [text("noir-MIT.txt")],
  },
  {
    // Aztec's republished builds of noir-lang/noir packages, dual-licensed upstream.
    match: (name) => name.startsWith("@aztec/noir-") && !name.startsWith("@aztec/noir-contracts"),
    license: "MIT OR Apache-2.0",
    source: () => `${NOIR} (LICENSE-MIT, LICENSE-APACHE)`,
    texts: [text("noir-MIT.txt"), text("noir-APACHE-2.0.txt")],
  },
  {
    match: (name) => name === "@aztec/bb.js",
    license: "Apache-2.0",
    source: (version) => `${AZTEC}/blob/v${version}/barretenberg/LICENSE`,
    note: "the package manifest declares MIT, but the only licence text its source directory publishes is the Apache-2.0 text below.",
    texts: [text("barretenberg-APACHE-2.0.txt")],
  },
  {
    match: (name) => name === "@aztec/sqlite3mc-wasm",
    license: "Apache-2.0 AND MIT",
    source: (version) =>
      `${AZTEC}/blob/v${version}/LICENSE and https://github.com/utelle/SQLite3MultipleCiphers/blob/main/LICENSE`,
    note: "Aztec's packaging of SQLite3 Multiple Ciphers (MIT). The SQLite library itself is public domain, and the Emscripten glue keeps its own notice inside the bundled script.",
    texts: [text("aztec-packages-APACHE-2.0.txt"), text("sqlite3mc-MIT.txt")],
  },
  {
    match: (name) => name.startsWith("@aztec/"),
    license: "Apache-2.0",
    source: (version) => `${AZTEC}/blob/v${version}/LICENSE`,
    texts: [text("aztec-packages-APACHE-2.0.txt")],
  },
  {
    match: (name) => name === "hash.js",
    license: "MIT",
    source: () => "the LICENSE section of the package's own README.md",
    texts: [text("hash.js-MIT.txt")],
  },
];

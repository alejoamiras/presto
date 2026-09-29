import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  EmbeddedComponents,
  LicenseFallback,
  LicensePolicy,
  LicenseSupplement,
} from "./third-party-licenses.ts";

const text = (file: string) => readFileSync(join(import.meta.dirname, "licenses", file), "utf8");

const NOIR = "https://github.com/noir-lang/noir";
const AZTEC = "https://github.com/AztecProtocol/aztec-packages";
// Reviewed against these upstream revisions; the texts are not re-fetched on a version bump.
const AZTEC_TAG = "v6.0.0-rc.1";
// Aztec's republished builds of noir-lang/noir packages, named one by one: other `@aztec-labs/noir-*`
// packages (protocol circuits, contracts) are Aztec's own and fall through to the Aztec rule.
const NOIR_MIT = new Set(["@aztec-foundation/noir-acvm_js"]);
const NOIR_DUAL = new Set([
  "@aztec-foundation/noir-noirc_abi",
  "@aztec-foundation/noir-noir_codegen",
  "@aztec-foundation/noir-types",
]);
// Aztec's own aztec-packages builds published under the foundation scope (Apache-2.0 sources), named
// one by one so a new foundation package still fails the build until reviewed.
const AZTEC_FOUNDATION_OWN = new Set(["@aztec-foundation/l1-artifacts"]);

/**
 * Upstream licence texts for bundled packages that publish none. The Aztec packages built from
 * aztec-packages and noir ship without a licence file, and most without a `license` field, so the
 * texts are vendored from those repositories. A package no rule matches fails the build.
 */
const LICENSE_FALLBACKS: readonly LicenseFallback[] = [
  {
    match: (name) => NOIR_MIT.has(name),
    license: "MIT",
    source: `${NOIR}/blob/master/LICENSE-MIT`,
    texts: [text("noir-MIT.txt")],
  },
  {
    match: (name) => NOIR_DUAL.has(name),
    license: "MIT OR Apache-2.0",
    source: `${NOIR} (LICENSE-MIT, LICENSE-APACHE)`,
    texts: [text("noir-MIT.txt"), text("noir-APACHE-2.0.txt")],
  },
  {
    match: (name) => name === "@aztec-foundation/bb.js",
    license: "Apache-2.0",
    source: `${AZTEC}/blob/${AZTEC_TAG}/barretenberg/LICENSE`,
    note: "the package manifest declares MIT, but the only licence text its source directory publishes is the Apache-2.0 text below.",
    texts: [text("barretenberg-APACHE-2.0.txt")],
  },
  {
    match: (name) => name === "@aztec-labs/sqlite3mc-wasm",
    license: "Apache-2.0 AND MIT AND (MIT OR NCSA)",
    source: `${AZTEC}/blob/${AZTEC_TAG}/LICENSE, https://github.com/utelle/SQLite3MultipleCiphers/blob/main/LICENSE and https://github.com/emscripten-core/emscripten/blob/main/LICENSE`,
    note: "Aztec's packaging of SQLite3 Multiple Ciphers (MIT), built with Emscripten, whose glue code is in the bundled script (MIT or NCSA). The SQLite library itself is public domain.",
    texts: [
      text("aztec-packages-APACHE-2.0.txt"),
      text("sqlite3mc-MIT.txt"),
      text("emscripten-MIT-NCSA.txt"),
    ],
  },
  {
    match: (name) => name.startsWith("@aztec-labs/") || AZTEC_FOUNDATION_OWN.has(name),
    license: "Apache-2.0",
    source: `${AZTEC}/blob/${AZTEC_TAG}/LICENSE`,
    texts: [text("aztec-packages-APACHE-2.0.txt")],
  },
  {
    match: (name) => name === "hash.js",
    license: "MIT",
    source: "the LICENSE section of the package's own README.md",
    texts: [text("hash.js-MIT.txt")],
  },
];

const SUPPLEMENTS: readonly LicenseSupplement[] = [
  {
    // Declares `MIT AND Zlib`; its LICENSE is MIT only, the zlib terms sit in lib/zlib/*.js headers.
    match: (name) => name === "pako",
    source: "the header of the package's own lib/zlib/*.js sources",
    texts: [text("pako-zlib.txt")],
  },
];

const npm = (name: string, version: string) => `https://www.npmjs.com/package/${name}/v/${version}`;
const inlined = (name: string, version: string, license: string, file: string) => ({
  name,
  version,
  license,
  source: `${npm(name, version)} (LICENSE)`,
  texts: [text(file)],
});

const EMBEDDED: readonly EmbeddedComponents[] = [
  {
    host: "vite-plugin-node-polyfills",
    sourceMaps: [
      "shims/buffer/dist/index.js.map",
      "shims/global/dist/index.js.map",
      "shims/process/dist/index.js.map",
    ],
    components: [
      inlined("base64-js", "1.5.1", "MIT", "base64-js-1.5.1.txt"),
      inlined("buffer", "6.0.3", "MIT", "buffer-6.0.3-MIT.txt"),
      inlined("ieee754", "1.2.1", "BSD-3-Clause", "ieee754-1.2.1.txt"),
      inlined("process", "0.11.10", "MIT", "process-0.11.10.txt"),
    ],
  },
];

export const LICENSE_POLICY: LicensePolicy = {
  fallbacks: LICENSE_FALLBACKS,
  supplements: SUPPLEMENTS,
  embedded: EMBEDDED,
};

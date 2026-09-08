// Preload for the suites outside the hermetic unit chain: log configuration and the fixture loader.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { VerifierTarget } from "@aztec/bb.js";
import { configure, getConsoleSink, parseLogLevel } from "@logtape/logtape";

await configure({
  sinks: { console: getConsoleSink() },
  loggers: [
    { category: ["logtape", "meta"], sinks: ["console"], lowestLevel: "warning" },
    {
      category: ["presto"],
      sinks: ["console"],
      lowestLevel: parseLogLevel(process.env.LOG_LEVEL || "warning"),
    },
  ],
});

export const FIXTURE_NAMES = ["square", "nopub"] as const;

export interface NoirFixture {
  name: string;
  bytecode: string;
  witness: Uint8Array;
  vk: Uint8Array;
  proof: Uint8Array;
  publicInputs: Uint8Array;
  verifierTarget: VerifierTarget;
}

/** One committed fixture (`fixtures/noir/<name>`), or any directory with the same file layout. */
export function loadFixture(dir: string, name = dir.split("/").at(-1) ?? dir): NoirFixture {
  const read = (file: string) => new Uint8Array(readFileSync(join(dir, file)));
  const artifact = JSON.parse(readFileSync(join(dir, "circuit.json"), "utf8"));
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  return {
    name,
    bytecode: artifact.bytecode,
    witness: read("witness.gz"),
    vk: read("vk"),
    proof: read("proof"),
    publicInputs: read("public_inputs"),
    verifierTarget: manifest.verifierTarget,
  };
}

export const fixtureDir = (name: string) =>
  resolve(import.meta.dir, "..", "..", "..", "fixtures", "noir", name);

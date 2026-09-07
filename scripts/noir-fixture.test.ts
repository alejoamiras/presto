import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildManifest,
  FIXTURE_NAMES,
  type FixtureFiles,
  fieldCount,
  fixtureDir,
  publicInputsToBytes,
  readFixtureFiles,
  verifyManifest,
} from "./noir-fixture";

const toolchain = { nargo: "1.0.0-beta.25", bbJs: "5.2.0", backend: "WasmWorker" as const };
const text = (s: string) => new TextEncoder().encode(s);

function syntheticFiles(publicInputFields = 2): FixtureFiles {
  return {
    "Nargo.toml": text('[package]\nname = "t"\n'),
    "Prover.toml": text('x = "3"\n'),
    "src/main.nr": text("fn main(x: Field) {}\n"),
    "circuit.json": text(JSON.stringify({ bytecode: "H4sI" })),
    "witness.gz": new Uint8Array([0x1f, 0x8b, 0x08, 0x00]),
    vk: new Uint8Array(96).fill(7),
    proof: new Uint8Array(32 * 3).fill(1),
    public_inputs: new Uint8Array(32 * publicInputFields).fill(2),
  };
}

test("a built manifest verifies clean, including a circuit with zero public inputs", () => {
  for (const fields of [2, 0]) {
    const files = syntheticFiles(fields);
    const manifest = buildManifest("t", "noir-recursive-no-zk", toolchain, files);
    expect(manifest.files.proof?.fields).toBe(3);
    expect(manifest.files.public_inputs?.fields).toBe(fields);
    expect(verifyManifest(manifest, files, "5.2.0")).toEqual([]);
  }
});

test("tampering, misalignment, missing files, stale toolchain, and bad targets are reported", () => {
  const files = syntheticFiles();
  const manifest = buildManifest("t", "noir-recursive-no-zk", toolchain, files);

  const tampered = { ...files, proof: new Uint8Array(files.proof as Uint8Array) };
  (tampered.proof as Uint8Array).fill(0xff, 5, 6);
  expect(verifyManifest(manifest, tampered, "5.2.0")).toEqual(["proof: sha256 mismatch"]);

  const misaligned = { ...files, proof: new Uint8Array(33) };
  expect(verifyManifest(manifest, misaligned, "5.2.0").join("\n")).toContain(
    "not whole 32-byte fields",
  );

  const { vk: _vk, ...missing } = files;
  expect(verifyManifest(manifest, missing, "5.2.0")).toEqual([
    "vk: listed in the manifest but missing on disk",
  ]);

  expect(verifyManifest(manifest, files, "5.3.0").join("\n")).toContain("regenerate");
  expect(verifyManifest({ ...manifest, verifierTarget: "evm-fast" }, files).join("\n")).toContain(
    "unknown verifier target",
  );
  expect(
    verifyManifest({ ...manifest, toolchain: { ...toolchain, backend: "Wasm" } }, files).join("\n"),
  ).toContain("WasmWorker");
  expect(verifyManifest({ hello: 1 }, files)).toEqual([
    "manifest: not a presto/noir-fixture@1 document",
  ]);
  expect(() =>
    buildManifest("t", "noir-recursive-no-zk", toolchain, { ...files, proof: new Uint8Array(1) }),
  ).toThrow("whole number");
  expect(() => fieldCount("x", 64)).not.toThrow();
});

test("bb.js hex public inputs round-trip to raw 32-byte fields", () => {
  const hex = `0x${"ab".repeat(32)}`;
  const bytes = publicInputsToBytes([hex, hex]);
  expect(bytes.length).toBe(64);
  expect(bytes[0]).toBe(0xab);
  expect(publicInputsToBytes([]).length).toBe(0);
  expect(() => publicInputsToBytes(["0x1234"])).toThrow("expected 32");
});

test("the committed fixtures verify against their manifests", () => {
  const root = join(import.meta.dirname, "..");
  for (const name of FIXTURE_NAMES) {
    const dir = fixtureDir(root, name);
    const manifestPath = join(dir, "manifest.json");
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(verifyManifest(manifest, readFixtureFiles(dir))).toEqual([]);
    expect(manifest.verifierTarget).toBe("noir-recursive-no-zk");
  }
});

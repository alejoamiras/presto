#!/usr/bin/env bun
/**
 * Noir fixture circuits for the UltraHonk route (`fixtures/noir/<name>/`).
 *
 * `--verify` (default, runs in CI): every committed artifact matches its manifest, the proof and
 * public-input files are whole 32-byte fields, and the recorded bb.js version is the installed one —
 * so an Aztec bump fails here until the fixtures are regenerated.
 *
 * `--regenerate [name…]` (dev box only): recompiles with `aztec-nargo`, re-executes the witness, and
 * re-proves with bb.js WASM (`WasmWorker`, never the native backend Node prefers) so the committed
 * `vk`/`proof`/`public_inputs` are the WASM reference that native bb must reproduce byte for byte.
 * Only `*-no-zk` targets are deterministic; the manifest records the target every consumer must pass.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { dirname, join } from "node:path";
import { resolveAztecBb } from "../packages/presto/scripts/copy-bb.ts";

export const FIXTURE_SCHEMA = "presto/noir-fixture@1";
export const FIXTURE_ROOT = "fixtures/noir";
export const FIXTURE_NAMES = ["square", "nopub"] as const;
/** The only deterministic family the plan certifies for byte identity. */
export const FIXTURE_TARGET = "noir-recursive-no-zk";
export const VERIFIER_TARGETS = [
  "evm",
  "evm-no-zk",
  "noir-recursive",
  "noir-recursive-no-zk",
  "noir-rollup",
  "noir-rollup-no-zk",
  "starknet",
  "starknet-no-zk",
] as const;
export const FIELD_BYTES = 32;
export const SOURCE_FILES = ["Nargo.toml", "Prover.toml", "src/main.nr"] as const;
export const ARTIFACT_FILES = [
  "circuit.json",
  "witness.gz",
  "vk",
  "proof",
  "public_inputs",
] as const;
const FIELD_FILES = new Set<string>(["proof", "public_inputs"]);
const GZIP_MAGIC = [0x1f, 0x8b];

export interface FixtureFile {
  sha256: string;
  bytes: number;
  /** Only for `proof` and `public_inputs`: `bytes / 32`. */
  fields?: number;
}

export interface FixtureToolchain {
  nargo: string;
  bbJs: string;
  backend: "WasmWorker";
}

export interface FixtureManifest {
  schema: typeof FIXTURE_SCHEMA;
  name: string;
  verifierTarget: string;
  toolchain: FixtureToolchain;
  files: Record<string, FixtureFile>;
}

export type FixtureFiles = Record<string, Uint8Array>;

export function sha256Hex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Field count for a proof/public-input blob; throws on a partial field. */
export function fieldCount(name: string, bytes: number): number {
  if (bytes % FIELD_BYTES !== 0) {
    throw new Error(`${name}: ${bytes} bytes is not a whole number of ${FIELD_BYTES}-byte fields`);
  }
  return bytes / FIELD_BYTES;
}

export function buildManifest(
  name: string,
  verifierTarget: string,
  toolchain: FixtureToolchain,
  files: FixtureFiles,
): FixtureManifest {
  const entries: Record<string, FixtureFile> = {};
  for (const file of [...SOURCE_FILES, ...ARTIFACT_FILES]) {
    const data = files[file];
    if (!data) throw new Error(`${name}: missing ${file}`);
    const entry: FixtureFile = { sha256: sha256Hex(data), bytes: data.length };
    if (FIELD_FILES.has(file)) entry.fields = fieldCount(file, data.length);
    entries[file] = entry;
  }
  return { schema: FIXTURE_SCHEMA, name, verifierTarget, toolchain, files: entries };
}

function isManifestShape(value: unknown): value is FixtureManifest {
  if (!value || typeof value !== "object") return false;
  const m = value as Record<string, unknown>;
  return (
    m.schema === FIXTURE_SCHEMA &&
    typeof m.name === "string" &&
    typeof m.verifierTarget === "string" &&
    typeof m.toolchain === "object" &&
    m.toolchain !== null &&
    typeof m.files === "object" &&
    m.files !== null
  );
}

function checkEntry(file: string, entry: FixtureFile, data: Uint8Array | undefined): string[] {
  if (!data) return [`${file}: listed in the manifest but missing on disk`];
  const problems: string[] = [];
  if (entry.bytes !== data.length)
    problems.push(`${file}: ${data.length} bytes, manifest says ${entry.bytes}`);
  if (entry.sha256 !== sha256Hex(data)) problems.push(`${file}: sha256 mismatch`);
  if (FIELD_FILES.has(file)) {
    const fields = data.length % FIELD_BYTES === 0 ? data.length / FIELD_BYTES : undefined;
    if (fields === undefined) problems.push(`${file}: not whole 32-byte fields`);
    else if (entry.fields !== fields)
      problems.push(`${file}: ${fields} fields, manifest says ${entry.fields}`);
  }
  return problems;
}

function checkContents(files: FixtureFiles): string[] {
  const problems: string[] = [];
  for (const file of ["vk", "proof"]) {
    if (files[file] && files[file].length === 0) problems.push(`${file}: empty`);
  }
  const witness = files["witness.gz"];
  if (witness && (witness[0] !== GZIP_MAGIC[0] || witness[1] !== GZIP_MAGIC[1])) {
    problems.push("witness.gz: not gzip");
  }
  const circuit = files["circuit.json"];
  if (circuit) {
    try {
      const parsed = JSON.parse(new TextDecoder().decode(circuit));
      if (typeof parsed?.bytecode !== "string") problems.push("circuit.json: no bytecode string");
    } catch {
      problems.push("circuit.json: not JSON");
    }
  }
  return problems;
}

/**
 * Every problem with a fixture, or an empty list. `expectedBbJs` (the installed bb.js version)
 * turns an Aztec bump into a verification failure until the fixture is regenerated.
 */
export function verifyManifest(
  manifest: unknown,
  files: FixtureFiles,
  expectedBbJs?: string,
): string[] {
  if (!isManifestShape(manifest)) return ["manifest: not a presto/noir-fixture@1 document"];
  const problems: string[] = [];
  if (!(VERIFIER_TARGETS as readonly string[]).includes(manifest.verifierTarget)) {
    problems.push(`manifest: unknown verifier target ${manifest.verifierTarget}`);
  }
  if (manifest.toolchain.backend !== "WasmWorker")
    problems.push("manifest: reference proofs must come from WasmWorker");
  if (expectedBbJs && manifest.toolchain.bbJs !== expectedBbJs) {
    problems.push(
      `manifest: generated with bb.js ${manifest.toolchain.bbJs}, installed ${expectedBbJs} — regenerate`,
    );
  }
  const expected = new Set<string>([...SOURCE_FILES, ...ARTIFACT_FILES]);
  for (const file of expected) {
    const entry = manifest.files[file];
    if (!entry) problems.push(`${file}: missing from the manifest`);
    else problems.push(...checkEntry(file, entry, files[file]));
  }
  for (const file of Object.keys(manifest.files)) {
    if (!expected.has(file)) problems.push(`${file}: unexpected manifest entry`);
  }
  problems.push(...checkContents(files));
  return problems;
}

export function fixtureDir(root: string, name: string): string {
  return join(root, FIXTURE_ROOT, name);
}

export function readFixtureFiles(dir: string): FixtureFiles {
  const files: FixtureFiles = {};
  for (const file of [...SOURCE_FILES, ...ARTIFACT_FILES]) {
    const path = join(dir, file);
    if (existsSync(path)) files[file] = new Uint8Array(readFileSync(path));
  }
  return files;
}

function readManifest(dir: string): unknown {
  const path = join(dir, "manifest.json");
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8"));
}

function run(command: string[], cwd?: string): string {
  const result = Bun.spawnSync(command, { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    throw new Error(
      `${command.join(" ")} failed (${result.exitCode}): ${result.stderr.toString().trim()}`,
    );
  }
  return result.stdout.toString();
}

function nargoVersion(nargo: string): string {
  const first = run([nargo, "--version"]).split("\n")[0] ?? "";
  const match = /nargo version = (\S+)/.exec(first);
  if (!match) throw new Error(`unexpected ${nargo} --version output: ${first}`);
  return match[1] as string;
}

/** Minimal shape of the bb.js API this script drives (the package is resolved from the SDK tree). */
interface BbJs {
  BackendType: { WasmWorker: unknown };
  Barretenberg: { new: (options: { threads: number; backend: unknown }) => Promise<BbApi> };
  UltraHonkBackend: new (bytecode: string, api: BbApi) => UltraHonkBackendLike;
}
interface BbApi {
  destroy(): Promise<void>;
}
interface UltraHonkBackendLike {
  getVerificationKey(options: { verifierTarget: string }): Promise<Uint8Array>;
  generateProof(
    witness: Uint8Array,
    options: { verifierTarget: string },
  ): Promise<{ proof: Uint8Array; publicInputs: string[] }>;
}

async function loadBbJs(): Promise<BbJs> {
  const sdkDir = join(import.meta.dirname, "..", "packages", "sdk");
  const bbProverEntry = Bun.resolveSync("@aztec/bb-prover", sdkDir);
  const entry = Bun.resolveSync("@aztec/bb.js", dirname(bbProverEntry));
  return (await import(entry)) as BbJs;
}

/** bb.js returns public inputs as `0x`-prefixed 32-byte hex fields; the wire and bb use raw bytes. */
export function publicInputsToBytes(fields: string[]): Uint8Array {
  const out = new Uint8Array(fields.length * FIELD_BYTES);
  fields.forEach((field, i) => {
    const hex = field.startsWith("0x") ? field.slice(2) : field;
    if (hex.length !== FIELD_BYTES * 2)
      throw new Error(`public input ${i}: ${hex.length / 2} bytes, expected ${FIELD_BYTES}`);
    out.set(Buffer.from(hex, "hex"), i * FIELD_BYTES);
  });
  return out;
}

async function proveWithWasm(
  bbJs: BbJs,
  bytecode: string,
  witness: Uint8Array,
  verifierTarget: string,
): Promise<{ vk: Uint8Array; proof: Uint8Array; publicInputs: Uint8Array }> {
  const threads = Math.max(1, cpus().length - 1);
  // Explicit WasmWorker: in Node/Bun `Barretenberg.new()` would otherwise pick the native backend.
  const api = await bbJs.Barretenberg.new({ threads, backend: bbJs.BackendType.WasmWorker });
  try {
    const backend = new bbJs.UltraHonkBackend(bytecode, api);
    const vk = await backend.getVerificationKey({ verifierTarget });
    const { proof, publicInputs } = await backend.generateProof(witness, { verifierTarget });
    return { vk, proof, publicInputs: publicInputsToBytes(publicInputs) };
  } finally {
    await api.destroy();
  }
}

async function regenerate(
  root: string,
  name: string,
  nargo: string,
  bbJs: BbJs,
  bbJsVersion: string,
): Promise<void> {
  const dir = fixtureDir(root, name);
  run([nargo, "compile", "--program-dir", dir]);
  run([nargo, "execute", "--program-dir", dir]);
  const circuit = new Uint8Array(readFileSync(join(dir, "target", `${name}.json`)));
  const witness = new Uint8Array(readFileSync(join(dir, "target", `${name}.gz`)));
  const bytecode: string = JSON.parse(new TextDecoder().decode(circuit)).bytecode;
  const { vk, proof, publicInputs } = await proveWithWasm(bbJs, bytecode, witness, FIXTURE_TARGET);
  const artifacts: FixtureFiles = {
    "circuit.json": circuit,
    "witness.gz": witness,
    vk,
    proof,
    public_inputs: publicInputs,
  };
  for (const [file, data] of Object.entries(artifacts)) writeFileSync(join(dir, file), data);
  const files = { ...readFixtureFiles(dir), ...artifacts };
  const toolchain: FixtureToolchain = {
    nargo: nargoVersion(nargo),
    bbJs: bbJsVersion,
    backend: "WasmWorker",
  };
  const manifest = buildManifest(name, FIXTURE_TARGET, toolchain, files);
  writeFileSync(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `${name}: regenerated (${manifest.files.proof?.fields} proof fields, ${manifest.files.public_inputs?.fields} public inputs)`,
  );
}

function verifyAll(root: string, expectedBbJs: string): boolean {
  let ok = true;
  for (const name of FIXTURE_NAMES) {
    const dir = fixtureDir(root, name);
    const problems = verifyManifest(readManifest(dir), readFixtureFiles(dir), expectedBbJs);
    if (problems.length === 0) {
      console.log(`${name}: ok`);
      continue;
    }
    ok = false;
    for (const problem of problems) console.error(`${name}: ${problem}`);
  }
  return ok;
}

async function main(): Promise<void> {
  const root = join(import.meta.dirname, "..");
  const args = process.argv.slice(2);
  const { version: bbJsVersion } = resolveAztecBb();
  if (args[0] === "--regenerate") {
    const names = args.length > 1 ? args.slice(1) : [...FIXTURE_NAMES];
    const nargo = process.env.AZTEC_NARGO ?? "aztec-nargo";
    const bbJs = await loadBbJs();
    for (const name of names) {
      mkdirSync(fixtureDir(root, name), { recursive: true });
      await regenerate(root, name, nargo, bbJs, bbJsVersion);
    }
  }
  if (!verifyAll(root, bbJsVersion)) process.exit(1);
}

if (import.meta.main) {
  await main();
}

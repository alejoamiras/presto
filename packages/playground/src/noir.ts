import type { PrestoPhase, PrestoPhaseData } from "@alejoamiras/presto";
import {
  type BarretenbergSource,
  PrestoUltraHonkBackend,
  type ProofData,
  type VerifierTarget,
} from "@alejoamiras/presto-noir";
import type { LogFn, UiMode } from "./aztec";

/** The committed `square` circuit: `assert(x * x == y); pedersen_hash([x, y])`, two public inputs. */
export interface NoirFixture {
  bytecode: string;
  witness: Uint8Array;
  vk: Uint8Array;
  proof: Uint8Array;
  publicInputs: Uint8Array;
  verifierTarget: VerifierTarget;
}

export interface NoirProofResult {
  mode: UiMode;
  durationMs: number;
  /** The proof and public inputs are byte-identical to the fixture's bb.js WASM reference. */
  identical: boolean;
  /** Presto mode ended up proving in the browser. */
  fellBack: boolean;
}

// Vite bundles a file referenced through a LITERAL `new URL("...", import.meta.url)` as a hashed
// asset (a directory base resolved later would stay a runtime path and 404 in production).
const FIXTURE_FILES = {
  circuit: new URL("../../../fixtures/noir/square/circuit.json", import.meta.url),
  manifest: new URL("../../../fixtures/noir/square/manifest.json", import.meta.url),
  witness: new URL("../../../fixtures/noir/square/witness.gz", import.meta.url),
  vk: new URL("../../../fixtures/noir/square/vk", import.meta.url),
  proof: new URL("../../../fixtures/noir/square/proof", import.meta.url),
  publicInputs: new URL("../../../fixtures/noir/square/public_inputs", import.meta.url),
};

export async function loadNoirFixture(fetchImpl: typeof fetch = fetch): Promise<NoirFixture> {
  const bytes = async (file: keyof typeof FIXTURE_FILES) => {
    const response = await fetchImpl(FIXTURE_FILES[file]);
    if (!response.ok) throw new Error(`fixture ${file}: HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  };
  const text = async (file: keyof typeof FIXTURE_FILES) =>
    new TextDecoder().decode(await bytes(file));
  const [artifact, manifest, witness, vk, proof, publicInputs] = await Promise.all([
    text("circuit"),
    text("manifest"),
    bytes("witness"),
    bytes("vk"),
    bytes("proof"),
    bytes("publicInputs"),
  ]);
  return {
    bytecode: JSON.parse(artifact).bytecode,
    witness,
    vk,
    proof,
    publicInputs,
    verifierTarget: JSON.parse(manifest).verifierTarget,
  };
}

const same = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/** bb's raw 32-byte fields as bb.js's `0x` + 64 hex digits, to compare with `ProofData.publicInputs`. */
function fieldsToHex(fields: Uint8Array): string[] {
  const out: string[] = [];
  for (let i = 0; i < fields.length; i += 32) {
    let hex = "0x";
    for (const byte of fields.subarray(i, i + 32)) hex += byte.toString(16).padStart(2, "0");
    out.push(hex);
  }
  return out;
}

export function matchesFixture(data: ProofData, fixture: NoirFixture): boolean {
  const expected = fieldsToHex(fixture.publicInputs);
  return (
    same(data.proof, fixture.proof) &&
    data.publicInputs.length === expected.length &&
    data.publicInputs.every((field, i) => field === expected[i])
  );
}

/** bb.js WASM in the browser: `Barretenberg.new()` picks the multi-threaded worker backend there. */
async function browserBarretenberg() {
  const { Barretenberg } = await import("@aztec/bb.js");
  return Barretenberg.new({ threads: Math.max(1, navigator.hardwareConcurrency - 1) });
}

let fixturePromise: Promise<NoirFixture> | null = null;
let backend: PrestoUltraHonkBackend | null = null;
let apiSource: BarretenbergSource = browserBarretenberg;

/** Test and demo hook: replace the fixture and the WASM backend source; resets the backend. */
export function configureNoir(options: { fixture?: NoirFixture; api?: BarretenbergSource }): void {
  if (options.fixture) fixturePromise = Promise.resolve(options.fixture);
  if (options.api) apiSource = options.api;
  backend = null;
}

/**
 * One backend for the page, seeded with the fixture's key and sharing the page's transport policy
 * (the `?httpsOnly=true` assertion knob, like the Aztec prover). WASM is only initialised when a
 * proof actually runs in the browser.
 */
async function getNoirBackend(): Promise<{
  backend: PrestoUltraHonkBackend;
  fixture: NoirFixture;
}> {
  fixturePromise ??= loadNoirFixture();
  const fixture = await fixturePromise;
  if (!backend) {
    const httpsOnly = new URLSearchParams(window.location.search).get("httpsOnly") === "true";
    backend = new PrestoUltraHonkBackend(fixture.bytecode, apiSource, {
      verificationKey: { bytes: fixture.vk, verifierTarget: fixture.verifierTarget },
      ...(httpsOnly ? { presto: { httpsOnly: true, allowInsecureDowngrade: false } } : {}),
    });
  }
  return { backend, fixture };
}

/** Prove the fixture in the chosen mode and compare the result with the committed reference. */
export async function proveNoirFixture(
  mode: UiMode,
  log: LogFn,
  onPhase: (phase: PrestoPhase, data?: PrestoPhaseData) => void,
): Promise<NoirProofResult> {
  const { backend, fixture } = await getNoirBackend();
  let fellBack = false;
  backend.setOnPhase((phase, data) => {
    if (phase === "fallback") fellBack = true;
    onPhase(phase, data);
  });
  backend.setForceLocal(mode === "local");
  log(
    mode === "local"
      ? "Proving the Noir circuit in-browser..."
      : "Proving the Noir circuit with Presto...",
  );
  const start = performance.now();
  try {
    const data = await backend.generateProof(fixture.witness, {
      verifierTarget: fixture.verifierTarget,
    });
    const durationMs = Math.round(performance.now() - start);
    const identical = matchesFixture(data, fixture);
    log(
      identical
        ? "Proof is byte-identical to the bb.js WASM reference"
        : "Proof differs from the bb.js WASM reference",
      identical ? "success" : "error",
    );
    return { mode, durationMs, identical, fellBack };
  } finally {
    backend.setOnPhase(null);
  }
}

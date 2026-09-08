import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { cpus } from "node:os";
import { toBase64 } from "@alejoamiras/presto-core";
import { BackendType, Barretenberg, deflattenFields } from "@aztec/bb.js";
import { PrestoUltraHonkBackend } from "../src/index.js";
import { FIXTURE_NAMES, fixtureDir, loadFixture, type NoirFixture } from "./e2e-setup.js";

// The adapter against a LIVE presto (headless in CI, desktop on a dev box). `fallback: "none"` and
// the phase trail make a silent WASM fallback a failure, not a pass. CI must always provide the
// environment: an unset PRESTO_URL fails here unless PRESTO_NOIR_SKIP_LIVE=1 opts out explicitly.
const PRESTO_URL = process.env.PRESTO_URL ?? "";
if (!PRESTO_URL && process.env.PRESTO_NOIR_SKIP_LIVE !== "1") {
  throw new Error("PRESTO_URL is not set; export PRESTO_NOIR_SKIP_LIVE=1 to skip the live suite");
}
const endpoint = PRESTO_URL ? new URL(PRESTO_URL) : null;
const presto = endpoint
  ? { host: endpoint.hostname, port: Number(endpoint.port), httpsOnly: false }
  : undefined;

const newApi = () =>
  Barretenberg.new({
    threads: Math.max(1, cpus().length - 1),
    backend: BackendType.WasmWorker,
  });

/** One native proof through the adapter, asserted against the fixture's reference bytes. */
async function proveNatively(fixture: NoirFixture, api: Barretenberg) {
  const phases: string[] = [];
  const backend = new PrestoUltraHonkBackend(fixture.bytecode, api, {
    presto,
    fallback: "none",
    onPhase: (phase) => phases.push(phase),
  });
  const options = { verifierTarget: fixture.verifierTarget };
  const data = await backend.generateProof(fixture.witness, options);
  expect(phases).toContain("transmit");
  expect(phases).not.toContain("fallback");
  expect(data.proof).toEqual(fixture.proof);
  expect(data.publicInputs).toEqual(deflattenFields(fixture.publicInputs));
  return { backend, data, options };
}

describe.skipIf(!endpoint)("PrestoUltraHonkBackend against a live presto", () => {
  let api: Barretenberg;
  beforeAll(async () => {
    api = await newApi();
  }, 300_000);
  afterAll(async () => {
    await api?.destroy();
  });

  test("the presto advertises the ultra_honk scheme", async () => {
    const backend = new PrestoUltraHonkBackend("", api, { presto });
    const status = await backend.checkPrestoStatus();
    expect(status.available).toBe(true);
    if (status.available) expect(status.schemes).toContain("ultra_honk");
  });

  test.each([...FIXTURE_NAMES])(
    "%s: native proof equals the reference and verifies in WASM",
    async (name) => {
      const fixture = loadFixture(fixtureDir(name));
      const { backend, data, options } = await proveNatively(fixture, api);
      expect(await backend.verifyProof(data, options)).toBe(true);
      // The presto returned the key on the first proof; the second sends it back and must still be
      // the reference bytes (the cached-key request path).
      const again = await backend.generateProof(fixture.witness, options);
      expect(again).toEqual(data);
      // A tampered proof must not verify: the WASM verifier is circuit-bound, not a rubber stamp.
      // bb.js answers `false` or throws (a flipped byte can leave a curve point invalid).
      const tampered = new Uint8Array(data.proof);
      const last = tampered.length - 1;
      tampered[last] = (tampered[last] ?? 0) ^ 0x01;
      const verdict = await backend
        .verifyProof({ ...data, proof: tampered }, options)
        .catch(() => false);
      expect(verdict).toBe(false);
    },
    600_000,
  );

  test("the presto returns the key it computed only when none was supplied, and it is the reference key", async () => {
    const fixture = loadFixture(fixtureDir("square"));
    const job = {
      bytecode: fixture.bytecode,
      witness: toBase64(fixture.witness),
      verifier_target: fixture.verifierTarget,
    };
    const post = async (body: Record<string, string>) => {
      const response = await fetch(new URL("/prove/ultra-honk", PRESTO_URL), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(200);
      const answer = (await response.json()) as {
        proof: string;
        public_inputs: string;
        vk?: string;
      };
      expect(answer.proof).toBe(toBase64(fixture.proof));
      expect(answer.public_inputs).toBe(toBase64(fixture.publicInputs));
      return answer;
    };
    expect((await post(job)).vk).toBe(toBase64(fixture.vk));
    expect((await post({ ...job, vk: toBase64(fixture.vk) })).vk).toBeUndefined();
  }, 600_000);

  test("the default (ZK) target proves natively and verifies in WASM", async () => {
    // ZK proofs are randomised, so no byte comparison: WASM verification is the interoperability
    // evidence for the target every consumer gets without options.
    const fixture = loadFixture(fixtureDir("square"));
    const phases: string[] = [];
    const backend = new PrestoUltraHonkBackend(fixture.bytecode, api, {
      presto,
      fallback: "none",
      onPhase: (phase) => phases.push(phase),
    });
    const data = await backend.generateProof(fixture.witness);
    expect(phases).toContain("transmit");
    expect(phases).not.toContain("fallback");
    expect(data.publicInputs).toEqual(deflattenFields(fixture.publicInputs));
    expect(await backend.verifyProof(data)).toBe(true);
  }, 600_000);
});

// A yacana W artifact on a dev box: the miner's real circuit through the same path.
const W_DIR = process.env.PRESTO_NOIR_W_FIXTURE_DIR ?? "";
describe.skipIf(!endpoint || !W_DIR || !existsSync(W_DIR))("yacana W cross-check", () => {
  test("the W proof is the reference and verifies", async () => {
    const api = await newApi();
    try {
      const { backend, data, options } = await proveNatively(loadFixture(W_DIR, "W"), api);
      expect(await backend.verifyProof(data, options)).toBe(true);
    } finally {
      await api.destroy();
    }
  }, 600_000);
});

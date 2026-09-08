import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpus } from "node:os";
import { BackendType, Barretenberg, deflattenFields, UltraHonkBackend } from "@aztec/bb.js";
import { PrestoUltraHonkBackend } from "../src/index.js";
import { FIXTURE_NAMES, fixtureDir, loadFixture } from "./e2e-setup.js";

// Byte identity between bb.js WASM and the committed references (which native bb reproduces in the
// app's real-bb lane): the two provers are interchangeable only while this holds for every fixture.
// Explicit WasmWorker — in Node/Bun `Barretenberg.new()` would otherwise pick the native backend.
const newApi = () =>
  Barretenberg.new({
    threads: Math.max(1, cpus().length - 1),
    backend: BackendType.WasmWorker,
  });

describe("bb.js WASM reproduces the committed fixtures", () => {
  let api: Barretenberg;
  beforeAll(async () => {
    api = await newApi();
  }, 300_000);
  afterAll(async () => {
    await api?.destroy();
  });

  test.each([...FIXTURE_NAMES])(
    "%s: key, proof, and public inputs are the reference bytes",
    async (name) => {
      const fixture = loadFixture(fixtureDir(name));
      const options = { verifierTarget: fixture.verifierTarget };
      const backend = new UltraHonkBackend(fixture.bytecode, api);
      expect(await backend.getVerificationKey(options)).toEqual(fixture.vk);
      const { proof, publicInputs } = await backend.generateProof(fixture.witness, options);
      expect(proof).toEqual(fixture.proof);
      expect(publicInputs).toEqual(deflattenFields(fixture.publicInputs));
    },
    300_000,
  );

  test("the adapter's forced-local path is that same WASM proof", async () => {
    const fixture = loadFixture(fixtureDir("square"));
    const backend = new PrestoUltraHonkBackend(fixture.bytecode, api);
    backend.setForceLocal(true);
    const { proof, publicInputs } = await backend.generateProof(fixture.witness, {
      verifierTarget: fixture.verifierTarget,
    });
    expect(proof).toEqual(fixture.proof);
    expect(publicInputs).toEqual(deflattenFields(fixture.publicInputs));
    expect(
      await backend.verifyProof(
        { proof, publicInputs },
        { verifierTarget: fixture.verifierTarget },
      ),
    ).toBe(true);
  }, 300_000);
});

import { expect, test } from "bun:test";
import { join } from "node:path";
import { buildJob, checkOutputs, type Fixture, loadFixture } from "./ultra-honk-smoke";

const root = join(import.meta.dirname, "..", "..", "..");
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

function reference(fixture: Fixture, vk?: Uint8Array) {
  return {
    proof: b64(fixture.proof),
    public_inputs: b64(fixture.publicInputs),
    ...(vk ? { vk: b64(vk) } : {}),
  };
}

test("the job carries the artifact bytecode verbatim and the key only when asked", () => {
  const fixture = loadFixture(root, "square");
  const withKey = buildJob(fixture, true);
  expect(withKey.bytecode).toBe(fixture.bytecode);
  expect(withKey.verifier_target).toBe("noir-recursive-no-zk");
  expect(withKey.vk).toBe(b64(fixture.vk));
  expect(buildJob(fixture, false).vk).toBeUndefined();
});

test("outputs are checked byte for byte against the WASM reference", () => {
  const fixture = loadFixture(root, "nopub");
  expect(fixture.publicInputs.length).toBe(0);
  expect(checkOutputs(reference(fixture), fixture, false)).toEqual([]);
  expect(checkOutputs(reference(fixture, fixture.vk), fixture, true)).toEqual([]);

  const flipped = new Uint8Array(fixture.proof);
  flipped.fill(0xff, 0, 1);
  const bad = { ...reference(fixture), proof: b64(flipped) };
  expect(checkOutputs(bad, fixture, false)).toEqual(["proof differs from the WASM reference"]);
  expect(checkOutputs(reference(fixture), fixture, true)).toEqual([
    "server did not return the key it computed",
  ]);
  expect(checkOutputs(reference(fixture, fixture.vk), fixture, false)).toEqual([
    "server echoed a client-supplied key",
  ]);
  expect(checkOutputs(reference(fixture, new Uint8Array(3)), fixture, true)).toEqual([
    "computed vk differs from the WASM key",
  ]);
});

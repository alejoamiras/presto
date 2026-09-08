import { expect, mock, test } from "bun:test";

// A host without the bb.js peer (or with one that lacks `UltraHonkBackend`) must fail with one
// actionable message at the first WASM use, and only then: the native path never loads bb.js. The
// module mock replaces the peer for this file only.
mock.module("@aztec/bb.js", () => ({}));

const { PrestoUltraHonkBackend } = await import("./presto-ultra-honk-backend.js");

test("a missing or unexpected @aztec/bb.js is one clear error at the first WASM use", async () => {
  globalThis.fetch = mock(async () => {
    throw new TypeError("refused");
  }) as typeof fetch;
  const factory = mock(async () => ({}) as never);
  const backend = new PrestoUltraHonkBackend("bytecode", factory);

  await expect(backend.generateProof(new Uint8Array())).rejects.toThrow(
    "needs its peer dependency @aztec/bb.js@5.2.0",
  );
  await expect(backend.verifyProof({ proof: new Uint8Array(), publicInputs: [] })).rejects.toThrow(
    "needs its peer dependency",
  );
  expect(factory).toHaveBeenCalledTimes(1);
});

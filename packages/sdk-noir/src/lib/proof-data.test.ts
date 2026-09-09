import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { toBase64 } from "@alejoamiras/presto-core";
import { deflattenFields } from "@aztec/bb.js";
import { decodeUltraHonkResponse, fieldsToHex, toProofData } from "./proof-data.js";

const fixture = (name: string, file: string) =>
  new Uint8Array(
    readFileSync(
      fileURLToPath(new URL(`../../../../fixtures/noir/${name}/${file}`, import.meta.url)),
    ),
  );

describe("proof data", () => {
  test.each(["square", "nopub", "hashchain"])(
    "the fixture %s converts exactly as bb.js would",
    (name) => {
      const proof = fixture(name, "proof");
      const publicInputs = fixture(name, "public_inputs");
      const response = decodeUltraHonkResponse({
        proof: toBase64(proof),
        public_inputs: toBase64(publicInputs),
        vk: toBase64(fixture(name, "vk")),
      });
      expect(response.proof).toEqual(proof);
      expect(response.vk).toEqual(fixture(name, "vk"));
      const data = toProofData(response);
      expect(data.proof).toEqual(proof);
      expect(data.publicInputs).toEqual(deflattenFields(publicInputs));
      if (name === "nopub") expect(data.publicInputs).toEqual([]);
    },
  );

  test("fields become 0x + 64 lowercase hex digits, one per 32 bytes", () => {
    const one = new Uint8Array(32);
    one[31] = 1;
    expect(fieldsToHex(one)).toEqual([`0x${"0".repeat(63)}1`]);
    expect(fieldsToHex(new Uint8Array())).toEqual([]);
  });

  test("anything but the documented shape is rejected", () => {
    expect(() => decodeUltraHonkResponse(null)).toThrow("lacks string");
    expect(() => decodeUltraHonkResponse({ proof: "AA==" })).toThrow("lacks string");
    expect(() => decodeUltraHonkResponse({ proof: 1, public_inputs: "" })).toThrow("lacks string");
    expect(() => decodeUltraHonkResponse({ proof: "AA==", public_inputs: "", vk: 1 })).toThrow(
      "non-string `vk`",
    );
    expect(() => decodeUltraHonkResponse({ proof: "AA==", public_inputs: "AAA=" })).toThrow(
      "not whole 32-byte fields",
    );
    expect(() => decodeUltraHonkResponse({ proof: "@@", public_inputs: "" })).toThrow(SyntaxError);
  });

  test("a proof or key that bb could not have written is malformed, not returned or cached", () => {
    const field = toBase64(new Uint8Array(32));
    expect(() => decodeUltraHonkResponse({ proof: "", public_inputs: "" })).toThrow(
      "proof is 0 bytes",
    );
    expect(() => decodeUltraHonkResponse({ proof: "AA==", public_inputs: "" })).toThrow(
      "proof is 1 bytes",
    );
    expect(() => decodeUltraHonkResponse({ proof: field, public_inputs: "", vk: "" })).toThrow(
      "vk is 0 bytes",
    );
    const oversized = toBase64(new Uint8Array(64 * 1024 + 1));
    expect(() =>
      decodeUltraHonkResponse({ proof: field, public_inputs: "", vk: oversized }),
    ).toThrow("vk is 65537 bytes");
    expect(decodeUltraHonkResponse({ proof: field, public_inputs: "" })).toEqual({
      proof: new Uint8Array(32),
      publicInputs: new Uint8Array(),
      vk: undefined,
    });
  });
});

import { fromBase64 } from "@alejoamiras/presto-core";
import type { ProofData } from "@aztec/bb.js";

const FIELD_BYTES = 32;

/** The `/prove/ultra-honk` success body. */
export interface UltraHonkResponse {
  proof: Uint8Array;
  publicInputs: Uint8Array;
  vk?: Uint8Array;
}

/** Decode the route's JSON body; anything but the documented shape is a malformed response. */
export function decodeUltraHonkResponse(body: unknown): UltraHonkResponse {
  const record = body as { proof?: unknown; public_inputs?: unknown; vk?: unknown } | null;
  if (typeof record?.proof !== "string" || typeof record.public_inputs !== "string") {
    throw new Error("/prove/ultra-honk body lacks string `proof` and `public_inputs`");
  }
  if (record.vk !== undefined && typeof record.vk !== "string") {
    throw new Error("/prove/ultra-honk body has a non-string `vk`");
  }
  const publicInputs = fromBase64(record.public_inputs);
  if (publicInputs.length % FIELD_BYTES !== 0) {
    throw new Error(`public inputs are ${publicInputs.length} bytes, not whole 32-byte fields`);
  }
  return {
    proof: fromBase64(record.proof),
    publicInputs,
    vk: record.vk === undefined ? undefined : fromBase64(record.vk),
  };
}

/** bb's raw 32-byte fields → bb.js's `0x` + 64 hex digits per public input (its `deflattenFields`). */
export function fieldsToHex(fields: Uint8Array): string[] {
  const out: string[] = [];
  for (let i = 0; i < fields.length; i += FIELD_BYTES) {
    let hex = "0x";
    for (const byte of fields.subarray(i, i + FIELD_BYTES))
      hex += byte.toString(16).padStart(2, "0");
    out.push(hex);
  }
  return out;
}

/** The `ProofData` bb.js's `generateProof` returns, from the route's raw bytes. */
export function toProofData(response: UltraHonkResponse): ProofData {
  return { proof: response.proof, publicInputs: fieldsToHex(response.publicInputs) };
}

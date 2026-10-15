import { expect, test } from "bun:test";
import { generateKeyPairSync, sign, verify } from "node:crypto";

// sigstore-js (DSSE, SETs) and tuf-js (root metadata) verify EC signatures without naming a digest,
// and read a runtime that throws there as a bad signature. Only the live provenance test reaches
// tuf-js, so this is what fails when a Bun bump loses the EC default digest.
test("the runtime verifies an EC signature when no digest is named", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const data = Buffer.from("signed");
  const signature = sign("sha256", data, privateKey);
  // tuf-js passes the key wrapped as `{ key }`.
  for (const key of [publicKey, { key: publicKey }]) {
    for (const digest of [null, undefined]) {
      expect(verify(digest, data, key, signature)).toBe(true);
    }
  }
  expect(verify(null, Buffer.from("altered"), publicKey, signature)).toBe(false);
});

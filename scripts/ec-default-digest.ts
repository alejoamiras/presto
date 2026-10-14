import crypto, { createPublicKey, generateKeyPairSync, KeyObject } from "node:crypto";

// Bun 1.4.0 throws on `crypto.verify(null, …)` with an EC key, where OpenSSL, Node and Bun 1.4.2
// default to SHA-256; sigstore-js and tuf-js verify that way and read the throw as a bad signature.
// On such a runtime only, this wraps `crypto.verify` so that a null digest with an EC key, bare or as
// `{ key }`, is SHA-256; nothing else changes. Remove once `.bun-version` is 1.4.2 or newer.

function lacksEcDefaultDigest(): boolean {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const data = Buffer.from("ec-default-digest");
  try {
    return !crypto.verify(null, data, publicKey, crypto.sign("sha256", data, privateKey));
  } catch {
    return true;
  }
}

/** `key` as `crypto.verify` takes it: a key, or an options object carrying one (tuf-js passes `{ key }`). */
function isEcKey(key: unknown): boolean {
  const inner =
    key && typeof key === "object" && !(key instanceof KeyObject) && "key" in key ? key.key : key;
  try {
    const keyObject =
      inner instanceof KeyObject
        ? inner
        : createPublicKey(inner as Parameters<typeof createPublicKey>[0]);
    return keyObject.asymmetricKeyType === "ec";
  } catch {
    return false;
  }
}

if (lacksEcDefaultDigest()) {
  const verify = crypto.verify;
  crypto.verify = ((algorithm: string | null | undefined, ...rest: unknown[]) =>
    (verify as (...args: unknown[]) => unknown)(
      algorithm ?? (isEcKey(rest[1]) ? "sha256" : algorithm),
      ...rest,
    )) as typeof crypto.verify;
}

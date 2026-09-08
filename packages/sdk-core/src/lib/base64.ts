// Standard base64 (with padding) for the JSON prove routes. `Uint8Array.prototype.toBase64` /
// `Uint8Array.fromBase64` (ES2025) are used when the runtime has them; the fallbacks keep old
// browsers and Node 22 working without pulling in `Buffer` for Worker bundles.

type Base64Array = Uint8Array & { toBase64?: () => string };
type Base64Ctor = Uint8ArrayConstructor & { fromBase64?: (text: string) => Uint8Array };

/** Encode `bytes` as standard, padded base64. */
export function toBase64(bytes: Uint8Array): string {
  const native = (bytes as Base64Array).toBase64;
  if (typeof native === "function") return native.call(bytes);
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/**
 * Decode standard base64. Throws on characters outside the alphabet or bad padding — a malformed
 * server body must fail closed rather than decode to a silently truncated proof.
 */
export function fromBase64(text: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4 !== 0) {
    throw new SyntaxError("invalid base64");
  }
  const native = (Uint8Array as Base64Ctor).fromBase64;
  if (typeof native === "function") return native(text);
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(text, "base64"));
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

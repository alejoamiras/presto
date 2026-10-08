/**
 * Signs the verified-sites list with its Ed25519 seed, in minisign's prehashed `ED` format, which
 * `presto_core::verified_sites` and stock `minisign -V` both verify.
 *
 * The signing job runs this file alone, copied out of the repository and started with
 * `bun --no-install --no-env-file --config=/dev/null`, so it imports `node:` modules only: no
 * package, no `bunfig.toml` preload, no `.env`.
 *
 *   PRESTO_VERIFIED_SITES_SIGNING_SEED=<hex> bun verified-sites-signer.ts sign \
 *     --list <file> --pubkey <key.pub> --expect-sha256 <hex> --out <new file.minisig>
 *   PRESTO_VERIFIED_SITES_SIGNING_SEED=<hex> bun verified-sites-signer.ts pubkey
 *
 * The seed is read once, removed from the environment, and never printed in any form; every failure
 * prints a fixed message.
 */
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as ed25519Sign,
  verify as ed25519Verify,
  type KeyObject,
} from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

export const SEED_ENV = "PRESTO_VERIFIED_SITES_SIGNING_SEED";
export const TRUSTED_COMMENT = "presto-verified-sites-v1";
export const ENVELOPE_SCHEMA = "presto-verified-sites-envelope-v1";
export const LIST_MAX_BYTES = 64 * 1024;
/** RFC 8410 PKCS#8 wrapping of a raw Ed25519 seed; the seed follows as the last 32 bytes. */
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

export class SignerError extends Error {}

export interface SigningKey {
  privateKey: KeyObject;
  publicKey: Uint8Array;
}

/** 32 seed bytes from 64 hex characters, optionally `0x`-prefixed. The message never echoes input. */
export function normalizeSeed(input: string | undefined): Uint8Array {
  if (input === undefined || !/^(0x)?[0-9a-fA-F]{64}$/.test(input)) {
    throw new SignerError("the signing seed is not 64 hex characters");
  }
  return Uint8Array.from(Buffer.from(input.replace(/^0x/, ""), "hex"));
}

export function deriveKey(seed: Uint8Array): SigningKey {
  const privateKey = createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
  const spki = createPublicKey(privateKey).export({ format: "der", type: "spki" });
  return { privateKey, publicKey: Uint8Array.from(spki.subarray(spki.length - 32)) };
}

/** The first 8 bytes of SHA-256 of the public key, so a key ID names exactly one key. */
export function keyId(publicKey: Uint8Array): Uint8Array {
  return Uint8Array.from(createHash("sha256").update(publicKey).digest().subarray(0, 8));
}

/** A key ID as minisign prints it: the little-endian integer of its bytes, in upper-case hex. */
export function keyIdHex(id: Uint8Array): string {
  return Buffer.from(id).reverse().toString("hex").toUpperCase();
}

export function publicKeyDocument(publicKey: Uint8Array): string {
  const id = keyId(publicKey);
  const blob = Buffer.concat([Buffer.from("Ed"), id, publicKey]).toString("base64");
  return `untrusted comment: presto verified-sites public key ${keyIdHex(id)}\n${blob}\n`;
}

export interface MinisignOptions {
  untrustedComment: string;
  trustedComment: string;
  /** `ED` (BLAKE2b-512 of the message) when true; the legacy raw-message `Ed` form otherwise. */
  prehash: boolean;
}

/** A minisign signature file over `message`. Lists go through {@link signList}; this exists for it and for fixtures. */
export function minisignSignature(
  key: SigningKey,
  message: Uint8Array,
  options: MinisignOptions,
): string {
  const signed = options.prehash
    ? new Uint8Array(new Bun.CryptoHasher("blake2b512").update(message).digest())
    : message;
  const signature = ed25519Sign(null, signed, key.privateKey);
  const algorithm = options.prehash ? "ED" : "Ed";
  const first = Buffer.concat([Buffer.from(algorithm), keyId(key.publicKey), signature]);
  const global = ed25519Sign(
    null,
    Buffer.concat([signature, Buffer.from(options.trustedComment)]),
    key.privateKey,
  );
  return (
    `untrusted comment: ${options.untrustedComment}\n${first.toString("base64")}\n` +
    `trusted comment: ${options.trustedComment}\n${global.toString("base64")}\n`
  );
}

/** The `version` of a list, which must be a positive safe integer. */
export function listVersion(list: Uint8Array): number {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(list));
  } catch {
    throw new SignerError("the list is not UTF-8 JSON");
  }
  const version = (parsed as { version?: unknown } | null)?.version;
  if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 1) {
    throw new SignerError("the list has no positive safe-integer version");
  }
  return version;
}

/** Sign a list exactly as the production signer does, and check both signatures before returning. */
export function signList(key: SigningKey, list: Uint8Array): string {
  if (list.byteLength > LIST_MAX_BYTES) throw new SignerError("the list is over 64 KiB");
  const signature = minisignSignature(key, list, {
    untrustedComment: `presto verified-sites list version ${listVersion(list)}`,
    trustedComment: TRUSTED_COMMENT,
    prehash: true,
  });
  const [, first = "", , global = ""] = signature.split("\n");
  const raw = Buffer.from(first, "base64");
  const prehash = new Bun.CryptoHasher("blake2b512").update(list).digest();
  const publicKey = createPublicKey(key.privateKey);
  const valid =
    ed25519Verify(null, prehash, publicKey, raw.subarray(10)) &&
    ed25519Verify(
      null,
      Buffer.concat([raw.subarray(10), Buffer.from(TRUSTED_COMMENT)]),
      publicKey,
      Buffer.from(global, "base64"),
    );
  if (!valid) throw new SignerError("the new signature does not verify");
  return signature;
}

/** The served envelope, byte for byte what `presto_core::verified_sites::verify::document` builds. */
export function documentBytes(list: Uint8Array, signature: Uint8Array): Uint8Array {
  const envelope = {
    schema: ENVELOPE_SCHEMA,
    list: Buffer.from(list).toString("base64"),
    signature: Buffer.from(signature).toString("base64"),
  };
  return new TextEncoder().encode(JSON.stringify(envelope));
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Read the seed from the environment exactly once and remove it, whatever happens next. */
export function takeSeed(env: Record<string, string | undefined> = process.env): Uint8Array {
  const value = env[SEED_ENV];
  delete env[SEED_ENV];
  return normalizeSeed(value);
}

const SIGN_FLAGS = ["--list", "--pubkey", "--expect-sha256", "--out"] as const;

/** Exactly the `sign` flags, each once with a value; anything else is refused before the seed is read. */
function signFlags(args: string[]): Record<(typeof SIGN_FLAGS)[number], string> {
  const flags = new Map<string, string>();
  for (let at = 0; at < args.length; at += 2) {
    const [name, value] = [args[at] ?? "", args[at + 1]];
    if (!(SIGN_FLAGS as readonly string[]).includes(name) || flags.has(name)) {
      // Never echoed: a misplaced argument could be anything.
      throw new SignerError("unexpected or repeated argument");
    }
    if (value === undefined || value.startsWith("--"))
      throw new SignerError(`${name} needs a value`);
    flags.set(name, value);
  }
  const missing = SIGN_FLAGS.find((name) => !flags.has(name));
  if (missing) throw new SignerError(`missing ${missing}`);
  return Object.fromEntries(flags) as Record<(typeof SIGN_FLAGS)[number], string>;
}

function sign(args: string[]): void {
  const flags = signFlags(args);
  const key = deriveKey(takeSeed());
  const pinned = readFileSync(flags["--pubkey"], "utf8");
  if (publicKeyDocument(key.publicKey) !== pinned) {
    throw new SignerError("the seed does not match the pinned public key");
  }
  const list = new Uint8Array(readFileSync(flags["--list"]));
  if (list.byteLength > LIST_MAX_BYTES) throw new SignerError("the list is over 64 KiB");
  const sha256 = sha256Hex(list);
  if (sha256 !== flags["--expect-sha256"]) {
    throw new SignerError("the list is not the approved bytes");
  }
  const signature = signList(key, list);
  try {
    // `wx`: never overwrite, so a mistyped `--out` cannot clobber the list or the key.
    writeFileSync(flags["--out"], signature, { flag: "wx" });
  } catch {
    throw new SignerError("could not create --out (it must not exist yet)");
  }
  console.log(`version=${listVersion(list)}`);
  console.log(`sha256=${sha256}`);
  console.log(`key_id=${keyIdHex(keyId(key.publicKey))}`);
}

function main(args: string[]): number {
  try {
    const [command, ...rest] = args;
    if (command === "sign") sign(rest);
    else if (command === "pubkey" && rest.length === 0)
      process.stdout.write(publicKeyDocument(deriveKey(takeSeed()).publicKey));
    else throw new SignerError("usage: verified-sites-signer.ts sign|pubkey");
    return 0;
  } catch (error) {
    // Only this module's own fixed messages are printed: anything else could carry input.
    console.error(
      error instanceof SignerError ? `signer: ${error.message}` : "signer: unexpected failure",
    );
    return error instanceof SignerError && error.message.startsWith("the signing seed") ? 2 : 1;
  }
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));

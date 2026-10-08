/**
 * Builds the committed verified-sites fixtures under `core/tests/fixtures/verified_sites/`, signed
 * with the published RFC 8032 §7.1 test vectors (TEST 1 is the "pinned" key, TEST 2 the wrong one).
 * Those keys are public, so they have no authority; the PR gate rebuilds every file and requires the
 * committed bytes to match.
 *
 *   bun scripts/verified-sites-fixtures.ts --write
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  deriveKey,
  documentBytes,
  minisignSignature,
  normalizeSeed,
  publicKeyDocument,
  type SigningKey,
  signList,
  TRUSTED_COMMENT,
} from "./verified-sites-signer.ts";

export const FIXTURE_DIR = path.join(import.meta.dir, "..", "core/tests/fixtures/verified_sites");
export const RFC8032_TEST1_SEED =
  "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
export const RFC8032_TEST2_SEED =
  "4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb";

const EXTENSION = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";

interface Entry {
  origins: string[];
  displayName: string;
  description?: string;
  curatedBy?: string;
  addedAt?: string;
}

/** A list laid out the way curators write `verified-sites.json`. */
function list(version: number, entries: Entry[], extra: Record<string, unknown> = {}): Uint8Array {
  const body = {
    $schema: "./verified-sites.schema.json",
    schemaVersion: 1,
    version,
    entries: entries.map((e) => ({
      origins: e.origins,
      displayName: e.displayName,
      ...(e.description === undefined ? {} : { description: e.description }),
      curatedBy: e.curatedBy ?? "alejoamiras",
      addedAt: e.addedAt ?? "2026-05-28",
    })),
    ...extra,
  };
  return new TextEncoder().encode(`${JSON.stringify(body, null, 2)}\n`);
}

const alpha: Entry = { origins: ["https://alpha.example.com"], displayName: "Alpha" };
const beta: Entry = {
  origins: ["https://beta.example.com", EXTENSION],
  displayName: "Beta",
  description: "Wallet — with an em dash, which descriptions may carry",
};
const gamma: Entry = { origins: ["https://gamma.example.com"], displayName: "Gamma" };
const delta: Entry = {
  origins: ["https://delta.example.com"],
  displayName: "![Approved](https://example.invalid/a.png)",
};

export function buildFixtures(): Map<string, Uint8Array> {
  const pinned = deriveKey(normalizeSeed(RFC8032_TEST1_SEED));
  const other = deriveKey(normalizeSeed(RFC8032_TEST2_SEED));
  const out = new Map<string, Uint8Array>();
  const text = (s: string) => new TextEncoder().encode(s);
  const signed = (name: string, bytes: Uint8Array, key: SigningKey = pinned) => {
    out.set(`${name}.json`, bytes);
    out.set(`${name}.json.minisig`, text(signList(key, bytes)));
  };

  out.set("test1.pub", text(publicKeyDocument(pinned.publicKey)));
  out.set("test2.pub", text(publicKeyDocument(other.publicKey)));

  // The happy path: 5 renames Beta and adds Delta; 6 drops Gamma, an entry 4 had.
  signed("list-4", list(4, [alpha, beta, gamma]));
  const five = list(5, [alpha, { ...beta, displayName: "Beta Wallet" }, gamma, delta]);
  signed("list-5", five);
  signed("list-6", list(6, [alpha, { ...beta, displayName: "Beta Wallet" }, delta]));

  // Validly signed, but a second list for version 5.
  signed("list-5-equivocating", list(5, [alpha, gamma]));

  // Signature variants over list-5's exact bytes.
  out.set("list-5.wrong-key.minisig", text(signList(other, five)));
  const variant = (trustedComment: string, prehash: boolean) =>
    text(
      minisignSignature(pinned, five, {
        untrustedComment: "presto verified-sites list version 5",
        trustedComment,
        prehash,
      }),
    );
  out.set("list-5.bad-comment.minisig", variant("presto-verified-sites-v2", true));
  out.set("list-5.legacy.minisig", variant(TRUSTED_COMMENT, false));
  // Same length as list-5, one byte different, so only the signature can catch it.
  out.set(
    "list-5-tampered.json",
    text(new TextDecoder().decode(five).replace('"Alpha"', '"Alphx"')),
  );

  // Validly signed lists that break a list rule.
  signed("list-7-unknown-field", list(7, [alpha], { comment: "not a field" }));
  signed(
    "list-7-non-canonical",
    list(7, [{ ...alpha, origins: ["https://alpha.example.com:443"] }]),
  );
  signed("list-7-http", list(7, [{ ...alpha, origins: ["http://alpha.example.com"] }]));
  signed("list-7-bidi-name", list(7, [{ ...alpha, displayName: "Alpha ‮gnp.exe" }]));

  // Signed bytes that are not a list at all, and bytes over the 64 KiB cap.
  const notJson = text("not json\n");
  out.set("not-json.json", notJson);
  out.set(
    "not-json.json.minisig",
    text(
      minisignSignature(pinned, notJson, {
        untrustedComment: "presto verified-sites list version 0",
        trustedComment: TRUSTED_COMMENT,
        prehash: true,
      }),
    ),
  );
  const oversized = list(8, [{ ...alpha, description: "" }], { pad: "x".repeat(64 * 1024) });
  out.set("oversized.json", oversized);
  out.set(
    "oversized.json.minisig",
    text(
      minisignSignature(pinned, oversized, {
        untrustedComment: "presto verified-sites list version 8",
        trustedComment: TRUSTED_COMMENT,
        prehash: true,
      }),
    ),
  );

  // The served form of list-4: Rust's `document()` must produce exactly these bytes.
  const listFour = out.get("list-4.json") as Uint8Array;
  const sigFour = out.get("list-4.json.minisig") as Uint8Array;
  out.set("envelope-4.json", documentBytes(listFour, sigFour));
  return out;
}

if (import.meta.main) {
  if (!process.argv.includes("--write")) {
    console.error("usage: bun scripts/verified-sites-fixtures.ts --write");
    process.exit(2);
  }
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const fixtures = buildFixtures();
  for (const [name, bytes] of fixtures) writeFileSync(path.join(FIXTURE_DIR, name), bytes);
  console.log(`wrote ${readdirSync(FIXTURE_DIR).length} fixtures to ${FIXTURE_DIR}`);
}

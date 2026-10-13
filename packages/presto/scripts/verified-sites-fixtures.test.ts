import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { buildFixtures, FIXTURE_DIR } from "./verified-sites-fixtures.ts";
import { deriveKey, normalizeSeed, publicKeyDocument } from "./verified-sites-signer.ts";

describe("verified-sites fixtures", () => {
  test("the committed fixtures are exactly what the generator builds", () => {
    const built = buildFixtures();
    expect(readdirSync(FIXTURE_DIR).sort()).toEqual([...built.keys()].sort());
    for (const [name, bytes] of built) {
      const committed = new Uint8Array(readFileSync(path.join(FIXTURE_DIR, name)));
      expect(Buffer.compare(committed, bytes), `${name} differs; rerun with --write`).toBe(0);
    }
  });

  test("the pinned fixture key is RFC 8032 TEST 1", () => {
    const key = deriveKey(
      normalizeSeed("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60"),
    );
    expect(Buffer.from(key.publicKey).toString("hex")).toBe(
      "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
    );
    expect(readFileSync(path.join(FIXTURE_DIR, "test1.pub"), "utf8")).toBe(
      publicKeyDocument(key.publicKey),
    );
  });
});

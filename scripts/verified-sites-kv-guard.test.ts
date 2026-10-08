import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { FIXTURE_DIR } from "../packages/presto/scripts/verified-sites-fixtures.ts";
import { documentBytes } from "../packages/presto/scripts/verified-sites-signer.ts";

const GUARD = path.resolve(import.meta.dir, "../.github/scripts/verified-sites-kv-guard.sh");
const dir = mkdtempSync(path.join(tmpdir(), "kv-guard-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const fixture = (name: string) => readFileSync(path.join(FIXTURE_DIR, name));

/** Writes an envelope of a fixture list and one of its signatures, returning its path. */
function envelope(list: string, signature = `${list}.json.minisig`): string {
  const file = path.join(dir, `${list}--${signature}`);
  writeFileSync(file, documentBytes(fixture(`${list}.json`), fixture(signature)));
  return file;
}

function file(name: string, content: string | Uint8Array): string {
  const at = path.join(dir, name);
  writeFileSync(at, content);
  return at;
}

function guard(status: string, body: string, candidate = envelope("list-5")) {
  const r = Bun.spawnSync(["bash", GUARD, status, body, candidate]);
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
}

const NOT_FOUND = JSON.stringify({
  success: false,
  errors: [{ code: 10009, message: "get: 'key not found'" }],
  messages: [],
  result: null,
});

describe("verified-sites KV guard", () => {
  test("writes into an absent key, over an older list, and to repair the same list's envelope", () => {
    expect(guard("404", file("missing.json", NOT_FOUND)).out).toBe("decision=write\n");
    expect(guard("200", envelope("list-4")).out).toBe("decision=write\n");
    const respaced = file(
      "respaced.json",
      `${JSON.stringify(JSON.parse(readFileSync(envelope("list-5"), "utf8")), null, 1)}`,
    );
    expect(guard("200", respaced).out).toBe("decision=write\n");
  });

  test("skips exactly the candidate", () => {
    expect(guard("200", envelope("list-5"))).toEqual({
      code: 0,
      out: "decision=skip\n",
      err: "",
    });
  });

  test("refuses a newer list, an equivocating one, another key, and anything unreadable", () => {
    const cases: [string, string, string][] = [
      ["200", envelope("list-6"), "ahead of the newest record (5)"],
      ["200", envelope("list-5-equivocating"), "different list at version 5 (equivocation)"],
      ["200", envelope("list-5", "list-5.wrong-key.minisig"), "the owner's KV delete first"],
      ["200", file("not-json.json", "{"), "not a verified-sites envelope"],
      ["200", file("extra.json", '{"schema":"x","list":"","signature":"","more":1}'), "envelope"],
      ["404", file("plain-404.json", "Not Found"), "without Cloudflare's key-not-found error"],
      ["404", file("other-404.json", NOT_FOUND.replace("10009", "10000")), "key-not-found"],
      ["500", file("error.json", "{}"), "KV answered HTTP 500"],
      ["200", file("huge.json", " ".repeat(98305)), "document over 98304 bytes"],
    ];
    for (const [status, body, why] of cases) {
      const r = guard(status, body);
      expect(r.code, why).toBe(1);
      expect(r.out).toBe("");
      expect(r.err).toContain(why);
    }
  });

  test("an older list under another key is refused, naming both key IDs as minisign does", () => {
    const r = guard("200", envelope("list-4"), envelope("list-6"));
    expect(r.out).toBe("decision=write\n");
    const rotated = guard(
      "200",
      envelope("list-5", "list-5.wrong-key.minisig"),
      envelope("list-6"),
    );
    expect(rotated.code).toBe(1);
    const pub = (name: string) => fixture(name).toString().split("\n")[0]?.split(" ").at(-1);
    expect(rotated.err).toContain(`key ID ${pub("test2.pub")}, not ${pub("test1.pub")}`);
  });
});

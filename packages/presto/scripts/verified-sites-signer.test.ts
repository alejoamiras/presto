import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { FIXTURE_DIR, RFC8032_TEST1_SEED } from "./verified-sites-fixtures.ts";
import { SEED_ENV, sha256Hex, takeSeed } from "./verified-sites-signer.ts";

const SIGNER = path.join(import.meta.dir, "verified-sites-signer.ts");
const dir = mkdtempSync(path.join(tmpdir(), "verified-sites-signer-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const fixture = (name: string) => path.join(FIXTURE_DIR, name);
const list = fixture("list-4.json");
const listSha = sha256Hex(readFileSync(list));

/** `seed: null` runs with the variable absent. */
function run(args: string[], seed: string | null = RFC8032_TEST1_SEED) {
  const env: Record<string, string | undefined> = { ...process.env, [SEED_ENV]: seed ?? undefined };
  if (seed === null) delete env[SEED_ENV];
  const r = Bun.spawnSync([process.execPath, SIGNER, ...args], { env });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
}

function sign(
  overrides: Partial<Record<string, string>> = {},
  seed: string | null = RFC8032_TEST1_SEED,
) {
  const flags = {
    "--list": list,
    "--pubkey": fixture("test1.pub"),
    "--expect-sha256": listSha,
    "--out": path.join(dir, `sig-${Math.random()}`),
    ...overrides,
  };
  const r = run(["sign", ...Object.entries(flags).flat()], seed);
  return { ...r, out: r.out, file: flags["--out"] };
}

describe("verified-sites signer", () => {
  test("signs the approved bytes exactly as the committed fixture, printing public values only", () => {
    const r = sign();
    expect(r.code).toBe(0);
    expect(readFileSync(r.file, "utf8")).toBe(readFileSync(fixture("list-4.json.minisig"), "utf8"));
    expect(r.out).toBe(`version=4\nsha256=${listSha}\nkey_id=61A254A1DF31FE21\n`);
    expect(r.out + r.err).not.toContain(RFC8032_TEST1_SEED);
  });

  test("refuses a seed that is not the pinned key, other bytes, and oversized lists", () => {
    const big = path.join(dir, "big.json");
    writeFileSync(big, `{"version":1,"pad":"${"x".repeat(64 * 1024)}"}`);
    const cases = [
      [sign({ "--pubkey": fixture("test2.pub") }), "does not match the pinned public key"],
      [sign({ "--expect-sha256": "0".repeat(64) }), "is not the approved bytes"],
      [sign({ "--list": big, "--expect-sha256": sha256Hex(readFileSync(big)) }), "over 64 KiB"],
      [
        sign({
          "--list": fixture("not-json.json"),
          "--expect-sha256": sha256Hex(readFileSync(fixture("not-json.json"))),
        }),
        "not UTF-8 JSON",
      ],
    ] as const;
    for (const [r, why] of cases) {
      expect(r.code).toBe(1);
      expect(r.err).toContain(why);
      expect(existsSync(r.file)).toBe(false);
    }
  });

  test("an invalid or missing seed exits 2 without echoing it", () => {
    for (const seed of ["not-hex", `${RFC8032_TEST1_SEED}00`, null]) {
      const r = sign({}, seed);
      expect(r.code).toBe(2);
      expect(r.err).toBe("signer: the signing seed is not 64 hex characters\n");
    }
  });

  test("pubkey prints the key document; the seed leaves the environment once read", () => {
    expect(run(["pubkey"]).out).toBe(readFileSync(fixture("test1.pub"), "utf8"));
    const env: Record<string, string | undefined> = { [SEED_ENV]: `0x${RFC8032_TEST1_SEED}` };
    expect(takeSeed(env).byteLength).toBe(32);
    expect(SEED_ENV in env).toBe(false);
    const bad: Record<string, string | undefined> = { [SEED_ENV]: "x" };
    expect(() => takeSeed(bad)).toThrow("not 64 hex characters");
    expect(SEED_ENV in bad).toBe(false);
  });
});

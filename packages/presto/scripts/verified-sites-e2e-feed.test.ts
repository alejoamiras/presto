import { afterAll, describe, expect, test } from "bun:test";
import { createPublicKey, verify } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type ControlStatus,
  E2E_ORIGIN,
  type FeedState,
  feedLists,
  firstBuiltIn,
  VERSIONS,
} from "./verified-sites-e2e.ts";
import { envelope, FEED_KEY } from "./verified-sites-e2e-feed.ts";
import { RFC8032_TEST1_SEED } from "./verified-sites-fixtures.ts";
import { deriveKey, keyId, normalizeSeed, TRUSTED_COMMENT } from "./verified-sites-signer.ts";

const SCRIPT = path.join(import.meta.dir, "verified-sites-e2e-feed.ts");
const FIXTURES = path.join(import.meta.dir, "..", "core/tests/fixtures/verified_sites");
const dir = mkdtempSync(path.join(tmpdir(), "verified-sites-e2e-feed-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const fixture = (name: string) => new Uint8Array(readFileSync(path.join(FIXTURES, name)));
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

interface Opened {
  version: number;
  origins: string[];
  /** Both minisign signatures verify under the feed's key. */
  valid: boolean;
}

function open(document: Uint8Array): Opened {
  const parsed = JSON.parse(text(document)) as { list: string; signature: string };
  const list = Buffer.from(parsed.list, "base64");
  const [, first = "", trusted, global = ""] = Buffer.from(parsed.signature, "base64")
    .toString()
    .split("\n");
  const raw = Buffer.from(first, "base64");
  const signature = raw.subarray(10);
  const publicKey = createPublicKey(FEED_KEY.privateKey);
  const prehash = new Bun.CryptoHasher("blake2b512").update(list).digest();
  const valid =
    raw.subarray(0, 2).toString() === "ED" &&
    raw.subarray(2, 10).equals(Buffer.from(keyId(FEED_KEY.publicKey))) &&
    trusted === `trusted comment: ${TRUSTED_COMMENT}` &&
    verify(null, prehash, publicKey, signature) &&
    verify(
      null,
      Buffer.concat([signature, Buffer.from(TRUSTED_COMMENT)]),
      publicKey,
      Buffer.from(global, "base64"),
    );
  const body = JSON.parse(list.toString()) as { version: number; entries: { origins: string[] }[] };
  return { version: body.version, origins: body.entries.flatMap((e) => e.origins), valid };
}

async function waitForState(file: string): Promise<FeedState> {
  const deadline = Date.now() + 10_000;
  while (!existsSync(file)) {
    if (Date.now() > deadline) throw new Error("the feed wrote no state file");
    await Bun.sleep(50);
  }
  return JSON.parse(readFileSync(file, "utf8")) as FeedState;
}

describe("verified-sites E2E feed", () => {
  test("wraps a list exactly as the CLI does: the committed envelope, byte for byte", () => {
    const key = deriveKey(normalizeSeed(RFC8032_TEST1_SEED));
    expect(text(envelope(key, fixture("list-4.json")))).toBe(text(fixture("envelope-4.json")));
  });

  test("serves each mode from the newest record, switched through its control endpoint", async () => {
    const history = mkdtempSync(path.join(dir, "history-"));
    // Numerically newest, not lexically: 12 beats 9.
    copyFileSync(path.join(FIXTURES, "list-4.json"), path.join(history, "12.json"));
    copyFileSync(path.join(FIXTURES, "list-6.json"), path.join(history, "9.json"));
    const stateFile = path.join(dir, "state.json");
    const feed = Bun.spawn(["bun", SCRIPT, "--state", stateFile, "--history", history], {
      stdout: "ignore",
    });
    try {
      const state = await waitForState(stateFile);
      expect(state.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
      expect(state.control).toBe(`${state.url}control`);
      expect(state.pubkey).toBe(text(fixture("test2.pub")));
      expect(state.pid).toBe(feed.pid);

      expect((await fetch(state.url)).status).toBe(404);
      const served: Record<string, Opened> = {};
      for (const mode of ["with", "without", "tampered"] as const) {
        const switched = await fetch(`${state.control}?serve=${mode}`, { method: "POST" });
        expect(switched.status).toBe(200);
        const response = await fetch(state.url);
        expect(response.status).toBe(200);
        served[mode] = open(new Uint8Array(await response.arrayBuffer()));
      }
      const kept = [
        "https://beta.example.com",
        "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
      ];
      kept.push("https://gamma.example.com");
      expect(served).toEqual({
        with: { version: VERSIONS.with, origins: [...kept, E2E_ORIGIN], valid: true },
        without: { version: VERSIONS.without, origins: kept, valid: true },
        tampered: { version: VERSIONS.tampered, origins: kept, valid: false },
      });

      const status = (await (await fetch(state.control)).json()) as ControlStatus;
      expect(status).toEqual({
        serve: "tampered",
        served: { none: 1, with: 1, without: 1, tampered: 1 },
      });
      expect((await fetch(`${state.control}?serve=all`, { method: "POST" })).status).toBe(400);
      expect((await fetch(state.url, { method: "POST" })).status).toBe(405);
      expect((await fetch(`${state.url}releases/verified-sites.json`)).status).toBe(404);
    } finally {
      feed.kill();
      await feed.exited;
    }
  });

  test("an empty built-in list loses nothing and gains only the E2E origin", () => {
    const empty = new TextEncoder().encode(
      JSON.stringify({ schemaVersion: 1, version: 3, entries: [] }),
    );
    expect(firstBuiltIn(empty)).toBeNull();
    expect(
      JSON.parse(text(feedLists(empty).with)).entries.map((e: { origins: string[] }) => e.origins),
    ).toEqual([[E2E_ORIGIN]]);
  });

  test("refuses to start without a history record", () => {
    const empty = mkdtempSync(path.join(dir, "empty-"));
    const stateFile = path.join(dir, "never.json");
    const run = Bun.spawnSync(["bun", SCRIPT, "--state", stateFile, "--history", empty]);
    expect(run.exitCode).not.toBe(0);
    expect(existsSync(stateFile)).toBe(false);
  });
});

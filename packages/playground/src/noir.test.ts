import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

import {
  configureNoir,
  loadNoirFixture,
  matchesFixture,
  type NoirFixture,
  proveNoirFixture,
} from "./noir";
import { stubBarretenberg } from "./noir-stub";

// The committed fixture files, served to the loader the way Vite serves URL assets.
const fromDisk: typeof fetch = (async (input: RequestInfo | URL) => {
  const url = input instanceof Request ? input.url : String(input);
  return new Response(readFileSync(fileURLToPath(url)));
}) as unknown as typeof fetch;

const originalFetch = globalThis.fetch;
let fixture: NoirFixture;
const logs: string[] = [];
const log = (msg: string) => logs.push(msg);

beforeAll(async () => {
  fixture = await loadNoirFixture(fromDisk);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  logs.length = 0;
});

describe("noir panel", () => {
  test("loads the square fixture and recognises its own reference", () => {
    expect(fixture.verifierTarget).toBe("noir-recursive-no-zk");
    expect(fixture.publicInputs.length).toBe(64);
    const reference = {
      proof: fixture.proof,
      publicInputs: [0, 32].map(
        (at) =>
          `0x${[...fixture.publicInputs.subarray(at, at + 32)].map((b) => b.toString(16).padStart(2, "0")).join("")}`,
      ),
    };
    expect(matchesFixture(reference, fixture)).toBe(true);
    const flipped = new Uint8Array(fixture.proof);
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    expect(matchesFixture({ ...reference, proof: flipped }, fixture)).toBe(false);
    expect(matchesFixture({ ...reference, publicInputs: [] }, fixture)).toBe(false);
  });

  test("in-browser mode proves through bb.js's UltraHonkBackend and matches the reference", async () => {
    configureNoir({ fixture, api: stubBarretenberg(fixture) });
    const phases: string[] = [];
    const result = await proveNoirFixture("local", log, (phase) => phases.push(phase));
    expect(result).toMatchObject({ mode: "local", identical: true, fellBack: false });
    expect(phases).toEqual(["proving", "proved"]);
    expect(logs.at(-1)).toContain("byte-identical");
  });

  test("Presto mode proves natively and falls back to the browser when Presto is offline", async () => {
    configureNoir({ fixture, api: stubBarretenberg(fixture) });
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      if (request.url.endsWith("/health")) {
        return Response.json({ status: "ok", api_version: 1, schemes: ["chonk", "ultra_honk"] });
      }
      if (request.url.endsWith("/prove/ultra-honk")) {
        const job = await request.json();
        expect(job.bytecode).toBe(fixture.bytecode);
        expect(job.vk).toBe(toBase64(fixture.vk));
        return Response.json({
          proof: toBase64(fixture.proof),
          public_inputs: toBase64(fixture.publicInputs),
        });
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;
    const phases: string[] = [];
    const native = await proveNoirFixture("accelerated", log, (phase) => phases.push(phase));
    expect(native).toMatchObject({ mode: "accelerated", identical: true, fellBack: false });
    expect(phases).toContain("transmit");
    expect(phases).not.toContain("fallback");

    configureNoir({ fixture, api: stubBarretenberg(fixture) });
    globalThis.fetch = mock(async () => {
      throw new TypeError("refused");
    }) as unknown as typeof fetch;
    phases.length = 0;
    const fallback = await proveNoirFixture("accelerated", log, (phase) => phases.push(phase));
    expect(fallback).toMatchObject({ mode: "accelerated", identical: true, fellBack: true });
    expect(phases).toContain("fallback");
  });
});

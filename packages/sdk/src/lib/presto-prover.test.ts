import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { PrestoHttpError } from "@alejoamiras/presto-core";
import { BBLazyPrivateKernelProver } from "@aztec/bb-prover/client/lazy";
import { WASMSimulator } from "@aztec/simulator/client";
import * as stdlibKernel from "@aztec/stdlib/kernel";
import { ChonkProofWithPublicInputs } from "@aztec/stdlib/proofs";
import sdkPkg from "../../package.json" with { type: "json" };
import { decodeChonkProof, PrestoProver, sdkAztecVersion } from "./presto-prover.js";

// The adapter's own job: serialize the kernel steps, hand the round trip to the client, decode the
// proof, and run WASM for every fallback outcome. Transport policy and the error taxonomy are the
// client's and are tested in @alejoamiras/presto-core.

const SDK_AZTEC_VERSION = (sdkPkg.dependencies as Record<string, string>)["@aztec/stdlib"];
const EMPTY_PROOF_B64 = ChonkProofWithPublicInputs.empty().toBuffer().toString("base64");

const fakeStep = {
  functionName: "test_fn",
  witness: new Map([[0, "val"]]),
  bytecode: new Uint8Array([0, 1]),
  vk: new Uint8Array([2, 3]),
  timings: { witgen: 10 },
} as any;

type RouteHandler = (request: Request) => Response | Promise<Response>;

function mockFetch(routes: Record<string, RouteHandler>): { fetchedUrls: string[] } {
  const fetchedUrls: string[] = [];
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    fetchedUrls.push(url);
    const request = input instanceof Request ? input : new Request(input, init);
    for (const [pattern, handler] of Object.entries(routes)) {
      if (url.includes(pattern)) return handler(request);
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { fetchedUrls };
}

function mockFetchOffline() {
  globalThis.fetch = mock(async () => {
    throw new TypeError("fetch failed (connection refused)");
  }) as typeof fetch;
}

const healthOk = () =>
  Response.json({
    status: "ok",
    api_version: 1,
    aztec_version: SDK_AZTEC_VERSION,
    available_versions: [SDK_AZTEC_VERSION],
  });

/** The WASM prover, stubbed to reject: reaching it is how a test observes a fallback. */
function mockWasmProver() {
  const spy = spyOn(BBLazyPrivateKernelProver.prototype, "createChonkProof");
  spy.mockRejectedValue(new Error("local prover not available in test"));
  return spy;
}

function mockSerializer() {
  return spyOn(stdlibKernel, "serializePrivateExecutionSteps").mockReturnValue(
    Buffer.from([0xde, 0xad]),
  );
}

function prover(options: ConstructorParameters<typeof PrestoProver>[0] = {}) {
  const phases: string[] = [];
  const instance = new PrestoProver({
    simulator: new WASMSimulator(),
    onPhase: (phase) => phases.push(phase),
    ...options,
  });
  return { prover: instance, phases };
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: Suite registration is not production control flow.
describe("PrestoProver", () => {
  let originalFetch: typeof globalThis.fetch;
  let wasmSpy: ReturnType<typeof mockWasmProver>;
  let serializeSpy: ReturnType<typeof mockSerializer>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    wasmSpy = mockWasmProver();
    serializeSpy = mockSerializer();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    wasmSpy.mockRestore();
    serializeSpy.mockRestore();
  });

  test("decodes a native /prove body and reports the phase trail in order", async () => {
    let captured: Request | null = null;
    mockFetch({
      "/health": healthOk,
      "/prove": (request) => {
        captured = request;
        return Response.json(
          { proof: EMPTY_PROOF_B64 },
          { headers: { "x-prove-duration-ms": "7" } },
        );
      },
    });
    const { prover: p, phases } = prover();

    const proof = await p.createChonkProof([fakeStep]);

    expect(proof.toBuffer()).toEqual(ChonkProofWithPublicInputs.empty().toBuffer());
    expect(captured!.headers.get("x-aztec-version")).toBe(SDK_AZTEC_VERSION);
    expect(captured!.headers.get("content-type")).toBe("application/octet-stream");
    expect(new Uint8Array(await captured!.arrayBuffer())).toEqual(new Uint8Array([0xde, 0xad]));
    expect(phases).toEqual(["detect", "serialize", "transmit", "proving", "proved", "receive"]);
    expect(wasmSpy).not.toHaveBeenCalled();
  });

  test("falls back to WASM when the presto is unavailable: detect → fallback → proving", async () => {
    mockFetchOffline();
    const { prover: p, phases } = prover();
    await expect(p.createChonkProof([fakeStep])).rejects.toThrow(
      "local prover not available in test",
    );
    expect(phases).toEqual(["detect", "fallback", "proving"]);
    expect(serializeSpy).not.toHaveBeenCalled();
  });

  test("emits secure-connection-unavailable before fallback and never POSTs HTTP", async () => {
    const requests: Request[] = [];
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      requests.push(request);
      if (request.url.startsWith("https://")) throw new TypeError("certificate rejected");
      return Response.json({ status: "ok", api_version: 1 });
    }) as typeof fetch;
    const { prover: p, phases } = prover({ presto: { httpsOnly: true } });

    await expect(p.createChonkProof([fakeStep])).rejects.toThrow(
      "local prover not available in test",
    );
    expect(phases.slice(0, 3)).toEqual(["detect", "secure-connection-unavailable", "fallback"]);
    expect(requests.some((request) => request.url.endsWith("/prove"))).toBe(false);
    expect(serializeSpy).not.toHaveBeenCalled();
  });

  test("a denial degrades to WASM after the client's denied phase", async () => {
    mockFetch({
      "/health": healthOk,
      "/prove": () =>
        new Response(JSON.stringify({ error: "origin_denied", message: "Access denied" }), {
          status: 403,
          headers: { "content-type": "text/plain" },
        }),
    });
    const { prover: p, phases } = prover();
    await expect(p.createChonkProof([fakeStep])).rejects.toThrow(
      "local prover not available in test",
    );
    expect(phases).toEqual([
      "detect",
      "serialize",
      "transmit",
      "proving",
      "denied",
      "fallback",
      "proving",
    ]);
  });

  test.each([
    // The client rejects an unreadable body before `receive`; a readable body of the wrong shape is
    // received and then rejected by the adapter's decode.
    ["not JSON", () => new Response("not json at all", { status: 200 }), false],
    ["no string proof", () => Response.json({ proof: 12345 }), true],
    ["invalid base64", () => Response.json({ proof: "@@@" }), true],
  ])(
    "a 200 with a body that cannot be decoded (%s) degrades to WASM",
    async (_n, prove, received) => {
      mockFetch({ "/health": healthOk, "/prove": prove });
      const { prover: p, phases } = prover();
      await expect(p.createChonkProof([fakeStep])).rejects.toThrow(
        "local prover not available in test",
      );
      const native = ["detect", "serialize", "transmit", "proving", "proved"];
      expect(phases).toEqual([...native, ...(received ? ["receive"] : []), "fallback", "proving"]);
      expect(wasmSpy).toHaveBeenCalled();
    },
  );

  test("a typed misconfiguration error propagates and is never masked as WASM", async () => {
    mockFetch({
      "/health": healthOk,
      "/prove": () =>
        new Response(JSON.stringify({ error: "invalid_version" }), {
          status: 400,
          headers: { "content-type": "text/plain" },
        }),
    });
    const { prover: p } = prover();
    const err = await p.createChonkProof([fakeStep]).catch((e) => e);
    expect(err).toBeInstanceOf(PrestoHttpError);
    expect(err.status).toBe(400);
    expect(err.code).toBe("invalid_version");
    expect(wasmSpy).not.toHaveBeenCalled();
  });

  test("setForceLocal skips detection entirely", async () => {
    const { fetchedUrls } = mockFetch({ "/health": healthOk });
    const { prover: p, phases } = prover();
    p.setForceLocal(true);
    await expect(p.createChonkProof([fakeStep])).rejects.toThrow(
      "local prover not available in test",
    );
    expect(fetchedUrls).toEqual([]);
    expect(phases).toEqual(["proving"]);
  });

  test("setOnPhase after construction receives the client's phases too", async () => {
    mockFetchOffline();
    const p = new PrestoProver({ simulator: new WASMSimulator() });
    const phases: string[] = [];
    p.setOnPhase((phase) => phases.push(phase));
    await p.createChonkProof([fakeStep]).catch(() => {});
    expect(phases[0]).toBe("detect");
    expect(phases).toContain("fallback");
  });

  test("checkPrestoStatus reports the SDK's pinned Aztec version and setPrestoConfig re-probes", async () => {
    const { fetchedUrls } = mockFetch({ "/health": healthOk });
    const { prover: p } = prover();
    expect(await p.checkPrestoStatus()).toMatchObject({
      available: true,
      sdkAztecVersion: SDK_AZTEC_VERSION,
    });
    p.setPrestoConfig({ port: 51337 });
    await p.checkPrestoStatus();
    expect(fetchedUrls.some((url) => url.includes(":51337"))).toBe(true);
  });

  test("the handshake version is the pinned @aztec/stdlib, prerelease suffix preserved", () => {
    expect(sdkAztecVersion()).toBe(SDK_AZTEC_VERSION.replace(/^[^0-9]*/, ""));
    expect(sdkAztecVersion()).toMatch(/^\d/);
  });

  test("decodeChonkProof rejects bodies without a string proof", () => {
    expect(() => decodeChonkProof({})).toThrow("lacks a string `proof`");
    expect(() => decodeChonkProof(null)).toThrow("lacks a string `proof`");
    expect(() => decodeChonkProof({ proof: 1 })).toThrow("lacks a string `proof`");
    expect(decodeChonkProof({ proof: EMPTY_PROOF_B64 }).toBuffer()).toEqual(
      ChonkProofWithPublicInputs.empty().toBuffer(),
    );
  });
});

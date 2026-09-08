import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PrestoHttpError, toBase64 } from "@alejoamiras/presto-core";
import type { Barretenberg, ProofData } from "@aztec/bb.js";
import * as bbJs from "@aztec/bb.js";
import { PrestoUnavailableError } from "./errors.js";
import {
  PrestoUltraHonkBackend,
  type PrestoUltraHonkBackendOptions,
} from "./presto-ultra-honk-backend.js";

// The adapter's decision table over a mocked presto, with the REAL bb.js `UltraHonkBackend` spied on
// so a WASM fallback is observed (or its absence proven) rather than assumed.

const read = (file: string) =>
  new Uint8Array(
    readFileSync(
      fileURLToPath(new URL(`../../../../fixtures/noir/square/${file}`, import.meta.url)),
    ),
  );
const artifact = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../../../fixtures/noir/square/circuit.json", import.meta.url)),
    "utf8",
  ),
);
const BYTECODE: string = artifact.bytecode;
const WITNESS = read("witness.gz");
const PROOF = read("proof");
const PUBLIC_INPUTS = read("public_inputs");
const VK = read("vk");
const TARGET = { verifierTarget: "noir-recursive-no-zk" } as const;
const EXPECTED: ProofData = { proof: PROOF, publicInputs: bbJs.deflattenFields(PUBLIC_INPUTS) };
const WASM_PROOF: ProofData = { proof: new Uint8Array([9, 9]), publicInputs: ["0x01"] };

type RouteHandler = (request: Request) => Response | Promise<Response>;

function mockFetch(routes: Record<string, RouteHandler>): { requests: Request[] } {
  const requests: Request[] = [];
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    requests.push(request);
    for (const [pattern, handler] of Object.entries(routes)) {
      if (request.url.includes(pattern)) return handler(request);
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { requests };
}

const healthOk = () =>
  Response.json({
    status: "ok",
    api_version: 1,
    available_versions: ["5.2.0"],
    schemes: ["chonk", "ultra_honk"],
  });
const proveOk = (vk = true) =>
  Response.json({
    proof: toBase64(PROOF),
    public_inputs: toBase64(PUBLIC_INPUTS),
    ...(vk ? { vk: toBase64(VK) } : {}),
  });
const proveError = (status: number, code: string) =>
  new Response(JSON.stringify({ error: code }), {
    status,
    headers: { "content-type": "text/plain" },
  });

/** A stand-in `Barretenberg`: the WASM methods are spied on the prototype, so it is never used. */
function fakeApi(): Barretenberg & { destroy: ReturnType<typeof mock> } {
  return { destroy: mock(async () => {}) } as unknown as Barretenberg & {
    destroy: ReturnType<typeof mock>;
  };
}

function backend(options: PrestoUltraHonkBackendOptions = {}, api: Barretenberg = fakeApi()) {
  const phases: string[] = [];
  const instance = new PrestoUltraHonkBackend(BYTECODE, api, {
    onPhase: (phase) => phases.push(phase),
    ...options,
  });
  return { backend: instance, phases };
}

const proveJobs = (requests: Request[]) =>
  requests.filter((r) => r.url.endsWith("/prove/ultra-honk"));

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: Suite registration is not production control flow.
describe("PrestoUltraHonkBackend", () => {
  let originalFetch: typeof globalThis.fetch;
  let wasmProve: ReturnType<typeof spyOn<bbJs.UltraHonkBackend, "generateProof">>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    wasmProve = spyOn(bbJs.UltraHonkBackend.prototype, "generateProof").mockResolvedValue(
      WASM_PROOF,
    );
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    wasmProve.mockRestore();
  });

  test("proves natively: the wire job, the ProofData, the phase trail, and no WASM", async () => {
    const { requests } = mockFetch({ "/health": healthOk, "/prove/ultra-honk": () => proveOk() });
    const factory = mock(async () => fakeApi());
    const { backend: b, phases } = backend({}, factory as unknown as Barretenberg);

    const proof = await b.generateProof(WITNESS, TARGET);

    expect(proof).toEqual(EXPECTED);
    const [job] = proveJobs(requests);
    expect(job?.headers.get("content-type")).toBe("application/json");
    expect(job?.headers.get("x-aztec-version")).toBe("5.2.0");
    expect(await job?.json()).toEqual({
      bytecode: BYTECODE,
      witness: toBase64(WITNESS),
      verifier_target: "noir-recursive-no-zk",
    });
    expect(phases).toEqual(["detect", "serialize", "transmit", "proving", "proved", "receive"]);
    expect(wasmProve).not.toHaveBeenCalled();
    expect(factory).not.toHaveBeenCalled();
  });

  test("a presto-computed key is sent on later proofs of the same target only, never returned", async () => {
    const { requests } = mockFetch({ "/health": healthOk, "/prove/ultra-honk": () => proveOk() });
    const { backend: b } = backend();
    await b.generateProof(WITNESS, TARGET);
    await b.generateProof(WITNESS, TARGET);
    await b.generateProof(WITNESS, { verifierTarget: "evm-no-zk" });

    const jobs = await Promise.all(proveJobs(requests).map((r) => r.json()));
    expect(jobs.map((job) => job.vk)).toEqual([undefined, toBase64(VK), undefined]);
    // getVerificationKey never hands out a server key: it is WASM-derived (spied) instead.
    const wasmVk = spyOn(bbJs.UltraHonkBackend.prototype, "getVerificationKey").mockResolvedValue(
      new Uint8Array([7]),
    );
    expect(await b.getVerificationKey(TARGET)).toEqual(new Uint8Array([7]));
    wasmVk.mockRestore();
  });

  test("a seeded key is sent for its target, returned by getVerificationKey for it, and nothing else", async () => {
    const { requests } = mockFetch({
      "/health": healthOk,
      "/prove/ultra-honk": () => proveOk(false),
    });
    const seed = { bytes: VK, verifierTarget: "noir-recursive-no-zk" as const };
    const { backend: b } = backend({ verificationKey: seed });
    await b.generateProof(WITNESS, TARGET);
    await b.generateProof(WITNESS, { verifierTarget: "noir-rollup-no-zk" });
    const jobs = await Promise.all(proveJobs(requests).map((r) => r.json()));
    expect(jobs.map((job) => job.vk)).toEqual([toBase64(VK), undefined]);

    expect(await b.getVerificationKey(TARGET)).toBe(VK);
    const wasmVk = spyOn(bbJs.UltraHonkBackend.prototype, "getVerificationKey").mockResolvedValue(
      new Uint8Array([7]),
    );
    expect(await b.getVerificationKey({ verifierTarget: "evm" })).toEqual(new Uint8Array([7]));
    wasmVk.mockRestore();
  });

  // [name, routes, expected reason under fallback: "none", diagnostic phase or null]
  const fallbackCases: Array<[string, Record<string, RouteHandler>, string, string | null]> = [
    ["presto offline", {}, "unavailable", null],
    [
      "presto without the ultra_honk scheme",
      { "/health": () => Response.json({ status: "ok", api_version: 1, schemes: ["chonk"] }) },
      "scheme-unsupported",
      "version-mismatch",
    ],
    [
      "presto that predates the route (404)",
      { "/health": healthOk, "/prove/ultra-honk": () => proveError(404, "not_found") },
      "route-missing",
      null,
    ],
    [
      "origin denied (403)",
      { "/health": healthOk, "/prove/ultra-honk": () => proveError(403, "origin_denied") },
      "denied",
      "denied",
    ],
    [
      "per-origin queue full (429)",
      { "/health": healthOk, "/prove/ultra-honk": () => proveError(429, "origin_queue_full") },
      "transient",
      null,
    ],
    [
      "a 200 that is not the route's shape",
      { "/health": healthOk, "/prove/ultra-honk": () => Response.json({ proof: 1 }) },
      "malformed-response",
      null,
    ],
  ];
  for (const [name, routes, reason, phase] of fallbackCases) {
    test(`${name}: falls back to WASM, or throws with fallback "none"`, async () => {
      if (Object.keys(routes).length === 0) {
        globalThis.fetch = mock(async () => {
          throw new TypeError("refused");
        }) as typeof fetch;
      } else mockFetch(routes);
      const { backend: wasm, phases } = backend();
      expect(await wasm.generateProof(WITNESS, TARGET)).toEqual(WASM_PROOF);
      expect(wasmProve).toHaveBeenCalledWith(WITNESS, TARGET);
      expect(phases).toContain("fallback");
      if (phase) expect(phases).toContain(phase);
      expect(phases.slice(-3)).toEqual(["proving", "proved", "receive"]);

      wasmProve.mockClear();
      const { backend: strict } = backend({ fallback: "none" });
      const error = await strict.generateProof(WITNESS, TARGET).catch((e) => e);
      expect(error).toBeInstanceOf(PrestoUnavailableError);
      expect(error.reason).toBe(reason);
      expect(error.phase).toBe(phase ?? undefined);
      expect(wasmProve).not.toHaveBeenCalled();
    });
  }

  test("a misconfiguration is a typed PrestoHttpError, never masked as WASM", async () => {
    mockFetch({
      "/health": healthOk,
      "/prove/ultra-honk": () => proveError(400, "invalid_verifier_target"),
    });
    const { backend: b } = backend();
    const error = await b.generateProof(WITNESS, TARGET).catch((e) => e);
    expect(error).toBeInstanceOf(PrestoHttpError);
    expect(error.code).toBe("invalid_verifier_target");
    expect(wasmProve).not.toHaveBeenCalled();
  });

  test("setForceLocal proves in WASM without touching the network", async () => {
    const { requests } = mockFetch({ "/health": healthOk });
    const { backend: b, phases } = backend();
    b.setForceLocal(true);
    expect(await b.generateProof(WITNESS, TARGET)).toEqual(WASM_PROOF);
    expect(requests).toEqual([]);
    expect(phases).toEqual(["proving", "proved"]);
  });

  test("verifyProof, getSolidityVerifier, and recursive artifacts are the WASM backend's, offline", async () => {
    const { requests } = mockFetch({ "/health": healthOk, "/prove/ultra-honk": () => proveOk() });
    const { backend: b } = backend();
    await b.generateProof(WITNESS, TARGET); // caches a server key that verifyProof must ignore
    const verify = spyOn(bbJs.UltraHonkBackend.prototype, "verifyProof").mockResolvedValue(true);
    const solidity = spyOn(
      bbJs.UltraHonkBackend.prototype,
      "getSolidityVerifier",
    ).mockResolvedValue("contract");
    const recursive = spyOn(
      bbJs.UltraHonkBackend.prototype,
      "generateRecursiveProofArtifacts",
    ).mockResolvedValue({ proofAsFields: [], vkAsFields: [], vkHash: "0x" });
    try {
      const before = requests.length;
      expect(await b.verifyProof(EXPECTED, TARGET)).toBe(true);
      expect(verify).toHaveBeenCalledWith(EXPECTED, TARGET);
      expect(await b.getSolidityVerifier(VK, TARGET)).toBe("contract");
      expect(solidity).toHaveBeenCalledWith(VK, TARGET);
      await b.generateRecursiveProofArtifacts(PROOF, 2, TARGET);
      expect(recursive).toHaveBeenCalledWith(PROOF, 2, TARGET);
      expect(requests.length).toBe(before);
    } finally {
      verify.mockRestore();
      solidity.mockRestore();
      recursive.mockRestore();
    }
  });

  test("destroy releases only an api this backend created from its factory", async () => {
    globalThis.fetch = mock(async () => {
      throw new TypeError("refused");
    }) as typeof fetch;
    const owned = fakeApi();
    const factory = mock(async () => owned);
    const { backend: fromFactory } = backend({}, factory as unknown as Barretenberg);
    await fromFactory.generateProof(WITNESS, TARGET);
    await fromFactory.generateProof(WITNESS, TARGET);
    expect(factory).toHaveBeenCalledTimes(1);
    await fromFactory.destroy();
    await fromFactory.destroy();
    expect(owned.destroy).toHaveBeenCalledTimes(1);

    const provided = fakeApi();
    const { backend: fromInstance } = backend({}, provided);
    await fromInstance.generateProof(WITNESS, TARGET);
    await fromInstance.destroy();
    expect(provided.destroy).not.toHaveBeenCalled();
  });

  test("destroy during initialisation still releases the api the factory is about to create", async () => {
    const wasmVk = spyOn(bbJs.UltraHonkBackend.prototype, "getVerificationKey").mockResolvedValue(
      new Uint8Array([7]),
    );
    try {
      const owned = fakeApi();
      const factory = mock(async () => owned);
      const { backend: b } = backend({}, factory as unknown as Barretenberg);
      // The WASM path is initialising (peer import in flight); the factory has not run yet.
      const pending = b.getVerificationKey({ verifierTarget: "evm" });
      expect(factory).not.toHaveBeenCalled();
      await b.destroy();
      expect(factory).toHaveBeenCalledTimes(1);
      expect(owned.destroy).toHaveBeenCalledTimes(1);
      expect(await pending).toEqual(new Uint8Array([7]));
    } finally {
      wasmVk.mockRestore();
    }
  });

  test("bbVersion: the tested default, a refused stranger, and the explicit opt-in", async () => {
    expect(() => backend({ bbVersion: "5.3.0" })).toThrow("not a tested pairing");
    expect(() => backend({ bbVersion: "latest" })).toThrow("Invalid bbVersion");
    const { requests } = mockFetch({ "/health": healthOk, "/prove/ultra-honk": () => proveOk() });
    const { backend: b } = backend({ bbVersion: "5.3.0", allowUntestedBbVersion: true });
    await b.generateProof(WITNESS, TARGET);
    expect(proveJobs(requests)[0]?.headers.get("x-aztec-version")).toBe("5.3.0");
  });

  test("checkPrestoStatus reports the presto and its schemes", async () => {
    mockFetch({ "/health": healthOk });
    const { backend: b } = backend();
    expect(await b.checkPrestoStatus()).toMatchObject({
      available: true,
      sdkAztecVersion: "5.2.0",
      schemes: ["chonk", "ultra_honk"],
    });
  });

  test("the bb.js UltraHonkBackend surface is present at runtime", () => {
    const { backend: b } = backend();
    for (const method of Object.getOwnPropertyNames(bbJs.UltraHonkBackend.prototype)) {
      if (method === "constructor") continue;
      expect(typeof (b as unknown as Record<string, unknown>)[method], method).toBe("function");
    }
  });
});

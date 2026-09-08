import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { isBrowserRuntime, resolveHttpsOnly } from "./config.js";
import { PrestoHttpError } from "./errors.js";
import { PrestoClient } from "./presto-client.js";
import type { PrestoClientOptions, PrestoPhase, ProveOutcome, ProveRequest } from "./types.js";

const AZTEC = "5.2.0";
const PAYLOAD = new Uint8Array([0xde, 0xad]);
const PROVE: ProveRequest = {
  path: "/prove",
  contentType: "application/octet-stream",
  body: () => PAYLOAD,
};

// --- Test helpers ---

type RouteHandler = (url: string, request: Request) => Response | Promise<Response>;

function mockFetch(routes: Record<string, RouteHandler> = {}): { fetchedUrls: string[] } {
  const fetchedUrls: string[] = [];
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    fetchedUrls.push(url);
    // Normalize to a Request so handlers can inspect headers/method regardless of whether the
    // transport called fetch(url, init) or fetch(Request).
    const request = input instanceof Request ? input : new Request(input, init);
    for (const [pattern, handler] of Object.entries(routes)) {
      if (url.includes(pattern)) return handler(url, request);
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
    aztec_version: AZTEC,
    available_versions: [AZTEC],
  });

/** A client with the phases it emitted, so a test reads both from one place. */
function client(options: PrestoClientOptions = {}): {
  client: PrestoClient;
  phases: PrestoPhase[];
} {
  const phases: PrestoPhase[] = [];
  return {
    client: new PrestoClient({ aztecVersion: AZTEC, onPhase: (p) => phases.push(p), ...options }),
    phases,
  };
}

const fallbackOf = (outcome: ProveOutcome) => {
  expect(outcome.kind).toBe("fallback");
  return outcome as Extract<ProveOutcome, { kind: "fallback" }>;
};

// --- Tests ---

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: Suite registration is not production control flow.
describe("PrestoClient", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // biome-ignore lint/complexity/noExcessiveLinesPerFunction: Suite registration is not production control flow.
  describe("prove", () => {
    test("emits secure-connection-unavailable immediately, never serializes, never POSTs HTTP", async () => {
      const requests: Request[] = [];
      globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        requests.push(request);
        if (request.url.startsWith("https://")) throw new TypeError("certificate rejected");
        return Response.json({ status: "ok", api_version: 1 });
      }) as typeof fetch;
      const body = mock(() => PAYLOAD);
      const { client: c, phases } = client({ presto: { httpsOnly: true } });

      const outcome = fallbackOf(await c.prove({ ...PROVE, body }));

      expect(outcome).toEqual({
        kind: "fallback",
        reason: "secure-connection-unavailable",
        phase: "secure-connection-unavailable",
      });
      expect(phases).toEqual(["detect", "secure-connection-unavailable"]);
      expect(requests.filter((request) => request.url.startsWith("http://"))).toHaveLength(1);
      expect(requests.some((request) => request.url.endsWith("/prove"))).toBe(false);
      expect(body).not.toHaveBeenCalled();
    });

    test("an unreachable presto is `unavailable` after only the detect phase", async () => {
      mockFetchOffline();
      const { client: c, phases } = client();
      expect(await c.prove(PROVE)).toEqual({ kind: "fallback", reason: "unavailable" });
      expect(phases).toEqual(["detect"]);
    });

    test("a legacy presto on another Aztec version is `unavailable`", async () => {
      mockFetch({
        "/health": () =>
          Response.json({ status: "ok", api_version: 1, aztec_version: "0.0.0-fake" }),
      });
      const { client: c } = client();
      expect(await c.prove(PROVE)).toEqual({ kind: "fallback", reason: "unavailable" });
    });

    test("emits downloading when the presto must fetch bb for this version", async () => {
      mockFetch({
        "/health": () =>
          Response.json({
            status: "ok",
            api_version: 1,
            aztec_version: "5.0.0-nightly.20260101",
            available_versions: ["5.0.0-nightly.20260101"],
          }),
        "/prove": () => Response.json({ proof: "" }),
      });
      const { client: c, phases } = client();
      await c.prove(PROVE);
      expect(phases).toContain("downloading");
    });

    test("POSTs the serialized body with its content-type and x-aztec-version to the route", async () => {
      let captured: Request | null = null;
      mockFetch({
        "/health": healthOk,
        "/prove/custom": (_url, request) => {
          captured = request;
          return Response.json({ ok: true });
        },
      });
      const { client: c, phases } = client();

      const outcome = await c.prove({
        ...PROVE,
        path: "/prove/custom",
        contentType: "text/x-test",
      });

      expect(outcome).toMatchObject({ kind: "native", body: { ok: true } });
      expect(captured!.method).toBe("POST");
      expect(captured!.headers.get("content-type")).toBe("text/x-test");
      expect(captured!.headers.get("x-aztec-version")).toBe(AZTEC);
      expect(new Uint8Array(await captured!.arrayBuffer())).toEqual(PAYLOAD);
      expect(phases).toEqual(["detect", "serialize", "transmit", "proving", "proved", "receive"]);
    });

    test("a client without an Aztec version sends no x-aztec-version and never needs a download", async () => {
      let captured: Request | null = null;
      mockFetch({
        "/health": () =>
          Response.json({ status: "ok", api_version: 1, available_versions: ["9.9.9"] }),
        "/prove": (_url, request) => {
          captured = request;
          return Response.json({});
        },
      });
      const { client: c, phases } = client({ aztecVersion: undefined });
      expect((await c.prove(PROVE)).kind).toBe("native");
      expect(captured!.headers.has("x-aztec-version")).toBe(false);
      expect(phases).not.toContain("downloading");
    });

    test("durationMs prefers x-prove-duration-ms and falls back to the round trip", async () => {
      mockFetch({
        "/health": healthOk,
        "/prove": () =>
          Response.json({ proof: "" }, { headers: { "x-prove-duration-ms": "1234" } }),
      });
      const { client: c } = client();
      expect(await c.prove(PROVE)).toMatchObject({ kind: "native", durationMs: 1234 });

      mockFetch({ "/health": healthOk, "/prove": () => Response.json({ proof: "" }) });
      const { client: plain, phases } = client();
      const outcome = await plain.prove(PROVE);
      expect(outcome.kind).toBe("native");
      if (outcome.kind === "native") expect(outcome.durationMs).toBeGreaterThanOrEqual(0);
      // `proved` is emitted even when the server omits the header, so a UI never hangs on `proving`.
      expect(phases.indexOf("proved")).toBeGreaterThan(phases.indexOf("proving"));
    });

    test("a 200 whose body is not JSON degrades as malformed-response after `proved`", async () => {
      mockFetch({
        "/health": healthOk,
        "/prove": () => new Response("not json at all", { status: 200 }),
      });
      const { client: c, phases } = client();
      expect(await c.prove(PROVE)).toEqual({ kind: "fallback", reason: "malformed-response" });
      expect(phases).toContain("proved");
      expect(phases).not.toContain("receive");
    });

    test("responseCap bounds the success body per request", async () => {
      mockFetch({ "/health": healthOk, "/prove": () => Response.json({ pad: "A".repeat(2048) }) });
      const { client: c } = client();
      expect(await c.prove({ ...PROVE, responseCap: 1024 })).toEqual({
        kind: "fallback",
        reason: "malformed-response",
      });
      expect((await c.prove({ ...PROVE, responseCap: 4096 })).kind).toBe("native");
    });

    test("a route whose scheme the presto does not advertise degrades before anything is sent", async () => {
      const { fetchedUrls } = mockFetch({
        "/health": () =>
          Response.json({
            status: "ok",
            api_version: 1,
            available_versions: [AZTEC],
            schemes: ["chonk"],
          }),
      });
      const body = mock(() => PAYLOAD);
      const { client: c, phases } = client();

      const outcome = await c.prove({
        ...PROVE,
        body,
        path: "/prove/ultra-honk",
        scheme: "ultra_honk",
      });

      expect(outcome).toEqual({
        kind: "fallback",
        reason: "scheme-unsupported",
        phase: "version-mismatch",
      });
      expect(phases).toEqual(["detect", "version-mismatch"]);
      expect(body).not.toHaveBeenCalled();
      expect(fetchedUrls.some((url) => url.includes("/prove"))).toBe(false);
    });

    test("a route that is not a plain absolute path is refused before any request", async () => {
      // `1/prove` after `https://127.0.0.1:3000` would POST the witness to port 30001 — an endpoint
      // the probe never validated and the generation guard cannot see.
      const { fetchedUrls } = mockFetch({ "/health": healthOk, "/prove": () => Response.json({}) });
      const { client: c, phases } = client({ presto: { httpsPort: 3000 } });
      for (const path of ["1/prove", "prove", "/prove?x=1", "/prove#f", "/a@b", "/a b", ""]) {
        await expect(c.prove({ ...PROVE, path })).rejects.toThrow("Invalid presto route");
      }
      expect(fetchedUrls).toEqual([]);
      expect(phases).toEqual([]);
      expect((await c.prove({ ...PROVE, path: "/prove/ultra-honk" })).kind).toBe("native");
    });

    test("the route is read once: a callback or a getter cannot redirect the witness mid-flight", async () => {
      const { fetchedUrls } = mockFetch({ "/health": healthOk, "/prove": () => Response.json({}) });
      const mutated = { ...PROVE };
      const c = new PrestoClient({
        aztecVersion: AZTEC,
        presto: { httpsPort: 3000 },
        onPhase: (phase) => {
          if (phase === "detect") mutated.path = "1/prove";
        },
      });
      expect((await c.prove(mutated)).kind).toBe("native");

      let reads = 0;
      const getter = {
        contentType: PROVE.contentType,
        body: PROVE.body,
        get path() {
          return reads++ === 0 ? "/prove" : "1/prove";
        },
      };
      expect((await c.prove(getter)).kind).toBe("native");

      const proves = fetchedUrls.filter((u) => u.includes("/prove"));
      expect(proves).toHaveLength(2);
      for (const url of proves)
        expect(url).toMatch(/^https?:\/\/127\.0\.0\.1:(59833|3000)\/prove$/);
    });

    test("a presto that predates `schemes` serves chonk only", async () => {
      mockFetch({ "/health": healthOk, "/prove": () => Response.json({}) });
      const { client: c } = client();
      expect((await c.prove({ ...PROVE, scheme: "chonk" })).kind).toBe("native");
      expect(await c.prove({ ...PROVE, scheme: "ultra_honk" })).toMatchObject({
        kind: "fallback",
        reason: "scheme-unsupported",
      });
    });

    // ── The prove error taxonomy ──
    // The presto sends its error body as text/plain carrying a JSON string, so the fixtures below use
    // that exact shape (NOT `Response.json`) so the code-recovery path is exercised the way production
    // hits it. Recognised conditions degrade; only a caller misconfiguration / unrecognised error is
    // thrown as a typed `PrestoHttpError`.
    const proveError = (status: number, code?: string) =>
      new Response(code ? JSON.stringify({ error: code, message: "server said so" }) : "", {
        status,
        headers: { "content-type": "text/plain" },
      });

    // [name, status, code, expected reason, expected phase (or null), phase that must NOT appear]
    const fallbackCases: Array<
      [string, number, string | undefined, string, string | null, string | null]
    > = [
      ["403 origin_denied", 403, "origin_denied", "denied", "denied", null],
      ["403 authorization_timeout", 403, "authorization_timeout", "denied", "denied", null],
      ["403 authorization_cancelled", 403, "authorization_cancelled", "denied", "denied", null],
      [
        "403 version_not_allowed",
        403,
        "version_not_allowed",
        "version-mismatch",
        "version-mismatch",
        "denied",
      ],
      ["403 authorization_cooldown", 403, "authorization_cooldown", "cooldown", null, "denied"],
      // An UNRECOGNISED 403 code still degrades (catch-all → denied), it does NOT throw.
      ["403 unrecognised code → denied", 403, "some_future_denial_code", "denied", "denied", null],
      // An app that predates the route: the adapter proves locally rather than failing the dApp.
      ["404 route missing", 404, "not_found", "route-missing", null, "denied"],
      ["503 service_unavailable", 503, "service_unavailable", "transient", null, null],
      ["408 body_read_timeout", 408, "body_read_timeout", "transient", null, null],
      ["413 payload_too_large", 413, "payload_too_large", "transient", null, null],
      ["429 too_many_requests", 429, "too_many_requests", "transient", null, null],
      ["429 origin_queue_full", 429, "origin_queue_full", "transient", null, null],
      ["500 download_failed", 500, "download_failed", "transient", null, null],
      ["500 prove_failed", 500, "prove_failed", "transient", null, null],
    ];
    for (const [name, status, code, reason, wantPhase, notPhase] of fallbackCases) {
      test(`degrades: ${name}`, async () => {
        mockFetch({ "/health": healthOk, "/prove": () => proveError(status, code) });
        const { client: c, phases } = client();
        const outcome = fallbackOf(await c.prove(PROVE));
        expect(outcome.reason).toBe(reason as typeof outcome.reason);
        expect(outcome.phase).toBe((wantPhase ?? undefined) as typeof outcome.phase);
        if (wantPhase) expect(phases, `must emit ${wantPhase}`).toContain(wantPhase);
        if (notPhase) expect(phases, `must NOT emit ${notPhase}`).not.toContain(notPhase);
      });
    }

    // A misconfiguration or unrecognised error is a TYPED throw, never silently degraded.
    const throwCases: Array<[string, number, string | undefined]> = [
      ["400 invalid_version", 400, "invalid_version"],
      ["400 invalid_origin", 400, "invalid_origin"],
      ["500 unrecognised code", 500, "some_unknown_fault"],
      ["418 unrecognised status", 418, undefined],
    ];
    for (const [name, status, code] of throwCases) {
      test(`throws typed PrestoHttpError, never degrades: ${name}`, async () => {
        mockFetch({ "/health": healthOk, "/prove": () => proveError(status, code) });
        const { client: c } = client();
        const err = await c.prove(PROVE).catch((e) => e);
        expect(err, `${name} must be typed`).toBeInstanceOf(PrestoHttpError);
        expect(err.status).toBe(status);
        if (code) expect(err.code).toBe(code);
      });
    }
  });

  // biome-ignore lint/complexity/noExcessiveLinesPerFunction: Suite registration is not production control flow.
  describe("checkStatus", () => {
    test.each([
      [
        "https-disabled",
        {
          status: "ok",
          api_version: 1,
          version: "3.0.0",
          aztec_version: AZTEC,
          available_versions: [AZTEC],
          bb_available: true,
        },
      ],
      [
        "tls-or-trust-failure",
        {
          status: "ok",
          api_version: 1,
          version: "3.0.0",
          aztec_version: AZTEC,
          available_versions: [AZTEC],
          bb_available: true,
          https_port: 59834,
        },
      ],
      ["presto-reachable", { status: "ok", api_version: 1 }],
      ["presto-reachable", { status: "ok", api_version: 1, schemes: ["chonk", "ultra_honk"] }],
      ["unconfirmed", { status: "not-the-presto", api_version: 1 }],
    ] as const)("returns secure-connection-unavailable: %s", async (diagnosis, httpBody) => {
      globalThis.fetch = mock(async (input: RequestInfo | URL) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url.startsWith("https://")) throw new TypeError("TLS unavailable");
        return Response.json(httpBody);
      }) as typeof fetch;
      const { client: c } = client({ presto: { httpsOnly: true } });

      expect(await c.checkStatus()).toEqual({
        available: false,
        reason: "secure-connection-unavailable",
        diagnosis,
        sdkAztecVersion: AZTEC,
      });
    });

    test.each([
      ["available_versions object", { available_versions: {} }],
      ["mixed available_versions", { available_versions: [AZTEC, 42] }],
      ["numeric aztec_version", { aztec_version: 52 }],
      ["numeric app version", { version: 3 }],
      ["string bb_available", { bb_available: "yes" }],
      ["string https_port", { https_port: "59834" }],
      ["string schemes", { schemes: "chonk" }],
      ["mixed schemes", { schemes: ["chonk", 1] }],
      ["versions without bb_version", { versions: [{ aztec_version: AZTEC }] }],
      ["versions as strings", { versions: [AZTEC] }],
    ] as const)("keeps a malformed HTTPS %s response classified as error", async (_name, field) => {
      const urls: string[] = [];
      globalThis.fetch = mock(async (input: RequestInfo | URL) => {
        const url = input instanceof Request ? input.url : String(input);
        urls.push(url);
        if (url.startsWith("http://")) throw new Error("diagnostic must not run");
        return Response.json({ status: "ok", api_version: 1, ...field });
      }) as typeof fetch;
      const { client: c } = client({ presto: { httpsOnly: true } });

      expect(await c.checkStatus()).toEqual({
        available: false,
        reason: "error",
        sdkAztecVersion: AZTEC,
        protocol: "https",
      });
      expect(urls.every((url) => url.startsWith("https://"))).toBe(true);
    });

    test("a probe reconfigured before diagnosis never queries the new HTTP endpoint", async () => {
      let httpsCalls = 0;
      let releaseSecond!: () => void;
      const secondGate = new Promise<void>((resolve) => {
        releaseSecond = resolve;
      });
      let markSecondStarted!: () => void;
      const secondStarted = new Promise<void>((resolve) => {
        markSecondStarted = resolve;
      });
      const urls: string[] = [];
      globalThis.fetch = mock(async (input: RequestInfo | URL) => {
        const url = input instanceof Request ? input.url : String(input);
        urls.push(url);
        if (url.startsWith("http://")) return Response.json({ status: "ok", api_version: 1 });
        httpsCalls++;
        if (httpsCalls === 2) {
          markSecondStarted();
          await secondGate;
        }
        throw new TypeError("TLS unavailable");
      }) as typeof fetch;
      const { client: c } = client({ presto: { httpsOnly: true } });

      const stale = c.checkStatus();
      await secondStarted;
      c.configure({ port: 51337 });
      releaseSecond();

      const status = await stale;
      expect(status.available).toBe(false);
      expect(urls.some((url) => url.startsWith("http://"))).toBe(false);
    }, 10_000);

    test("a diagnostic raced by endpoint configuration cannot overwrite the new status cache", async () => {
      let releaseDiagnostic!: () => void;
      const diagnosticGate = new Promise<void>((resolve) => {
        releaseDiagnostic = resolve;
      });
      let markDiagnosticStarted!: () => void;
      const diagnosticStarted = new Promise<void>((resolve) => {
        markDiagnosticStarted = resolve;
      });
      globalThis.fetch = mock(async (input: RequestInfo | URL) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url.startsWith("https://")) throw new TypeError("TLS unavailable");
        markDiagnosticStarted();
        await diagnosticGate;
        return Response.json({ status: "ok", api_version: 1 });
      }) as typeof fetch;
      const { client: c } = client({ presto: { httpsOnly: true } });

      const stale = c.checkStatus();
      await diagnosticStarted;
      c.configure({ port: 51337 });
      releaseDiagnostic();
      expect((await stale).available).toBe(false);

      let newEndpointFetches = 0;
      globalThis.fetch = mock(async () => {
        newEndpointFetches++;
        throw new TypeError("offline");
      }) as typeof fetch;
      await c.checkStatus();
      expect(newEndpointFetches).toBeGreaterThan(0);
    }, 10_000);

    test("surfaces the multi-version body: versions, schemes, app + api version", async () => {
      mockFetch({
        "/health": () =>
          Response.json({
            status: "ok",
            api_version: 1,
            version: "2.0.0",
            aztec_version: AZTEC,
            available_versions: [AZTEC, "5.0.0-nightly.20260101"],
            schemes: ["chonk", "ultra_honk"],
            versions: [{ aztec_version: AZTEC, bb_version: AZTEC }],
          }),
      });
      const { client: c } = client();
      const status = await c.checkStatus();

      expect(status).toMatchObject({
        available: true,
        needsDownload: false,
        nativeAztecVersion: AZTEC,
        availableVersions: [AZTEC, "5.0.0-nightly.20260101"],
        sdkAztecVersion: AZTEC,
        appVersion: "2.0.0",
        apiVersion: 1,
        schemes: ["chonk", "ultra_honk"],
        versions: [{ aztecVersion: AZTEC, bbVersion: AZTEC }],
      });
      if (status.available) expect(status.protocol).toBeDefined();
    });

    test("returns needsDownload when the client's version is not cached", async () => {
      mockFetch({
        "/health": () =>
          Response.json({
            status: "ok",
            api_version: 1,
            aztec_version: "5.0.0-nightly.20260101",
            available_versions: ["5.0.0-nightly.20260101"],
          }),
      });
      const { client: c } = client();
      expect(await c.checkStatus()).toMatchObject({ available: true, needsDownload: true });
    });

    test("offline: unavailable without a protocol, and the status is cached (no 1s retry twice)", async () => {
      mockFetchOffline();
      const { client: c } = client();
      const status = await c.checkStatus();
      expect(status).toEqual({ available: false, reason: "offline", sdkAztecVersion: AZTEC });

      const start = performance.now();
      expect(await c.checkStatus()).toEqual(status);
      expect(performance.now() - start).toBeLessThan(50);
    });

    test("reachable host with malformed JSON → 'error' (with protocol), not 'offline'", async () => {
      mockFetch({ "/health": () => new Response("not valid json {{{", { status: 200 }) });
      const { client: c } = client();
      expect(await c.checkStatus()).toMatchObject({ available: false, reason: "error" });
    });

    test("a non-ok health response is 'error' and pins nothing, so a later healthy probe wins", async () => {
      mockFetch({ "/health": () => new Response("Internal Server Error", { status: 500 }) });
      const { client: c } = client();
      expect(await c.checkStatus()).toMatchObject({
        available: false,
        reason: "error",
        sdkAztecVersion: AZTEC,
      });

      // Advance past the status cache TTL (10s); the cache clock is performance.now().
      const realNow = performance.now.bind(performance);
      performance.now = () => realNow() + 11_000;
      try {
        mockFetch({ "/health": healthOk });
        const status = await c.checkStatus();
        expect(status.available).toBe(true);
        if (status.available) expect(status.protocol).toBeDefined();
      } finally {
        performance.now = realNow;
      }
    });

    describe("Local Network Access status and forced refresh", () => {
      let permissionsDescriptor: PropertyDescriptor | undefined;

      beforeEach(() => {
        permissionsDescriptor = Object.getOwnPropertyDescriptor(navigator, "permissions");
      });

      afterEach(() => {
        if (permissionsDescriptor) {
          Object.defineProperty(navigator, "permissions", permissionsDescriptor);
        } else {
          delete (navigator as Navigator & { permissions?: Permissions }).permissions;
        }
      });

      const setPermissionState = (state: PermissionState) => {
        Object.defineProperty(navigator, "permissions", {
          configurable: true,
          value: { query: async () => ({ state }) },
        });
      };

      test("maps only explicit denial to permission-blocked, without a protocol", async () => {
        setPermissionState("denied");
        mockFetchOffline();
        const { client: c } = client();
        const status = await c.checkStatus();
        expect(status).toEqual({
          available: false,
          reason: "permission-blocked",
          sdkAztecVersion: AZTEC,
        });
        expect("protocol" in status).toBe(false);
      });

      test("caches blocked under the normal TTL and forceRefresh bypasses that settled cache", async () => {
        setPermissionState("denied");
        let healthCalls = 0;
        globalThis.fetch = mock(async () => {
          healthCalls++;
          throw new TypeError("blocked");
        }) as typeof fetch;
        const { client: c } = client({ presto: { httpsOnly: true } });

        const first = await c.checkStatus();
        expect(first.available).toBe(false);
        expect(healthCalls).toBe(1);
        expect(await c.checkStatus()).toEqual(first);
        expect(healthCalls).toBe(1);
        expect(await c.checkStatus({ forceRefresh: true })).toEqual(first);
        expect(healthCalls).toBe(2);
      });

      test("forced refresh joins an existing same-generation probe, including ordinary callers", async () => {
        let healthCalls = 0;
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        globalThis.fetch = mock(async () => {
          healthCalls++;
          await gate;
          return Response.json({ status: "ok", api_version: 1, available_versions: [AZTEC] });
        }) as typeof fetch;
        const { client: c } = client({ presto: { httpsOnly: true } });

        const forcedA = c.checkStatus({ forceRefresh: true });
        const forcedB = c.checkStatus({ forceRefresh: true });
        const ordinary = c.checkStatus();
        await Promise.resolve();
        expect(healthCalls).toBe(1);
        release();
        const [a, b, d] = await Promise.all([forcedA, forcedB, ordinary]);
        expect(a.available).toBe(true);
        expect(b).toEqual(a);
        expect(d).toEqual(a);
        expect(healthCalls).toBe(1);
      });
    });

    test("returns available: false on legacy version mismatch", async () => {
      mockFetch({
        "/health": () =>
          Response.json({ status: "ok", api_version: 1, aztec_version: "0.0.0-fake" }),
      });
      const { client: c } = client();
      expect(await c.checkStatus()).toMatchObject({
        available: false,
        reason: "version-mismatch",
        nativeAztecVersion: "0.0.0-fake",
      });
    });

    test("falls back to HTTPS when HTTP fails (Safari mixed-content)", async () => {
      globalThis.fetch = mock(async (input: RequestInfo | URL) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url.startsWith("http://")) throw new TypeError("fetch failed (mixed content)");
        if (url.includes("/health")) return healthOk();
        return new Response("not found", { status: 404 });
      }) as typeof fetch;
      const { client: c } = client();
      expect(await c.checkStatus()).toMatchObject({ available: true, protocol: "https" });
    });

    test("caches within the TTL and re-probes after it expires", async () => {
      let probeCount = 0;
      mockFetch({
        "/health": () => {
          probeCount++;
          return healthOk();
        },
      });
      const { client: c } = client();

      expect((await c.checkStatus()).available).toBe(true);
      const probesAfterFirst = probeCount;
      expect((await c.checkStatus()).available).toBe(true);
      expect(probeCount).toBe(probesAfterFirst);

      const realNow = performance.now.bind(performance);
      performance.now = () => realNow() + 11_000;
      try {
        await c.checkStatus();
        expect(probeCount).toBeGreaterThan(probesAfterFirst);
      } finally {
        performance.now = realNow;
      }
    });

    test("the detected protocol is the one the prove POST uses", async () => {
      const { fetchedUrls } = mockFetch({ "/health": healthOk });
      const { client: c } = client();
      await c.prove(PROVE);
      const proveUrls = fetchedUrls.filter((u) => u.includes("/prove"));
      expect(proveUrls.length).toBe(1);
      expect(proveUrls[0]).toMatch(/^https?:\/\/127\.0\.0\.1:\d+\/prove$/);
    });

    test("configure() resets the protocol and invalidates the status cache", async () => {
      mockFetch({ "/health": healthOk });
      const { client: c } = client();
      expect((await c.checkStatus()).available).toBe(true);

      // Reconfigure, then make the new endpoint unreachable: a stale hit would still say true.
      c.configure({ port: 12345 });
      mockFetchOffline();
      expect((await c.checkStatus()).available).toBe(false);
    });
  });

  // biome-ignore lint/complexity/noExcessiveLinesPerFunction: Suite registration is not production control flow.
  describe("configuration", () => {
    test.each([
      ["browser default", undefined, undefined, true, true],
      ["server default", undefined, undefined, false, false],
      ["browser env false", undefined, "false", true, false],
      ["server env true", undefined, "TRUE", false, true],
      ["browser env zero", undefined, "0", true, false],
      ["server env one", undefined, "1", false, true],
      ["option false beats env true", false, "true", true, false],
      ["option true beats env false", true, "false", false, true],
      ["invalid env keeps browser default", undefined, "yes", true, true],
      ["invalid env keeps server default", undefined, "yes", false, false],
    ] as const)("resolves HTTPS policy: %s", (_name, option, environment, browser, expected) => {
      expect(resolveHttpsOnly(option, environment, browser)).toBe(expected);
    });

    test("detects page, worker, and server runtimes for the default policy", () => {
      const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
      const workerDescriptor = Object.getOwnPropertyDescriptor(globalThis, "WorkerGlobalScope");
      try {
        Reflect.deleteProperty(globalThis, "window");
        Reflect.deleteProperty(globalThis, "WorkerGlobalScope");
        expect(isBrowserRuntime()).toBe(false);

        Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
        expect(isBrowserRuntime()).toBe(true);
        Reflect.deleteProperty(globalThis, "window");

        const MockWorkerGlobalScope = function MockWorkerGlobalScope() {};
        Object.defineProperty(MockWorkerGlobalScope, Symbol.hasInstance, {
          value: (value: unknown) => value === globalThis,
        });
        Object.defineProperty(globalThis, "WorkerGlobalScope", {
          configurable: true,
          value: MockWorkerGlobalScope,
        });
        expect(isBrowserRuntime()).toBe(true);
      } finally {
        if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
        else Reflect.deleteProperty(globalThis, "window");
        if (workerDescriptor)
          Object.defineProperty(globalThis, "WorkerGlobalScope", workerDescriptor);
        else Reflect.deleteProperty(globalThis, "WorkerGlobalScope");
      }
    });

    test("session consent enables HTTP only on that browser client instance", async () => {
      const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
      const envValue = process.env.PRESTO_HTTPS_ONLY;
      Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
      delete process.env.PRESTO_HTTPS_ONLY;
      globalThis.fetch = mock(async (input: RequestInfo | URL) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url.startsWith("https://")) throw new TypeError("TLS unavailable");
        return Response.json({
          status: "ok",
          api_version: 1,
          version: "3.0.0",
          aztec_version: AZTEC,
          available_versions: [AZTEC],
          bb_available: true,
        });
      }) as typeof fetch;

      try {
        const { client: consented } = client();
        expect(await consented.checkStatus()).toMatchObject({
          available: false,
          reason: "secure-connection-unavailable",
        });

        consented.configure({ httpsOnly: false, allowInsecureDowngrade: true });
        expect(await consented.checkStatus({ forceRefresh: true })).toMatchObject({
          available: true,
          protocol: "http",
        });

        const { client: fresh } = client();
        expect(await fresh.checkStatus()).toMatchObject({
          available: false,
          reason: "secure-connection-unavailable",
        });
      } finally {
        if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
        else Reflect.deleteProperty(globalThis, "window");
        if (envValue === undefined) delete process.env.PRESTO_HTTPS_ONLY;
        else process.env.PRESTO_HTTPS_ONLY = envValue;
      }
    }, 15_000);

    test.each([
      ["an invalid PRESTO_PORT falls back to the default", "not-a-number", ":59833"],
      ["PRESTO_PORT overrides the default", "51337", ":51337"],
    ])("%s", async (_name, value, expectedPort) => {
      const { fetchedUrls } = mockFetch({ "/health": healthOk });
      const originalPort = process.env.PRESTO_PORT;
      process.env.PRESTO_PORT = value;
      try {
        await new PrestoClient().checkStatus();
        const healthUrls = fetchedUrls.filter((u) => u.includes("/health"));
        expect(healthUrls.some((u) => u.includes(expectedPort))).toBe(true);
        expect(healthUrls.every((u) => !u.includes("NaN"))).toBe(true);
      } finally {
        if (originalPort === undefined) delete process.env.PRESTO_PORT;
        else process.env.PRESTO_PORT = originalPort;
      }
    });
  });

  // Strict health contract, single-flight probes, and the prove network-failure demotion path.
  // biome-ignore lint/complexity/noExcessiveLinesPerFunction: Suite registration is not production control flow.
  describe("hardening — strict health contract + prove demotion", () => {
    test("a 200 with foreign JSON (no status/api_version contract) is 'error', never available", async () => {
      mockFetch({ "/health": () => Response.json({ status: false, hello: "world" }) });
      const { client: c } = client();
      expect(await c.checkStatus()).toMatchObject({ available: false, reason: "error" });
    });

    test("httpsOnly: a 200 array body is 'error' (strict mode enforces the contract too)", async () => {
      mockFetch({ "/health": () => Response.json([]) });
      const { client: c } = client({ presto: { httpsOnly: true } });
      expect(await c.checkStatus()).toMatchObject({ available: false, reason: "error" });
    });

    test("concurrent status checks share one in-flight probe (single-flight)", async () => {
      let healthCalls = 0;
      mockFetch({
        "/health": () => {
          healthCalls++;
          return healthOk();
        },
      });
      const { client: c } = client();
      const [a, b, d] = await Promise.all([c.checkStatus(), c.checkStatus(), c.checkStatus()]);
      expect(a.available).toBe(true);
      expect(b).toEqual(a);
      expect(d).toEqual(a);
      // One dual probe = at most 2 /health requests (http + https) — NOT 2 per caller.
      expect(healthCalls).toBeLessThanOrEqual(2);
    });

    // "Prefer HTTPS" is "never downgrade FROM a working HTTPS", with an opt-out: any local account
    // can bind 127.0.0.1:59833 and satisfy the health SHAPE contract, so a cross-user attacker who
    // could make the HTTPS prove fail would otherwise receive the private witness in cleartext.
    const downgradeScenario = () =>
      mockFetch({
        "http://127.0.0.1:59833/health": healthOk,
        "https://127.0.0.1:59834/health": healthOk,
        "https://127.0.0.1:59834/prove": () => {
          throw new TypeError("TLS handshake failed");
        },
        "http://127.0.0.1:59833/prove": () => Response.json({ proof: "" }),
      });

    test("a failed HTTPS prove is NOT retried over plaintext HTTP by default", async () => {
      const { fetchedUrls } = downgradeScenario();
      const { client: c } = client();
      // Once HTTPS has answered here the effective policy is secure-only, so the UI hears that too.
      expect(await c.prove(PROVE)).toEqual({
        kind: "fallback",
        reason: "network",
        phase: "secure-connection-unavailable",
      });
      expect(fetchedUrls).toContain("https://127.0.0.1:59834/prove");
      expect(fetchedUrls).not.toContain("http://127.0.0.1:59833/prove");
    });

    test("an unreadable body on the HTTP retry degrades instead of reaching the dApp", async () => {
      mockFetch({
        "http://127.0.0.1:59833/health": healthOk,
        "https://127.0.0.1:59834/health": healthOk,
        "https://127.0.0.1:59834/prove": () => {
          throw new TypeError("TLS handshake failed");
        },
        // The retry succeeds at the network layer, then returns a body past the 8 MiB cap.
        "http://127.0.0.1:59833/prove": () => Response.json({ proof: "A".repeat(9 * 1024 * 1024) }),
      });
      const { client: c } = client({ presto: { allowInsecureDowngrade: true } });
      expect(await c.prove(PROVE)).toEqual({ kind: "fallback", reason: "malformed-response" });
    });

    test("allowInsecureDowngrade opts back into the HTTP retry", async () => {
      const { fetchedUrls } = downgradeScenario();
      const { client: c } = client({ presto: { allowInsecureDowngrade: true } });
      expect(await c.prove(PROVE)).toMatchObject({ kind: "native", body: { proof: "" } });
      expect(fetchedUrls).toContain("https://127.0.0.1:59834/prove");
      expect(fetchedUrls).toContain("http://127.0.0.1:59833/prove");
    });

    test("the witness is NEVER downgraded to an HTTP endpoint that fails the health contract", async () => {
      const { fetchedUrls } = mockFetch({
        // Something else is on the HTTP port: 200 JSON, but NOT the presto's contract.
        "http://127.0.0.1:59833/health": () => Response.json({ hello: "not the presto" }),
        "https://127.0.0.1:59834/health": healthOk,
        "https://127.0.0.1:59834/prove": () => {
          throw new TypeError("TLS handshake failed");
        },
        // If this is ever reached, the witness has gone to the foreign responder.
        "http://127.0.0.1:59833/prove": () => Response.json({ proof: "" }),
      });
      const { client: c } = client({ presto: { allowInsecureDowngrade: true } });
      expect(await c.prove(PROVE)).toEqual({ kind: "fallback", reason: "network" });
      expect(fetchedUrls).toContain("https://127.0.0.1:59834/prove");
      expect(fetchedUrls).not.toContain("http://127.0.0.1:59833/prove");
    });

    test("httpsOnly: a prove network failure degrades with secure-connection-unavailable, never a plaintext retry", async () => {
      const { fetchedUrls } = mockFetch({
        "https://127.0.0.1:59834/health": healthOk,
        "https://127.0.0.1:59834/prove": () => {
          throw new TypeError("TLS handshake failed");
        },
      });
      const { client: c, phases } = client({ presto: { httpsOnly: true } });
      expect(await c.prove(PROVE)).toEqual({
        kind: "fallback",
        reason: "network",
        phase: "secure-connection-unavailable",
      });
      expect(fetchedUrls.every((u) => !u.startsWith("http://"))).toBe(true);
      expect(phases.at(-1)).toBe("secure-connection-unavailable");
    });

    test("a proof reconfigured mid-flight does NOT retry against the new endpoint", async () => {
      const { client: c } = client({ presto: { allowInsecureDowngrade: true } });
      const { fetchedUrls } = mockFetch({
        "http://127.0.0.1:59833/health": () => {
          throw new TypeError("refused");
        },
        "https://127.0.0.1:59834/health": healthOk,
        "https://127.0.0.1:59834/prove": () => {
          c.configure({ port: 51337, httpsPort: 51338 });
          throw new TypeError("TLS handshake failed");
        },
      });
      expect(await c.prove(PROVE)).toEqual({ kind: "fallback", reason: "endpoint-changed" });
      expect(fetchedUrls.some((u) => u.includes("51337") || u.includes("51338"))).toBe(false);
    });

    test("an onPhase callback that reconfigures mid-proof cannot redirect the witness", async () => {
      let c!: PrestoClient;
      c = new PrestoClient({
        aztecVersion: AZTEC,
        onPhase: (phase) => {
          // Reconfigure at the last possible moment before transmission.
          if (phase === "transmit") c.configure({ port: 51337, httpsPort: 51338 });
        },
      });
      const { fetchedUrls } = mockFetch({
        "127.0.0.1:59833/health": healthOk,
        "127.0.0.1:59833/prove": () => Response.json({ proof: "" }),
      });
      expect(await c.prove(PROVE)).toEqual({ kind: "fallback", reason: "endpoint-changed" });
      expect(fetchedUrls.some((u) => u.includes("51337") || u.includes("51338"))).toBe(false);
    });

    test("a status from a probe whose endpoint changed mid-flight does not drive a remote prove", async () => {
      const { client: c } = client();
      const { fetchedUrls } = mockFetch({
        "/health": async () => {
          // Reconfigure while the probe is in flight, then answer healthy for the OLD endpoint.
          c.configure({ port: 51337, httpsPort: 51338 });
          return healthOk();
        },
      });
      expect(await c.prove(PROVE)).toEqual({ kind: "fallback", reason: "endpoint-changed" });
      expect(fetchedUrls.some((u) => u.includes("/prove"))).toBe(false);
    });

    test("a concurrent proof never inherits another proof's HTTP demotion", async () => {
      // Proof A fails over HTTPS and demotes the pin while it validates HTTP; proof B, already past
      // its own HTTPS check, must not read the demoted pin and post plaintext to a port nobody
      // validated. B's continuation has no hook, so B is started after `depth` microtasks from A's
      // failure and the sweep must include the alignment where B chooses its URL after A's demotion
      // — observable as B's HTTPS POST landing after A's HTTP health check.
      let coveredTheWindow = false;
      for (let depth = 0; depth < 8; depth++) {
        const { client: c } = client({ presto: { allowInsecureDowngrade: true } });
        let second: Promise<ProveOutcome> | null = null;
        const startSecond = (hops: number) => {
          if (hops === 0) second = c.prove(PROVE);
          else queueMicrotask(() => startSecond(hops - 1));
        };
        const { fetchedUrls } = mockFetch({
          "http://127.0.0.1:59833/health": () => Response.json({ hello: "not the presto" }),
          "https://127.0.0.1:59834/health": healthOk,
          "https://127.0.0.1:59834/prove": () => {
            if (!second) startSecond(depth);
            throw new TypeError("TLS handshake failed");
          },
          // If this is ever reached, a witness went to the foreign responder.
          "http://127.0.0.1:59833/prove": () => Response.json({ proof: "" }),
        });
        expect(await c.prove(PROVE)).toEqual({ kind: "fallback", reason: "network" });
        expect(await second).toEqual({ kind: "fallback", reason: "network" });
        expect(fetchedUrls).not.toContain("http://127.0.0.1:59833/prove");
        // The window: A's POST, then A's HTTP retry check, then B's POST — with B having reused
        // the original status (one HTTPS probe before its POST, none of its own).
        const aPost = fetchedUrls.indexOf("https://127.0.0.1:59834/prove");
        const retryHealth = fetchedUrls.indexOf("http://127.0.0.1:59833/health", aPost + 1);
        const bPost = fetchedUrls.lastIndexOf("https://127.0.0.1:59834/prove");
        const httpsProbesBeforeB = fetchedUrls
          .slice(0, bPost)
          .filter((u) => u === "https://127.0.0.1:59834/health").length;
        if (retryHealth > aPost && bPost > retryHealth && httpsProbesBeforeB === 1) {
          coveredTheWindow = true;
        }
      }
      expect(coveredTheWindow).toBe(true);
    });

    test("a caller cannot redirect its own witness by mutating the status it was handed", async () => {
      const { fetchedUrls } = mockFetch({
        "https://127.0.0.1:59834/health": healthOk,
        "https://127.0.0.1:59834/prove": () => Response.json({ proof: "" }),
        "http://127.0.0.1:59833/prove": () => Response.json({ proof: "" }),
      });
      const { client: c } = client({ presto: { httpsOnly: true } });
      const status = await c.checkStatus();
      expect(Object.isFrozen(status)).toBe(true);
      if (status.available) {
        expect(() => {
          (status as { protocol: string }).protocol = "http";
        }).toThrow();
      }
      expect(await c.prove(PROVE)).toMatchObject({ kind: "native" });
      expect(fetchedUrls).not.toContain("http://127.0.0.1:59833/prove");
    });

    test("a payload whose iteration reconfigures the client is not sent anywhere", async () => {
      const { client: c } = client();
      const { fetchedUrls } = mockFetch({
        "127.0.0.1:59833/health": healthOk,
        "127.0.0.1:59833/prove": () => Response.json({ proof: "" }),
      });
      // `Uint8Array.from` iterates whatever `body()` returns; this iterable runs caller code then.
      const body = () =>
        ({
          *[Symbol.iterator]() {
            c.configure({ port: 51337, httpsPort: 51338 });
            yield* [1, 2, 3];
          },
        }) as unknown as Uint8Array;
      expect(await c.prove({ ...PROVE, body })).toEqual({
        kind: "fallback",
        reason: "endpoint-changed",
      });
      expect(fetchedUrls.some((u) => u.includes("/prove"))).toBe(false);
    });

    test("two concurrent proofs failing over the pinned HTTPS BOTH degrade (neither left with the raw error)", async () => {
      const { client: c } = client({ presto: { allowInsecureDowngrade: true } });
      mockFetch({
        "http://127.0.0.1:59833/health": () => {
          throw new TypeError("refused");
        },
        "https://127.0.0.1:59834/health": healthOk,
        "https://127.0.0.1:59834/prove": () => {
          throw new TypeError("TLS handshake failed");
        },
        "http://127.0.0.1:59833/prove": () => {
          throw new TypeError("refused");
        },
      });
      const results = await Promise.all([c.prove(PROVE), c.prove(PROVE)]);
      for (const outcome of results)
        expect(outcome).toEqual({ kind: "fallback", reason: "network" });
    });

    test("a probe raced by configure() cannot pin the new endpoint (generation guard)", async () => {
      mockFetch({
        "/health": async () => {
          await new Promise((r) => setTimeout(r, 150));
          return healthOk();
        },
      });
      const { client: c } = client();
      const statusP = c.checkStatus(); // in flight against A
      c.configure({ port: 51337, httpsPort: 51338 }); // now B
      await statusP; // A's probe completes; its commit must be discarded

      // A fresh check against B must actually probe B (no stale cache/pin from A's commit).
      const { fetchedUrls } = mockFetch({ "/health": healthOk });
      expect((await c.checkStatus()).available).toBe(true);
      expect(fetchedUrls.some((u) => u.includes(":51337") || u.includes(":51338"))).toBe(true);
    });
  });

  // A non-2xx response must keep its HTTP classification even when its body stalls, overflows the
  // cap, or is garbage — body-read failure demoting the error to the network-failure path would mask
  // misconfigurations and, worse, could activate the plaintext downgrade retry with the witness.
  // biome-ignore lint/complexity/noExcessiveLinesPerFunction: Suite registration is not production control flow.
  describe("classification with unreadable error bodies", () => {
    /** A response whose body stream never produces a chunk — the bounded reader must deadline it. */
    const stalledBody = (status: number) =>
      new Response(new ReadableStream({ start() {} }), {
        status,
        headers: { "content-type": "text/plain" },
      });
    const retryScenario = (httpProve: RouteHandler) =>
      mockFetch({
        "http://127.0.0.1:59833/health": healthOk,
        "https://127.0.0.1:59834/health": healthOk,
        "https://127.0.0.1:59834/prove": () => {
          throw new TypeError("TLS handshake failed");
        },
        "http://127.0.0.1:59833/prove": httpProve,
      });

    test("stalled body on a recognized status (403) still degrades by status — denied", async () => {
      mockFetch({ "/health": healthOk, "/prove": () => stalledBody(403) });
      const { client: c } = client();
      expect(await c.prove(PROVE)).toEqual({ kind: "fallback", reason: "denied", phase: "denied" });
    }, 15_000);

    test.each([
      [
        "malformed",
        () =>
          new Response("<<<not json>>>", {
            status: 418,
            headers: { "content-type": "text/plain" },
          }),
      ],
      [
        "over-cap",
        () =>
          new Response(`"${"A".repeat(128 * 1024)}"`, {
            status: 418,
            headers: { "content-type": "text/plain" },
          }),
      ],
    ])(
      "%s body on an unrecognized status (418) throws typed with the status preserved",
      async (_name, prove) => {
        mockFetch({ "/health": healthOk, "/prove": prove });
        const { client: c } = client();
        const err = await c.prove(PROVE).catch((e) => e);
        expect(err).toBeInstanceOf(PrestoHttpError);
        expect(err.status).toBe(418);
        expect(err.code).toBeUndefined();
      },
    );

    test.each([
      ["stalled", () => stalledBody(418)],
      [
        "over-cap",
        () =>
          new Response(`"${"A".repeat(128 * 1024)}"`, {
            status: 418,
            headers: { "content-type": "text/plain" },
          }),
      ],
      [
        "malformed",
        () => new Response("garbage", { status: 418, headers: { "content-type": "text/plain" } }),
      ],
    ])(
      "%s body on the HTTP downgrade retry keeps HTTP classification (typed throw)",
      async (_name, prove) => {
        const { fetchedUrls } = retryScenario(prove);
        const { client: c } = client({ presto: { allowInsecureDowngrade: true } });
        const err = await c.prove(PROVE).catch((e) => e);
        expect(fetchedUrls).toContain("http://127.0.0.1:59833/prove"); // the retry actually ran
        expect(err).toBeInstanceOf(PrestoHttpError);
        expect(err.status).toBe(418);
      },
      15_000,
    );

    test.each([
      [
        "text/plain string",
        () =>
          new Response(JSON.stringify({ error: "some_unknown_fault", message: "boom" }), {
            status: 500,
            headers: { "content-type": "text/plain" },
          }),
        "boom",
      ],
      [
        "application/json object",
        () => Response.json({ error: "some_unknown_fault" }, { status: 500 }),
        undefined,
      ],
    ])(
      "error-body shape follows content-type: %s carries the code end-to-end",
      async (_name, prove, message) => {
        mockFetch({ "/health": healthOk, "/prove": prove });
        const { client: c } = client();
        const err = await c.prove(PROVE).catch((e) => e);
        expect(err).toBeInstanceOf(PrestoHttpError);
        expect(err.status).toBe(500);
        expect(err.code).toBe("some_unknown_fault");
        if (message) expect(err.message).toBe(message);
      },
    );
  });
});

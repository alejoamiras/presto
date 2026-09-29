import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { handleRequest } from "./index";

const TOKEN = "fake-token-4f9c2a7e1b";
const ENV = { AZTEC_NODE_URL: `https://node.example.test/${TOKEN}` };
const FORWARDER = "https://presto-testnet-rpc.alejo-amiras.workers.dev/";
const PLAYGROUND = "https://playground.presto.build";
const CALL = { jsonrpc: "2.0", id: 1, method: "aztec_getNodeInfo", params: [] };

function post(body: unknown, origin?: string, url = FORWARDER): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (origin) headers.Origin = origin;
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Request(url, { method: "POST", headers, body: text });
}

function mockUpstream(response: () => Response | Promise<Response>) {
  return spyOn(globalThis, "fetch").mockImplementation((async () =>
    response()) as unknown as typeof fetch);
}

const escaped = [...TOKEN].map((c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
const json = (text: string, status = 200) =>
  new Response(text, { status, headers: { "Content-Type": "application/json" } });

afterEach(() => {
  (globalThis.fetch as { mockRestore?: () => void }).mockRestore?.();
});

describe("testnet RPC forwarder: requests", () => {
  test("forwards one call or a batch unchanged and returns the node's answer", async () => {
    const answer = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { nodeVersion: "6.0.0-rc.1" } });
    const upstream = mockUpstream(
      () =>
        new Response(answer, {
          headers: { "Content-Type": "application/json", "x-aztec-rollupVersion": "2914217885" },
        }),
    );

    for (const body of [CALL, [CALL, { ...CALL, id: 2, method: "node_getBlockNumber" }]]) {
      const response = await handleRequest(post(body, PLAYGROUND), ENV);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(answer);
      expect(response.headers.get("access-control-allow-origin")).toBe(PLAYGROUND);
      expect(response.headers.get("access-control-expose-headers")).toBe("x-aztec-rollupversion");
      expect(response.headers.get("x-aztec-rollupversion")).toBe("2914217885");
      expect(response.headers.get("cache-control")).toBe("no-store");

      const [url, init] = upstream.mock.calls.at(-1) as [URL, RequestInit];
      expect(url.href).toBe(ENV.AZTEC_NODE_URL);
      expect(init.method).toBe("POST");
      expect(new TextDecoder().decode(init.body as Uint8Array)).toBe(JSON.stringify(body));
    }
  });

  test.each([
    PLAYGROUND,
    "https://presto-playground.alejo-amiras.workers.dev",
    "https://aztec-v6-migration-presto-playground.alejo-amiras.workers.dev",
    "http://localhost:5173",
  ])("answers the CORS preflight from %s", async (origin) => {
    const response = await handleRequest(
      new Request(FORWARDER, { method: "OPTIONS", headers: { Origin: origin } }),
      ENV,
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(origin);
    expect(response.headers.get("access-control-allow-headers")).toBe("Content-Type");
  });

  test.each([
    ["a foreign origin", post(CALL, "https://evil.example"), 403],
    ["an admin method", post({ ...CALL, method: "aztecAdmin_setConfig" }), 403],
    ["a p2p method hidden in a batch", post([CALL, { ...CALL, method: "p2p_getPeers" }]), 403],
    ["a call without a method", post({ jsonrpc: "2.0", id: 1 }), 400],
    ["an empty batch", post([]), 400],
    ["malformed JSON", post("{"), 400],
    ["a body over 8 MiB", post(" ".repeat(8 * 1024 * 1024 + 1)), 413],
    ["a GET", new Request(FORWARDER), 405],
    ["another path", post(CALL, undefined, `${FORWARDER}k/anything`), 404],
  ])("refuses %s without contacting the node", async (_name, request, status) => {
    const upstream = mockUpstream(() => new Response("{}"));
    const response = await handleRequest(request, ENV);
    expect(response.status).toBe(status);
    expect(upstream).not.toHaveBeenCalled();
  });

  test.each([{}, { AZTEC_NODE_URL: "http://node.example.test/plain" }, { AZTEC_NODE_URL: "no" }])(
    "is unavailable without an https upstream",
    async (env) => {
      const upstream = mockUpstream(() => new Response("{}"));
      const response = await handleRequest(post(CALL), env);
      expect(response.status).toBe(503);
      expect(upstream).not.toHaveBeenCalled();
    },
  );
});

describe("testnet RPC forwarder: upstream answers", () => {
  test("passes a node error through, and relays only safe headers", async () => {
    const nodeError = JSON.stringify({ jsonrpc: "2.0", id: 1, error: { message: "Tx dropped" } });
    mockUpstream(
      () =>
        new Response(nodeError, {
          status: 400,
          headers: {
            "Content-Type": `application/json; key=${TOKEN}`,
            "x-aztec-rollupVersion": "2914217885",
            "x-aztec-debug": `upstream ${TOKEN}`,
          },
        }),
    );
    const response = await handleRequest(post(CALL, PLAYGROUND), ENV);
    expect(response.status).toBe(400);
    expect(await response.text()).toBe(nodeError);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("x-aztec-debug")).toBeNull();
    expect(response.headers.get("access-control-expose-headers")).toBe("x-aztec-rollupversion");
  });

  test.each([
    ["an echoed key", () => json(`{"error":"invalid key ${TOKEN}"}`, 401)],
    ["a \\u-escaped key", () => json(`{"error":"invalid key ${escaped.join("")}"}`, 401)],
    ["an upper-cased key", () => json(`{"error":"INVALID KEY ${TOKEN.toUpperCase()}"}`, 401)],
    ["a non-JSON page", () => new Response("<h1>Sign in</h1>")],
    ["an answer over 16 MiB", () => json(`"${" ".repeat(16 * 1024 * 1024)}"`)],
    [
      "a fetch error naming the upstream",
      () => {
        throw new Error(`connect failed: ${ENV.AZTEC_NODE_URL}`);
      },
    ],
  ])("turns %s into a fixed 502", async (_name, answer) => {
    mockUpstream(answer);
    const response = await handleRequest(post(CALL), ENV);
    expect(response.status).toBe(502);
    expect((await response.text()).toLowerCase()).not.toContain(TOKEN);
  });
});

/**
 * Public stand-in for the private v6 testnet RPC: forwards node JSON-RPC to the `AZTEC_NODE_URL`
 * secret without ever returning any part of that URL.
 */
export interface ForwarderEnv {
  AZTEC_NODE_URL?: string;
}

const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
// Bounds the isolate's memory per call; the node's answers to the playground are far smaller.
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
// Matches the Aztec JSON-RPC client's largest batch.
const MAX_BATCH = 100;
// The node's public namespaces; `aztec_*` is v6's, `node_*` its legacy alias.
const METHOD = /^(aztec|node)_[A-Za-z][A-Za-z0-9]*$/;
const JSON_TYPE = /^application\/json\s*(;|$)/i;
const ALLOWED_ORIGINS = [
  /^https:\/\/playground\.presto\.build$/,
  /^https:\/\/([a-z0-9-]+-)?presto-playground\.alejo-amiras\.workers\.dev$/,
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/,
];

type Rejection = { status: number; code: number; message: string };

function allowedOrigin(origin: string | null): boolean {
  return origin === null || ALLOWED_ORIGINS.some((pattern) => pattern.test(origin));
}

function corsHeaders(origin: string | null): Headers {
  const headers = new Headers({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  if (origin !== null) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }
  return headers;
}

function rpcError(origin: string | null, { status, code, message }: Rejection): Response {
  const headers = corsHeaders(origin);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code, message } }), {
    status,
    headers,
  });
}

function upstreamUrl(env: ForwarderEnv): URL | null {
  if (!env.AZTEC_NODE_URL || !URL.canParse(env.AZTEC_NODE_URL)) return null;
  const url = new URL(env.AZTEC_NODE_URL);
  return url.protocol === "https:" ? url : null;
}

/** Matches any piece of the upstream URL that must never reach a caller, in any letter case. */
function secretPattern(upstream: URL): RegExp {
  const pieces = [
    upstream.host,
    upstream.username,
    upstream.password,
    ...upstream.pathname.split("/"),
    ...upstream.searchParams.values(),
  ].filter((piece) => piece.length >= 8);
  const alternatives = pieces.map((piece) => piece.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(alternatives.join("|") || "(?!)", "i");
}

/** Tests text as JSON would read it: `\uXXXX` and `\/` spell the characters they escape. */
function carriesSecret(text: string, secret: RegExp): boolean {
  const decoded = text.includes("\\")
    ? text.replace(/\\u([0-9a-fA-F]{4})|\\\//g, (_, hex?: string) =>
        hex ? String.fromCharCode(Number.parseInt(hex, 16)) : "/",
      )
    : text;
  return secret.test(decoded);
}

/** Reads at most `limit` bytes; breaking out of the loop cancels the rest of the stream. */
async function readCapped(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  if (body === null) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of body) {
    size += chunk.byteLength;
    if (size > limit) return null;
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Accepts one call or a non-empty batch, every method in the node's public namespaces. */
function checkCalls(bytes: Uint8Array): Rejection | null {
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return { status: 400, code: -32700, message: "Parse error" };
  }
  const calls = Array.isArray(payload) ? payload : [payload];
  if (calls.length === 0 || calls.length > MAX_BATCH) {
    return { status: 400, code: -32600, message: "Invalid request" };
  }
  for (const call of calls) {
    const method = typeof call === "object" && call !== null ? Reflect.get(call, "method") : null;
    if (typeof method !== "string")
      return { status: 400, code: -32600, message: "Invalid request" };
    if (!METHOD.test(method)) return { status: 403, code: -32601, message: "Method not allowed" };
  }
  return null;
}

export async function handleRequest(request: Request, env: ForwarderEnv): Promise<Response> {
  const origin = request.headers.get("Origin");
  if (new URL(request.url).pathname !== "/") return new Response("Not Found", { status: 404 });
  if (!allowedOrigin(origin)) return new Response("Forbidden", { status: 403 });

  if (request.method === "OPTIONS") {
    const headers = corsHeaders(origin);
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type");
    headers.set("Access-Control-Max-Age", "86400");
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST, OPTIONS" } });
  }

  const upstream = upstreamUrl(env);
  if (upstream === null) {
    return rpcError(origin, { status: 503, code: -32603, message: "Forwarder not configured" });
  }
  const bytes = await readCapped(request.body, MAX_REQUEST_BYTES);
  if (bytes === null) {
    return rpcError(origin, { status: 413, code: -32600, message: "Request too large" });
  }
  const rejection = checkCalls(bytes);
  if (rejection !== null) return rpcError(origin, rejection);

  return forward(upstream, bytes, origin);
}

/** Relays only a bounded JSON answer that names no piece of the upstream URL. */
async function forward(upstream: URL, bytes: Uint8Array<ArrayBuffer>, origin: string | null) {
  let response: Response;
  let body: Uint8Array | null;
  try {
    response = await fetch(upstream, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: bytes,
    });
    body = await readCapped(response.body, MAX_RESPONSE_BYTES);
  } catch {
    // The runtime's fetch error text can name the upstream, so it is never forwarded.
    return rpcError(origin, { status: 502, code: -32603, message: "Upstream unreachable" });
  }
  if (body === null) {
    return rpcError(origin, { status: 502, code: -32603, message: "Upstream answer too large" });
  }
  let text: string | null = null;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {}
  // A gateway rejecting a revoked key can echo it back, in its body or its headers.
  const secret = secretPattern(upstream);
  if (
    text === null ||
    !JSON_TYPE.test(response.headers.get("Content-Type") ?? "") ||
    carriesSecret(text, secret)
  ) {
    return rpcError(origin, { status: 502, code: -32603, message: "Upstream error" });
  }

  const headers = corsHeaders(origin);
  headers.set("Content-Type", "application/json");
  const versionHeaders: string[] = [];
  for (const [name, value] of response.headers) {
    if (name.startsWith("x-aztec-") && !carriesSecret(value, secret)) {
      headers.set(name, value);
      versionHeaders.push(name);
    }
  }
  if (origin !== null && versionHeaders.length > 0) {
    headers.set("Access-Control-Expose-Headers", versionHeaders.join(", "));
  }
  return new Response(text, { status: response.status, headers });
}

export default {
  fetch: (request: Request, env: ForwarderEnv) => handleRequest(request, env),
};

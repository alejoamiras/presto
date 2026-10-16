const STABLE_KEY = "latest.json";
const CANDIDATE_KEY = "latest-rc.json";

// The release pipeline's version grammar: stable `X.Y.Z` or candidate `X.Y.Z-rc.N`.
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-rc\.(?:0|[1-9]\d*))?$/;

type Version = { core: [bigint, bigint, bigint]; prerelease: boolean };
type Feed = (kv: KVNamespace) => Promise<string | ReadableStream | null>;

class Refused extends Error {}

// `/releases/download/*` stays 404: smoke feeds and legacy prerelease manifests name it, and this
// route is what keeps them from ever being served artifacts.
const FEEDS = new Map<string, Feed>([
  ["/releases/latest.json", stableFeed],
  ["/releases/latest-rc.json", candidateFeed],
  [
    "/releases/verified-sites.json",
    (kv) => kv.get("verified-sites.json", { type: "stream", cacheTtl: 60 }),
  ],
]);

function readFeed(kv: KVNamespace, key: string): Promise<string | null> {
  return kv.get(key, { type: "text", cacheTtl: 60 });
}

function versionOf(body: string, key: string): Version {
  let version: unknown;
  try {
    version = (JSON.parse(body) as { version?: unknown } | null)?.version;
  } catch {
    throw new Refused(`${key} is not JSON`);
  }
  const match = typeof version === "string" ? VERSION.exec(version) : null;
  if (!match) throw new Refused(`${key} has no release version`);
  const [, major, minor, patch, rc] = match;
  return { core: [BigInt(major), BigInt(minor), BigInt(patch)], prerelease: rc !== undefined };
}

/** SemVer precedence for a candidate over a stable: a stable outranks every candidate of its version. */
function candidateIsNewer(candidate: Version, stable: Version): boolean {
  for (let i = 0; i < 3; i++) {
    if (candidate.core[i] !== stable.core[i]) return candidate.core[i] > stable.core[i];
  }
  return false;
}

// The plugin reads a 204 as "no update" and a non-JSON body as a hard error, and moves to the next
// endpoint on neither, so every refusal here is a 503.
async function stableFeed(kv: KVNamespace): Promise<string | null> {
  const body = await readFeed(kv, STABLE_KEY);
  if (body !== null && versionOf(body, STABLE_KEY).prerelease) {
    throw new Refused(`${STABLE_KEY} holds a prerelease`);
  }
  return body;
}

async function candidateFeed(kv: KVNamespace): Promise<string | null> {
  const [stable, candidate] = await Promise.all([
    readFeed(kv, STABLE_KEY),
    readFeed(kv, CANDIDATE_KEY),
  ]);
  if (stable === null) return null;
  const stableVersion = versionOf(stable, STABLE_KEY);
  if (stableVersion.prerelease) throw new Refused(`${STABLE_KEY} holds a prerelease`);
  if (candidate === null) return stable;
  const candidateVersion = versionOf(candidate, CANDIDATE_KEY);
  if (!candidateVersion.prerelease) throw new Refused(`${CANDIDATE_KEY} holds a stable release`);
  return candidateIsNewer(candidateVersion, stableVersion) ? candidate : stable;
}

function headers(): Headers {
  return new Headers({
    "Cache-Control": "public, max-age=300",
    "Content-Type": "application/json; charset=utf-8",
    "Cross-Origin-Embedder-Policy": "credentialless",
    "Cross-Origin-Opener-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
    "Access-Control-Allow-Origin": "*",
  });
}

function unavailable(): Response {
  return new Response("Feed unavailable", {
    status: 503,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const path = new URL(request.url).pathname;
  const feed = FEEDS.get(path);
  if (feed === undefined) {
    return new Response("Not Found", { status: 404 });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD" },
    });
  }

  try {
    const body = await feed(env.PRESTO_RELEASE_FEED);
    if (body === null) return unavailable();
    return new Response(request.method === "HEAD" ? null : body, { headers: headers() });
  } catch (error) {
    console.error(
      JSON.stringify({
        message: error instanceof Refused ? "release feed refused" : "release feed read failed",
        path,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return unavailable();
  }
}

export default {
  fetch: handleRequest,
} satisfies ExportedHandler<Env>;

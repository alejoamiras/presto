/**
 * Local HTTPS feed server for the release-time updater smoke test.
 *
 * Impersonates `https://presto.build` on the CI runner (paired with an
 * `/etc/hosts` entry + a trusted local CA — see updater-smoke.sh). Serves:
 *   - GET /releases/latest.json        → the synthesized feed for version N
 *   - GET /releases/download/<file>    → the (already prod-signed) N artifacts
 *
 * The Tauri updater in the N-1 binary fetches the hardcoded endpoint
 * (https://presto.build/releases/latest.json), then downloads the
 * artifact URL from the feed and verifies its `.sig` against the embedded
 * prod pubkey. We serve the real signed artifacts, so NO signing key is needed.
 *
 * `--feed-dir <dir>` replaces `--latest-json`: `/releases/latest.json` and `/releases/latest-rc.json`
 * answer from `<dir>/<name>`, or with the status code in `<dir>/<name>.status`, or 404. Both are read
 * on every request, so a smoke can change what each path serves between launches.
 *
 * `--stall-after <bytes>` sends only that many bytes of an artifact, then holds the connection
 * open without closing it, which is what the app's download watchdog must abort.
 *
 * Usage:
 *   bun updater-feed-server.ts \
 *     --cert <leaf.pem> --key <leaf.key> \
 *     (--latest-json <latest.json> | --feed-dir <dir>) --serve-dir <artifacts-dir> \
 *     [--port 443] [--stall-after <bytes>]
 */
import type { Server } from "bun";

export type FeedSource = { latestJsonPath: string } | { feedDir: string };

export type FeedOptions = FeedSource & {
  serveDir: string;
  stallAfter?: number;
  log?: (line: string) => void;
};

const FEED_PATHS = new Set(["/releases/latest.json", "/releases/latest-rc.json"]);

export function feedHandler(
  options: FeedOptions,
): (req: Request, server: Server<unknown>) => Promise<Response> {
  const { serveDir, stallAfter, log = console.log } = options;
  return async (req, server) => {
    const url = new URL(req.url);
    const path = url.pathname;

    const response = await feedResponse(options, path);
    if (response) {
      // Every feed request is logged with its path and status, so a smoke can assert which feeds
      // the app fetched, in what order, and that it reached this server at all.
      log(`feed-server: ${req.method} ${path} -> ${response.status}`);
      return response;
    }

    // Any other path → serve the basename from the artifacts dir.
    // (latest.json points download URLs at /releases/download/<file>.)
    // URL-decode: the Tauri bundle name has a space ("Presto.app.tar.gz"),
    // which the updater requests %20-encoded — decode it to match the on-disk file.
    const name = decodeURIComponent(path.split("/").pop() ?? "");
    if (name) {
      const file = Bun.file(`${serveDir}/${name}`);
      if (await file.exists()) {
        log(`feed-server: ${req.method} ${path} -> 200 (${name})`);
        if (stallAfter === undefined) {
          return new Response(file, {
            headers: { "content-type": "application/octet-stream" },
          });
        }
        return stalledResponse(req, server, file, stallAfter, name, log);
      }
    }

    console.error(`feed-server: ${req.method} ${path} -> 404`);
    return new Response("not found", { status: 404 });
  };
}

/** The answer for a feed path, or `null` when `path` is not one this source serves. */
async function feedResponse(source: FeedSource, path: string): Promise<Response | null> {
  if ("feedDir" in source) {
    return FEED_PATHS.has(path) ? feedDirResponse(source.feedDir, path) : null;
  }
  return path === "/releases/latest.json" ? jsonResponse(Bun.file(source.latestJsonPath)) : null;
}

async function jsonResponse(file: Bun.BunFile): Promise<Response> {
  return new Response(await file.text(), { headers: { "content-type": "application/json" } });
}

async function feedDirResponse(feedDir: string, path: string): Promise<Response> {
  const name = path.slice("/releases/".length);
  const status = Bun.file(`${feedDir}/${name}.status`);
  if (await status.exists()) {
    const code = (await status.text()).trim();
    if (!/^[1-5][0-9][0-9]$/.test(code)) throw new Error(`${name}.status is not an HTTP status`);
    return new Response("feed unavailable", { status: Number(code) });
  }
  const feed = Bun.file(`${feedDir}/${name}`);
  if (await feed.exists()) return jsonResponse(feed);
  return new Response("not found", { status: 404 });
}

async function stalledResponse(
  req: Request,
  server: Server<unknown>,
  file: Bun.BunFile,
  stallAfter: number,
  name: string,
  log: (line: string) => void,
): Promise<Response> {
  // Bun closes a connection idle for `idleTimeout` (10 s by default); a closed connection is a
  // download error, not the stall the watchdog exists for.
  server.timeout(req, 0);
  const head = new Uint8Array(await file.slice(0, stallAfter).arrayBuffer());
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(head);
      // The smoke measures the watchdog from this second.
      log(
        `feed-server: stalled ${name} after ${head.length} bytes last_chunk_at=${Math.floor(Date.now() / 1000)}`,
      );
    },
  });
  return new Response(body, { headers: { "content-type": "application/octet-stream" } });
}

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const value = i === -1 ? undefined : process.argv[i + 1];
  if (value) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`missing required --${name}`);
}

function feedSource(): FeedSource {
  const dir = process.argv.includes("--feed-dir");
  if (dir === process.argv.includes("--latest-json")) {
    throw new Error("pass exactly one of --latest-json and --feed-dir");
  }
  return dir ? { feedDir: arg("feed-dir") } : { latestJsonPath: arg("latest-json") };
}

if (import.meta.main) {
  const stall = process.argv.includes("--stall-after") ? arg("stall-after") : undefined;
  if (stall !== undefined && !/^[1-9][0-9]*$/.test(stall)) {
    throw new Error("--stall-after must be a positive integer");
  }
  const server = Bun.serve({
    port: Number(arg("port", "443")),
    tls: {
      cert: Bun.file(arg("cert")),
      key: Bun.file(arg("key")),
    },
    fetch: feedHandler({
      ...feedSource(),
      serveDir: arg("serve-dir"),
      stallAfter: stall === undefined ? undefined : Number(stall),
    }),
  });
  console.log(`updater feed server listening on https://localhost:${server.port}`);
}

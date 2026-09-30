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
 * `--stall-after <bytes>` sends only that many bytes of an artifact, then holds the connection
 * open without closing it, which is what the app's download watchdog must abort.
 *
 * Usage:
 *   bun updater-feed-server.ts \
 *     --cert <leaf.pem> --key <leaf.key> \
 *     --latest-json <latest.json> --serve-dir <artifacts-dir> [--port 443] [--stall-after <bytes>]
 */
import type { Server } from "bun";

export interface FeedOptions {
  latestJsonPath: string;
  serveDir: string;
  stallAfter?: number;
  log?: (line: string) => void;
}

export function feedHandler({
  latestJsonPath,
  serveDir,
  stallAfter,
  log = console.log,
}: FeedOptions): (req: Request, server: Server<unknown>) => Promise<Response> {
  return async (req, server) => {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/releases/latest.json") {
      const body = await Bun.file(latestJsonPath).text();
      // Logged so the smoke test can assert the feed was actually hit (guards
      // against a no-op "pass" where the updater never reached our feed).
      log(`feed-server: ${req.method} ${path} -> 200`);
      return new Response(body, {
        headers: { "content-type": "application/json" },
      });
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
      latestJsonPath: arg("latest-json"),
      serveDir: arg("serve-dir"),
      stallAfter: stall === undefined ? undefined : Number(stall),
    }),
  });
  console.log(`updater feed server listening on https://localhost:${server.port}`);
}

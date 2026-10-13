/**
 * The loopback verified-sites feed the WebDriver suite points the app at. It serves envelopes built
 * exactly as the production ones are (the production signer, the CLI's envelope bytes), signed with
 * the public RFC 8032 TEST 2 key, which has no authority anywhere else.
 *
 *   bun scripts/verified-sites-e2e-feed.ts --state <file> [--history <dir>]
 *
 * `GET /` answers with the current mode's envelope, or 404 in `none` (the starting mode).
 * `POST /control?serve=<mode>` switches the mode; `GET /control` reports it and the serve counts.
 * Once listening it writes {url, pubkey, control, pid} to the state file.
 */
import { renameSync, writeFileSync } from "node:fs";
import {
  type ControlStatus,
  type FeedState,
  feedLists,
  HISTORY_DIR,
  MODES,
  type Mode,
  newestRecord,
  type ServedMode,
} from "./verified-sites-e2e.ts";
import { RFC8032_TEST2_SEED } from "./verified-sites-fixtures.ts";
import {
  deriveKey,
  documentBytes,
  normalizeSeed,
  publicKeyDocument,
  type SigningKey,
  signList,
} from "./verified-sites-signer.ts";

export const FEED_KEY: SigningKey = deriveKey(normalizeSeed(RFC8032_TEST2_SEED));

/** A list and its signature, wrapped as the CLI's `document` command wraps them. */
export function envelope(key: SigningKey, list: Uint8Array): Uint8Array {
  return documentBytes(list, new TextEncoder().encode(signList(key, list)));
}

export function feedDocuments(key: SigningKey, record: Uint8Array): Record<ServedMode, Uint8Array> {
  const lists = feedLists(record);
  return {
    with: envelope(key, lists.with),
    without: envelope(key, lists.without),
    // Signed for its own version, but over its bytes minus the final newline, so the comment line
    // matches and only the signature check can refuse it.
    tampered: documentBytes(
      lists.tampered,
      new TextEncoder().encode(signList(key, lists.tampered.subarray(0, -1))),
    ),
  };
}

export function startFeed(record: Uint8Array, key: SigningKey = FEED_KEY) {
  const documents = feedDocuments(key, record);
  const status: ControlStatus = {
    serve: "none",
    served: { none: 0, with: 0, without: 0, tampered: 0 },
  };
  const list = (request: Request): Response => {
    if (request.method !== "GET") return new Response(null, { status: 405 });
    const mode = status.serve;
    status.served[mode] += 1;
    if (mode === "none") return new Response(null, { status: 404 });
    return new Response(new TextDecoder().decode(documents[mode]), {
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  };
  const control = (request: Request, url: URL): Response => {
    if (request.method === "GET") return Response.json(status);
    if (request.method !== "POST") return new Response(null, { status: 405 });
    const serve = url.searchParams.get("serve");
    if (!MODES.includes(serve as Mode)) return new Response("unknown mode\n", { status: 400 });
    status.serve = serve as Mode;
    console.log(`serving ${serve}`);
    return Response.json(status);
  };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/") return list(request);
      if (url.pathname === "/control") return control(request, url);
      return new Response(null, { status: 404 });
    },
  });
  const origin = `http://127.0.0.1:${server.port}`;
  const state: FeedState = {
    url: `${origin}/`,
    pubkey: publicKeyDocument(key.publicKey),
    control: `${origin}/control`,
    pid: process.pid,
  };
  return { server, state };
}

function argument(args: string[], flag: string): string | undefined {
  const at = args.indexOf(flag);
  return at === -1 ? undefined : args[at + 1];
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const stateFile = argument(args, "--state");
  if (!stateFile) {
    console.error("usage: bun scripts/verified-sites-e2e-feed.ts --state <file> [--history <dir>]");
    process.exit(2);
  }
  const { state } = startFeed(newestRecord(argument(args, "--history") ?? HISTORY_DIR));
  // Written whole and renamed, so a reader never sees half a state file.
  writeFileSync(`${stateFile}.tmp`, `${JSON.stringify(state)}\n`);
  renameSync(`${stateFile}.tmp`, stateFile);
  console.log(`verified-sites feed on ${state.url} (pid ${state.pid})`);
}

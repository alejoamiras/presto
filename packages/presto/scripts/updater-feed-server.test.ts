import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { feedHandler } from "./updater-feed-server";

/**
 * Contract test for updater-feed-server.ts's handler, over plain HTTP on loopback (the TLS wrapper
 * is Bun's). The stall server shortens the idle timeout to 1 s; Bun checks idle sockets on a 4 s
 * tick, so a response that did not lift the timeout closes well inside the test's 8 s window.
 */
const dir = mkdtempSync(join(tmpdir(), "updater-feed-"));
const artifact = new Uint8Array(256 * 1024).map((_, i) => i % 251);
writeFileSync(join(dir, "Presto.app.tar.gz"), artifact);
writeFileSync(join(dir, "latest.json"), '{"version":"9.9.9"}');

const lines: string[] = [];
const serve = (stallAfter?: number) =>
  Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    idleTimeout: 1,
    fetch: feedHandler({
      latestJsonPath: join(dir, "latest.json"),
      serveDir: dir,
      stallAfter,
      log: (line) => lines.push(line),
    }),
  });
const plain = serve();
const stalling = serve(65_536);
const feeds = join(dir, "feeds");
const feedLines: string[] = [];
mkdirSync(feeds);
const byPath = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch: feedHandler({ feedDir: feeds, serveDir: dir, log: (line) => feedLines.push(line) }),
});
afterAll(() => {
  plain.stop(true);
  stalling.stop(true);
  byPath.stop(true);
});

describe("updater feed server", () => {
  test("serves the feed and the whole artifact by default", async () => {
    expect(await (await fetch(`${plain.url}releases/latest.json`)).json()).toEqual({
      version: "9.9.9",
    });
    const res = await fetch(`${plain.url}releases/download/Presto.app.tar.gz`);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(artifact);
    expect((await fetch(`${plain.url}releases/download/missing`)).status).toBe(404);
  });

  test("--feed-dir answers each feed path from its file or status sidecar, read per request", async () => {
    const get = async (name: string) => {
      const res = await fetch(`${byPath.url}releases/${name}`);
      return [res.status, res.status === 200 ? await res.json() : null];
    };
    writeFileSync(join(feeds, "latest.json"), '{"version":"9.9.9"}');
    writeFileSync(join(feeds, "latest-rc.json"), '{"version":"9.9.9-rc.1"}');
    expect(await get("latest-rc.json")).toEqual([200, { version: "9.9.9-rc.1" }]);
    expect(await get("latest.json")).toEqual([200, { version: "9.9.9" }]);

    writeFileSync(join(feeds, "latest-rc.json.status"), "503\n");
    rmSync(join(feeds, "latest.json"));
    expect(await get("latest-rc.json")).toEqual([503, null]);
    expect(await get("latest.json")).toEqual([404, null]);
    expect(feedLines).toEqual([
      "feed-server: GET /releases/latest-rc.json -> 200",
      "feed-server: GET /releases/latest.json -> 200",
      "feed-server: GET /releases/latest-rc.json -> 503",
      "feed-server: GET /releases/latest.json -> 404",
    ]);
    const res = await fetch(`${byPath.url}releases/download/Presto.app.tar.gz`);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(artifact);
  });

  // The smokes impersonate presto.build with this server, so a passing smoke is the updater working
  // while the app's verified-sites fetch fails.
  test("answers the verified-sites list path with 404", async () => {
    expect((await fetch(`${plain.url}releases/verified-sites.json`)).status).toBe(404);
  });

  test("--stall-after sends a genuine prefix, logs the last chunk, and keeps the connection open", async () => {
    const before = Math.floor(Date.now() / 1000);
    const res = await fetch(`${stalling.url}releases/download/Presto.app.tar.gz`);
    const reader = res.body?.getReader();
    if (!reader) throw new Error("no body");
    const received: number[] = [];
    while (received.length < 65_536) {
      const { value, done } = await reader.read();
      if (done) throw new Error(`closed after ${received.length} bytes`);
      received.push(...value);
    }
    expect(new Uint8Array(received)).toEqual(artifact.slice(0, 65_536));

    const stall = lines.find((line) => line.startsWith("feed-server: stalled Presto.app.tar.gz"));
    expect(stall).toContain("after 65536 bytes");
    const at = Number(stall?.match(/last_chunk_at=(\d+)$/)?.[1]);
    expect(at).toBeGreaterThanOrEqual(before);

    const next = await Promise.race([
      reader.read().then(
        (r) => (r.done ? "closed" : "more bytes"),
        () => "errored",
      ),
      Bun.sleep(8000).then(() => "still open"),
    ]);
    expect(next).toBe("still open");
    await reader.cancel();
  }, 15_000);
});

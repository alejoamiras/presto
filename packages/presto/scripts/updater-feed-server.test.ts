import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
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
afterAll(() => {
  plain.stop(true);
  stalling.stop(true);
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

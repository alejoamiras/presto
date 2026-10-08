import { describe, expect, test } from "bun:test";
import { handleRequest } from "./index";

const ORIGINS = ["https://presto.build", "https://presto-release-feed.alejo-amiras.workers.dev"];
const PATHS = [
  ["/releases/latest.json", "latest.json"],
  ["/releases/verified-sites.json", "verified-sites.json"],
] as const;

/** A KV stub holding `values`, recording every key read. */
function envWith(values: Record<string, string>, error?: Error): { env: Env; reads: string[] } {
  const reads: string[] = [];
  const releaseFeed = new Proxy({} as KVNamespace, {
    get(_target, property) {
      if (property !== "get") return undefined;
      return async (key: string) => {
        reads.push(key);
        if (error) throw error;
        const value = Object.hasOwn(values, key) ? values[key] : undefined;
        return value === undefined ? null : new Blob([value]).stream();
      };
    },
  });
  return { env: { PRESTO_RELEASE_FEED: releaseFeed } as Env, reads };
}

const both = { "latest.json": '{"version":"5.2.0"}', "verified-sites.json": '{"schema":"x"}' };

describe("release feed worker", () => {
  test.each(ORIGINS.flatMap((origin) => PATHS.map(([path, key]) => [origin, path, key])))(
    "streams %s%s from its own key for GET and omits the body for HEAD",
    async (origin, path, key) => {
      const { env, reads } = envWith(both);
      const get = await handleRequest(new Request(`${origin}${path}`), env);
      expect(get.status).toBe(200);
      expect(await get.text()).toBe(both[key as keyof typeof both]);
      expect(get.headers.get("content-type")).toBe("application/json; charset=utf-8");
      expect(get.headers.get("cache-control")).toBe("public, max-age=300");

      const head = await handleRequest(new Request(`${origin}${path}`, { method: "HEAD" }), env);
      expect(head.status).toBe(200);
      expect(await head.text()).toBe("");
      expect(reads).toEqual([key, key]);
    },
  );

  test("rejects foreign paths before reading KV, and mutation methods", async () => {
    const { env, reads } = envWith(both);
    for (const path of [
      "/releases/other.json",
      "/releases/latest.json/",
      "/releases/verified-sites.json/",
      "/releases/verified-sites",
      "/releases/constructor",
      "/releases/",
      "/verified-sites.json",
    ]) {
      expect((await handleRequest(new Request(`https://presto.build${path}`), env)).status).toBe(
        404,
      );
    }
    for (const [path] of PATHS) {
      const post = await handleRequest(
        new Request(`https://presto.build${path}`, { method: "POST" }),
        env,
      );
      expect(post.status).toBe(405);
      expect(post.headers.get("allow")).toBe("GET, HEAD");
    }
    expect(reads).toEqual([]);
  });

  test("fails closed when a key is absent or KV errors, without falling back to the other", async () => {
    for (const [path, key] of PATHS) {
      const other = PATHS.find(([, k]) => k !== key)?.[1] ?? "";
      for (const { env } of [envWith({ [other]: "{}" }), envWith(both, new Error("offline"))]) {
        const response = await handleRequest(new Request(`https://presto.build${path}`), env);
        expect(response.status).toBe(503);
        expect(response.headers.get("cache-control")).toBe("no-store");
      }
    }
  });
});

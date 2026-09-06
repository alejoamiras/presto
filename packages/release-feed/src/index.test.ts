import { describe, expect, test } from "bun:test";
import { handleRequest } from "./index";

function envWith(value: string | null, error?: Error): Env {
  const releaseFeed = new Proxy({} as KVNamespace, {
    get(_target, property) {
      if (property !== "get") return undefined;
      return async () => {
        if (error) throw error;
        return value === null ? null : new Blob([value]).stream();
      };
    },
  });
  return {
    PRESTO_RELEASE_FEED: releaseFeed,
  } as Env;
}

describe("release feed worker", () => {
  test.each(["https://presto.build", "https://presto-release-feed.alejo-amiras.workers.dev"])(
    "streams the feed on %s for GET and omits the body for HEAD",
    async (origin) => {
      const body = JSON.stringify({ version: "5.2.0" });
      const get = await handleRequest(new Request(`${origin}/releases/latest.json`), envWith(body));
      expect(get.status).toBe(200);
      expect(await get.text()).toBe(body);
      expect(get.headers.get("content-type")).toBe("application/json; charset=utf-8");
      expect(get.headers.get("cache-control")).toBe("public, max-age=300");

      const head = await handleRequest(
        new Request(`${origin}/releases/latest.json`, {
          method: "HEAD",
        }),
        envWith(body),
      );
      expect(head.status).toBe(200);
      expect(await head.text()).toBe("");
    },
  );

  test("rejects foreign paths and mutation methods", async () => {
    const env = envWith("{}");
    expect(
      (await handleRequest(new Request("https://presto.build/releases/other.json"), env)).status,
    ).toBe(404);
    const post = await handleRequest(
      new Request("https://presto-release-feed.alejo-amiras.workers.dev/releases/latest.json", {
        method: "POST",
      }),
      env,
    );
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET, HEAD");
  });

  test("fails closed when the feed is absent or KV errors", async () => {
    for (const env of [envWith(null), envWith(null, new Error("offline"))]) {
      const response = await handleRequest(
        new Request("https://presto-release-feed.alejo-amiras.workers.dev/releases/latest.json"),
        env,
      );
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });
});

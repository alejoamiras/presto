import { describe, expect, test } from "bun:test";
import { handleRequest } from "./index";

const ORIGINS = ["https://presto.build", "https://presto-release-feed.alejo-amiras.workers.dev"];
const PATHS = [
  ["/releases/latest.json", "latest.json"],
  ["/releases/verified-sites.json", "verified-sites.json"],
] as const;
const RC_PATH = "/releases/latest-rc.json";

/** A KV stub holding `values`, recording every key read. */
function envWith(values: Record<string, string>, error?: Error): { env: Env; reads: string[] } {
  const reads: string[] = [];
  const releaseFeed = new Proxy({} as KVNamespace, {
    get(_target, property) {
      if (property !== "get") return undefined;
      return async (key: string, options?: { type?: string }) => {
        reads.push(key);
        if (error) throw error;
        const value = Object.hasOwn(values, key) ? values[key] : undefined;
        if (value === undefined) return null;
        return options?.type === "text" ? value : new Blob([value]).stream();
      };
    },
  });
  return { env: { PRESTO_RELEASE_FEED: releaseFeed } as Env, reads };
}

const feed = (version: string) => JSON.stringify({ version, platforms: {} });

const both = {
  "latest.json": feed("5.2.0"),
  "latest-rc.json": feed("5.3.0-rc.1"),
  "verified-sites.json": '{"schema":"x"}',
};

async function get(env: Env, path: string, method = "GET"): Promise<[number, string]> {
  const response = await handleRequest(new Request(`https://presto.build${path}`, { method }), env);
  return [response.status, await response.text()];
}

describe("release feed worker", () => {
  test.each(ORIGINS.flatMap((origin) => PATHS.map(([path, key]) => [origin, path, key])))(
    "serves %s%s from its own key alone for GET and omits the body for HEAD",
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
      "/releases/latest-rc.json/",
      "/releases/latest-rc",
      "/releases/verified-sites.json/",
      "/releases/verified-sites",
      "/releases/constructor",
      "/releases/",
      "/verified-sites.json",
      // Smoke feeds and legacy prerelease manifests name these artifact URLs, so they must never serve.
      "/releases/download/presto-v5.3.0-rc.1/Presto.app.tar.gz",
      "/releases/download/latest.json",
    ]) {
      expect((await handleRequest(new Request(`https://presto.build${path}`), env)).status).toBe(
        404,
      );
    }
    for (const path of [...PATHS.map(([path]) => path), RC_PATH]) {
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

  test("the stable route refuses a prerelease, whatever key it came from", async () => {
    for (const version of ["5.3.0-rc.1", "5.3.0-beta.1", "5.3.0-rc.1+build.7"]) {
      const { env } = envWith({ "latest.json": feed(version), "latest-rc.json": feed(version) });
      expect(await get(env, "/releases/latest.json")).toEqual([503, "Feed unavailable"]);
    }
  });
});

describe("release-candidate route", () => {
  const cases: [string, Record<string, string>, string][] = [
    [
      "a higher candidate",
      { "latest.json": feed("5.2.0"), "latest-rc.json": feed("5.3.0-rc.10") },
      "latest-rc.json",
    ],
    [
      "a candidate higher by number, not text",
      { "latest.json": feed("1.9.0"), "latest-rc.json": feed("1.10.0-rc.1") },
      "latest-rc.json",
    ],
    [
      "a stable higher than the candidate",
      { "latest.json": feed("5.4.0"), "latest-rc.json": feed("5.3.0-rc.2") },
      "latest.json",
    ],
    [
      "a stable higher by number, not text",
      { "latest.json": feed("1.10.0"), "latest-rc.json": feed("1.9.0-rc.3") },
      "latest.json",
    ],
    [
      "the stable of the candidate's own version",
      { "latest.json": feed("5.3.0"), "latest-rc.json": feed("5.3.0-rc.2") },
      "latest.json",
    ],
    ["a stable with no candidate key", { "latest.json": feed("5.2.0") }, "latest.json"],
  ];

  test.each(cases)("serves the bytes of the higher key over %s", async (_name, values, served) => {
    const { env, reads } = envWith(values);
    expect(await get(env, RC_PATH)).toEqual([200, values[served]]);
    expect(await get(env, RC_PATH, "HEAD")).toEqual([200, ""]);
    expect(new Set(reads)).toEqual(new Set(["latest.json", "latest-rc.json"]));
  });

  test("answers 503, never a body the plugin cannot fall back from, on a broken or missing key", async () => {
    const broken: Record<string, string>[] = [
      { "latest-rc.json": feed("5.3.0-rc.1") },
      { "latest.json": feed("5.2.0-rc.4"), "latest-rc.json": feed("5.3.0-rc.1") },
      { "latest.json": "not json", "latest-rc.json": feed("5.3.0-rc.1") },
      { "latest.json": feed("5.2.0"), "latest-rc.json": "" },
      { "latest.json": feed("5.2.0"), "latest-rc.json": "null" },
      { "latest.json": feed("5.2.0"), "latest-rc.json": '{"platforms":{}}' },
      { "latest.json": feed("5.2.0"), "latest-rc.json": feed("5.3.0") },
      { "latest.json": feed("5.2.0"), "latest-rc.json": feed("5.3.0-beta.1") },
      { "latest.json": feed("5.2.0"), "latest-rc.json": feed("5.3.0-rc.01") },
      { "latest.json": feed("05.2.0"), "latest-rc.json": feed("5.3.0-rc.1") },
      { "latest.json": JSON.stringify({ version: 5 }), "latest-rc.json": feed("5.3.0-rc.1") },
    ];
    for (const values of broken) {
      const { env } = envWith(values);
      const response = await handleRequest(new Request(`https://presto.build${RC_PATH}`), env);
      expect([values, response.status]).toEqual([values, 503]);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect((await get(env, RC_PATH, "HEAD"))[0]).toBe(503);
    }
    expect((await get(envWith(both, new Error("offline")).env, RC_PATH))[0]).toBe(503);
  });
});

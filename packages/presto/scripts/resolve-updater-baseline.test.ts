import { describe, expect, test } from "bun:test";
import path from "node:path";
import {
  assertLiveStableSmoked,
  type LiveFeed,
  loadLiveFeed,
  loadUpdaterReleaseCandidates,
  selectLiveStableBaseline,
  selectUpdaterBaseline,
  type UpdaterReleaseCandidate,
  updaterBaselines,
} from "./resolve-updater-baseline";

const OLD_KEY = "old-updater-key";
const NEW_KEY = "new-updater-key";
const FEED_BYTES = '{"version":"1.1.3","platforms":{}}';
const FEED_SHA256 = new Bun.CryptoHasher("sha256").update(FEED_BYTES).digest("hex");
const FEED: LiveFeed = { version: "1.1.3", sha256: FEED_SHA256 };

function candidate(
  version: string,
  pubkey: string,
  overrides: Partial<UpdaterReleaseCandidate> = {},
): UpdaterReleaseCandidate {
  return {
    tagName: `presto-v${version}`,
    draft: false,
    prerelease: version.includes("-"),
    pubkey,
    assetNames: [
      `Presto-${version}-macOS-Apple-Silicon.dmg`,
      `Presto-${version}-macOS-Intel.dmg`,
      `Presto-${version}-Linux-x86_64.AppImage`,
      `Presto-${version}-Windows-x86_64-setup.exe`,
    ],
    ...overrides,
  };
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: Suite registration is not production control flow.
describe("updater smoke baseline selection", () => {
  test("rejects a missing baseline, including the former first-RC exception", () => {
    for (const version of ["1.0.0-rc.1", "1.0.0", "1.0.0-rc.2", "0.9.0-rc.1", "2.0.0-rc.1"]) {
      expect(() =>
        selectUpdaterBaseline({ version, currentPubkey: NEW_KEY, releases: [] }),
      ).toThrow("no complete published lower presto release uses the current updater key");
    }
    for (const release of [
      candidate("0.9.0", OLD_KEY),
      candidate("0.9.0", OLD_KEY, { draft: true }),
      candidate("0.9.0", NEW_KEY, { assetNames: [] }),
    ]) {
      expect(() =>
        selectUpdaterBaseline({
          version: "1.0.0-rc.1",
          currentPubkey: NEW_KEY,
          releases: [release],
        }),
      ).toThrow("no complete published lower presto release uses the current updater key");
    }
  });

  test("GA uses RC1 as a real baseline", () => {
    expect(
      selectUpdaterBaseline({
        version: "1.0.0",
        currentPubkey: NEW_KEY,
        releases: [candidate("1.0.0-rc.1", NEW_KEY)],
      }),
    ).toEqual({ tag: "presto-v1.0.0-rc.1", version: "1.0.0-rc.1" });
  });

  test("pagination retains incomplete older releases while selection fails closed", async () => {
    let calls = 0;
    const releases = await loadUpdaterReleaseCandidates(
      "alejoamiras/presto",
      "test",
      async (url) => {
        calls++;
        expect(String(url)).toContain(`page=${calls}`);
        return Response.json(
          calls === 1
            ? Array.from({ length: 100 }, (_, n) => ({ tag_name: `sdk-v0.0.${n}`, draft: false }))
            : [{ tag_name: "presto-v0.9.0", draft: true, prerelease: false, assets: [] }],
        );
      },
    );
    expect(calls).toBe(2);
    expect(releases).toHaveLength(1);
    expect(() =>
      selectUpdaterBaseline({ version: "1.0.0-rc.1", currentPubkey: NEW_KEY, releases }),
    ).toThrow("no complete published lower presto release uses the current updater key");
  });

  test("prefers the greatest lower same-key release, including a prerelease", () => {
    const result = selectUpdaterBaseline({
      version: "3.0.0",
      currentPubkey: NEW_KEY,
      releases: [
        candidate("3.0.0-rc.1", NEW_KEY),
        candidate("2.0.1-rc.1", OLD_KEY),
        candidate("2.0.0", OLD_KEY),
      ],
    });

    expect(result).toEqual({
      tag: "presto-v3.0.0-rc.1",
      version: "3.0.0-rc.1",
    });
  });

  test("falls back past a newer wrong-key release to the greatest same-key release", () => {
    const result = selectUpdaterBaseline({
      version: "3.0.0",
      currentPubkey: NEW_KEY,
      releases: [
        candidate("2.1.0", OLD_KEY),
        candidate("1.9.0", NEW_KEY),
        candidate("2.0.0", NEW_KEY),
      ],
    });

    expect(result).toEqual({ tag: "presto-v2.0.0", version: "2.0.0" });
  });

  test("fails closed when no complete lower release uses the current key", () => {
    const releases = [candidate("2.0.1-rc.1", OLD_KEY), candidate("2.0.0", OLD_KEY)];

    expect(() =>
      selectUpdaterBaseline({
        version: "3.0.0-rc.1",
        currentPubkey: NEW_KEY,
        releases,
      }),
    ).toThrow("no complete published lower presto release uses the current updater key");
  });

  test("ignores drafts, incomplete releases, and versions not below N", () => {
    const incomplete = candidate("3.0.0-rc.2", NEW_KEY);
    incomplete.assetNames.pop();

    const result = selectUpdaterBaseline({
      version: "3.0.0-rc.3",
      currentPubkey: NEW_KEY,
      releases: [
        candidate("3.0.0", NEW_KEY),
        incomplete,
        candidate("3.0.0-rc.1", NEW_KEY),
        candidate("2.0.1-rc.1", NEW_KEY, { draft: true }),
      ],
    });

    expect(result.version).toBe("3.0.0-rc.1");
  });
});

describe("live stable baseline", () => {
  const stable = candidate("1.1.3", NEW_KEY, { feedDigest: `sha256:${FEED_SHA256}` });
  const releases = [candidate("1.2.0-rc.2", NEW_KEY), stable];
  const select = (
    overrides: Partial<UpdaterReleaseCandidate> = {},
    feed = FEED,
    version = "1.2.0",
  ) =>
    selectLiveStableBaseline({
      version,
      currentPubkey: NEW_KEY,
      releases: [releases[0] as UpdaterReleaseCandidate, { ...stable, ...overrides }],
      feed,
    });

  test("joins the greatest lower release unless it is the same one, and gates finalize", () => {
    const live = select();
    const greatestLower = selectUpdaterBaseline({
      version: "1.2.0",
      currentPubkey: NEW_KEY,
      releases,
    });
    expect(updaterBaselines(greatestLower, live)).toEqual([
      { tag: "presto-v1.2.0-rc.2", version: "1.2.0-rc.2" },
      { tag: "presto-v1.1.3", version: "1.1.3" },
    ]);
    expect(updaterBaselines(live, select())).toEqual([live]);

    expect(() => assertLiveStableSmoked(FEED, [greatestLower, live])).not.toThrow();
    expect(() => assertLiveStableSmoked(FEED, [greatestLower])).toThrow(
      "live updater feed now serves 1.1.3, but this run's updater smokes started only from 1.2.0-rc.2",
    );
  });

  test("fails closed unless the feed is a published same-key stable's own signed feed below N", () => {
    const cases: Array<[string, () => unknown]> = [
      ["no published release presto-v1.1.4", () => select({}, { ...FEED, version: "1.1.4" })],
      ["presto-v1.1.3 has no latest.json digest", () => select({ feedDigest: undefined })],
      ["presto-v1.1.3 has no latest.json digest", () => select({ feedDigest: "sha256:XYZ" })],
      [
        "bytes are not presto-v1.1.3's own signed latest.json",
        () => select({}, { ...FEED, sha256: "0".repeat(64) }),
      ],
      ["presto-v1.1.3 is not a published stable release", () => select({ draft: true })],
      ["presto-v1.1.3 is not a published stable release", () => select({ prerelease: true })],
      ["presto-v1.1.3 lacks a complete installer set", () => select({ assetNames: [] })],
      ["presto-v1.1.3 uses another updater key", () => select({ pubkey: OLD_KEY })],
      ["not below 1.1.3", () => select({}, FEED, "1.1.3")],
    ];
    for (const [reason, run] of cases) {
      expect(run, reason).toThrow(`live updater feed serves `);
      expect(run, reason).toThrow(reason);
    }
  });

  test("reads the feed without credentials or redirects, retries transport, hashes exact bytes", async () => {
    const inits: (RequestInit | undefined)[] = [];
    const replies = [new Response("busy", { status: 503 }), new Response(FEED_BYTES)];
    const feed = await loadLiveFeed(
      "https://presto.build/releases/latest.json",
      async (_url, init) => {
        inits.push(init);
        return replies.shift() ?? Response.error();
      },
      0,
    );
    expect(feed).toEqual(FEED);
    expect(inits).toHaveLength(2);
    for (const init of inits) {
      expect(init?.headers).toBeUndefined();
      expect(init?.redirect).toBe("error");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }

    const down = async () => {
      throw new Error("connection refused");
    };
    await expect(
      loadLiveFeed("https://presto.build/releases/latest.json", down, 0),
    ).rejects.toThrow("unreachable after 5 attempts: connection refused");
    const versionless = async () => new Response("{}");
    await expect(
      loadLiveFeed("https://presto.build/releases/latest.json", versionless, 0),
    ).rejects.toThrow("carries no version");
  });
});

// Real-data check of the external contract: the served feed is byte-identical to a published
// stable's `latest.json` asset digest. Opt-in, read-only.
describe.skipIf(!process.env.UPDATER_BASELINE_LIVE || !process.env.GITHUB_TOKEN)(
  "live stable baseline against the real feed and releases",
  () => {
    test("the served feed binds to a published same-key stable release", async () => {
      const conf = await Bun.file(
        path.join(import.meta.dir, "../src-tauri/tauri.conf.json"),
      ).json();
      const feed = await loadLiveFeed(conf.plugins.updater.endpoints[0]);
      const releases = await loadUpdaterReleaseCandidates(
        "alejoamiras/presto",
        process.env.GITHUB_TOKEN ?? "",
      );
      const live = selectLiveStableBaseline({
        version: "9999.0.0",
        currentPubkey: conf.plugins.updater.pubkey,
        releases,
        feed,
      });
      expect(live.tag).toBe(`presto-v${feed.version}`);
    }, 120_000);
  },
);

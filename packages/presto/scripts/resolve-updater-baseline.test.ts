import { describe, expect, test } from "bun:test";
import {
  loadUpdaterReleaseCandidates,
  selectUpdaterBaseline,
  type UpdaterReleaseCandidate,
} from "./resolve-updater-baseline";

const OLD_KEY = "old-updater-key";
const NEW_KEY = "new-updater-key";

function candidate(
  version: string,
  pubkey: string,
  overrides: Partial<UpdaterReleaseCandidate> = {},
): UpdaterReleaseCandidate {
  return {
    tagName: `presto-v${version}`,
    draft: false,
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
            : [{ tag_name: "presto-v0.9.0", draft: true, assets: [] }],
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

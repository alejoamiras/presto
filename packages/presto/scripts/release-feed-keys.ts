/**
 * Which release-feed KV key a version belongs in, and how a staged candidate stands against a stable.
 * The grammar and the order match the Worker that serves the keys (`packages/release-feed`): a stable
 * outranks every candidate of its own `X.Y.Z`, so a candidate is served only above that.
 *
 *   release-feed-keys.ts key <version>                          prints latest.json | latest-rc.json
 *   release-feed-keys.ts check-put <key> <feed file>            exits 1 unless the feed belongs in <key>
 *   release-feed-keys.ts standing <stable version> <feed | ->   prints above | below | unreadable | absent
 */
export const STABLE_KEY = "latest.json";
export const CANDIDATE_KEY = "latest-rc.json";
export const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-rc\.(?:0|[1-9]\d*))?$/;

/** A staged candidate against a stable; `unreadable` covers anything the Worker would refuse. */
export type Standing = "above" | "below" | "unreadable" | "absent";

type Version = { core: [bigint, bigint, bigint]; prerelease: boolean };

function parse(version: string): Version {
  const match = VERSION.exec(version);
  if (!match) throw new Error(`${JSON.stringify(version)} is not X.Y.Z or X.Y.Z-rc.N`);
  const [, major = "", minor = "", patch = "", rc] = match;
  return { core: [BigInt(major), BigInt(minor), BigInt(patch)], prerelease: rc !== undefined };
}

function feedVersion(feedText: string): string {
  const version = (JSON.parse(feedText) as { version?: unknown } | null)?.version;
  if (typeof version !== "string") throw new Error("the feed has no string version");
  return version;
}

export function keyFor(version: string): string {
  return parse(version).prerelease ? CANDIDATE_KEY : STABLE_KEY;
}

/** Throws unless the feed's own version belongs in `key`: a stable in latest.json, a candidate in latest-rc.json. */
export function assertPut(key: string, feedText: string): void {
  if (key !== STABLE_KEY && key !== CANDIDATE_KEY) throw new Error(`${key} is not a feed key`);
  const version = feedVersion(feedText);
  if (keyFor(version) !== key) throw new Error(`${version} does not belong in ${key}`);
}

export function candidateStanding(stableVersion: string, candidateText: string | null): Standing {
  const stable = parse(stableVersion);
  if (stable.prerelease) throw new Error(`${stableVersion} is not a stable version`);
  if (candidateText === null) return "absent";
  let candidate: Version;
  try {
    candidate = parse(feedVersion(candidateText));
  } catch {
    return "unreadable";
  }
  if (!candidate.prerelease) return "unreadable";
  const [c0, c1, c2] = candidate.core;
  const [s0, s1, s2] = stable.core;
  for (const [c, s] of [
    [c0, s0],
    [c1, s1],
    [c2, s2],
  ] as const) {
    if (c !== s) return c > s ? "above" : "below";
  }
  return "below";
}

async function main(args: string[]): Promise<void> {
  const [command, first, second] = args;
  if (command === "key" && first !== undefined && second === undefined) {
    console.log(keyFor(first));
  } else if (command === "check-put" && first !== undefined && second !== undefined) {
    assertPut(first, await Bun.file(second).text());
  } else if (command === "standing" && first !== undefined && second !== undefined) {
    const text = second === "-" ? null : await Bun.file(second).text();
    console.log(candidateStanding(first, text));
  } else {
    throw new Error(
      "usage: release-feed-keys.ts key <version> | check-put <key> <feed> | standing <stable> <feed|->",
    );
  }
}

if (import.meta.main) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

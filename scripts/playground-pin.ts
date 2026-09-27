/**
 * Reads and raises the published SDK versions a production playground build installs.
 *
 * Usage: PRESTO_VERSION=<version|""> PRESTO_NOIR_VERSION=<version|""> bun scripts/playground-pin.ts
 * An empty variable leaves its package alone. Prints `changed` or `unchanged`.
 */
import { join, resolve } from "node:path";
import { revisionOrder } from "./get-sdk-publish-version";
import { isValidVersion, NPM_PACKAGES, type NpmPackage } from "./npm-packages";

export const PIN_FILE = "packages/playground/published-sdk.json";

const PINNED = [NPM_PACKAGES.presto, NPM_PACKAGES["presto-noir"]] as const;

type PinnedName = (typeof PINNED)[number]["name"];

export type PlaygroundPin = Record<PinnedName, string>;

function assertVersion(pkg: NpmPackage, version: unknown): asserts version is string {
  if (typeof version !== "string" || !isValidVersion(pkg, version)) {
    throw new Error(`Invalid ${pkg.name} version ${JSON.stringify(version)}`);
  }
}

/** Exactly the two adapter names, each an exact version of its package's shape. */
export function parsePlaygroundPin(value: unknown): PlaygroundPin {
  const names: string[] = PINNED.map((pkg) => pkg.name);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${PIN_FILE} must be an object`);
  }
  const keys = Object.keys(value);
  if (keys.length !== names.length || !names.every((name) => keys.includes(name))) {
    throw new Error(`${PIN_FILE} must pin exactly ${names.join(" and ")}`);
  }
  for (const pkg of PINNED) assertVersion(pkg, (value as Record<string, unknown>)[pkg.name]);
  return value as PlaygroundPin;
}

export async function readPlaygroundPin(root: string): Promise<PlaygroundPin> {
  return parsePlaygroundPin(await Bun.file(join(root, PIN_FILE)).json());
}

/**
 * Moves each version forward only, so a rerun of an older release never regresses the pin; going
 * back is a reviewed human change. An empty update leaves its package alone.
 */
export function raisePin(
  current: PlaygroundPin,
  updates: Partial<Record<PinnedName, string>>,
): PlaygroundPin {
  const next = { ...current };
  for (const pkg of PINNED) {
    const version = updates[pkg.name];
    if (!version) continue;
    assertVersion(pkg, version);
    const order = pkg.versionMode === "aztec-derived" ? revisionOrder : Bun.semver.order;
    if (order(version, current[pkg.name]) > 0) next[pkg.name] = version;
  }
  return next;
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "..");
  const current = await readPlaygroundPin(root);
  const next = raisePin(current, {
    [NPM_PACKAGES.presto.name]: process.env.PRESTO_VERSION,
    [NPM_PACKAGES["presto-noir"].name]: process.env.PRESTO_NOIR_VERSION,
  });
  if (PINNED.every((pkg) => next[pkg.name] === current[pkg.name])) {
    console.log("unchanged");
  } else {
    await Bun.write(join(root, PIN_FILE), `${JSON.stringify(next, null, 2)}\n`);
    console.log("changed");
  }
}

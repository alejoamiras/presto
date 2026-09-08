/**
 * Pack one workspace package the way a publish would, together with every `workspace:` dependency it
 * needs, so a consumer can install the candidate before anything is on npm (bootstrap mode). Each
 * dependency is packed at its own manifest version and the dependant's manifest is pinned to exactly
 * that, through the same `preparePublishManifest` rewrite the publish workflow runs.
 *
 *   bun scripts/pack-candidate.ts --package <key> [--version <v>] [--out <dir>]
 *
 * Prints `tarball=<path>` (the candidate) and `with=<name>=<path>[,...]` (its packed dependencies,
 * ready for `sdk-tarball-consumer.sh --with`), and appends both to `$GITHUB_OUTPUT` when set.
 */
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  type Manifest,
  NPM_PACKAGES,
  type PackageKey,
  readManifest,
  workspaceDependencies,
} from "./npm-packages.ts";
import { preparePublishManifest } from "./prepare-sdk-publish.ts";

/** Dependencies before dependants, each once: the order in which the packages must be packed. */
export function packOrder(
  key: PackageKey,
  manifestOf: (key: PackageKey) => Manifest,
): PackageKey[] {
  const order: PackageKey[] = [];
  const visit = (current: PackageKey, trail: PackageKey[]) => {
    if (trail.includes(current)) {
      throw new Error(`workspace dependency cycle: ${[...trail, current].join(" -> ")}`);
    }
    if (order.includes(current)) return;
    for (const dep of workspaceDependencies(manifestOf(current))) visit(dep, [...trail, current]);
    order.push(current);
  };
  visit(key, []);
  return order;
}

export interface Packed {
  version: string;
  tarball: string;
}

/** The exact pins a package's rewrite needs, from what was packed before it. */
export function pinsFor(
  manifest: Manifest,
  packed: Record<string, Packed>,
): Record<string, string> {
  const pins: Record<string, string> = {};
  for (const key of workspaceDependencies(manifest)) {
    const name = NPM_PACKAGES[key].name;
    const dep = packed[name];
    if (!dep) throw new Error(`${name} must be packed before its dependants`);
    pins[name] = dep.version;
  }
  return pins;
}

function parseArgs(args: string[]): { key: PackageKey; version?: string; out?: string } {
  const opts: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    const value = args[i + 1];
    if (!["--package", "--version", "--out"].includes(arg) || value === undefined) {
      throw new Error("usage: pack-candidate.ts --package <key> [--version <v>] [--out <dir>]");
    }
    opts[arg.slice(2)] = value;
    i += 1;
  }
  const key = opts.package;
  if (!key || !Object.hasOwn(NPM_PACKAGES, key)) {
    throw new Error(`--package must be one of ${Object.keys(NPM_PACKAGES).join(", ")}`);
  }
  return { key: key as PackageKey, version: opts.version, out: opts.out };
}

/** Build, rewrite the manifest for publish, `npm pack`, and restore the manifest whatever happens. */
function packOne(
  root: string,
  key: PackageKey,
  version: string,
  pins: Record<string, string>,
  out: string,
): Packed {
  const dir = join(root, NPM_PACKAGES[key].dir);
  const manifestPath = join(dir, "package.json");
  const backup = join(out, `${key}.package.json.bak`);
  execFileSync("bun", ["run", "--cwd", dir, "build"], { stdio: ["ignore", "inherit", "inherit"] });
  copyFileSync(manifestPath, backup);
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const next = preparePublishManifest(manifest, version, pins);
    writeFileSync(manifestPath, `${JSON.stringify(next, null, 2)}\n`);
    const file = execFileSync("npm", ["pack", "--silent", "--pack-destination", out], {
      cwd: dir,
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .at(-1);
    if (!file) throw new Error(`npm pack produced no file for ${key}`);
    return { version, tarball: join(out, file) };
  } finally {
    copyFileSync(backup, manifestPath);
  }
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "..");
  const parsed = parseArgs(process.argv.slice(2));
  const { key, version } = parsed;
  // Absolute: `npm pack` runs inside each package directory, so a relative `--out` would land there.
  const out = resolve(parsed.out ?? mkdtempSync(join(tmpdir(), "presto-candidate-")));
  mkdirSync(out, { recursive: true });
  const packed: Record<string, Packed> = {};
  let candidate: Packed | undefined;
  for (const current of packOrder(key, (k) => readManifest(NPM_PACKAGES[k], root))) {
    const manifest = readManifest(NPM_PACKAGES[current], root);
    const own = current === key ? (version ?? manifest.version) : manifest.version;
    if (!own) throw new Error(`${current} has no version to pack`);
    const result = packOne(root, current, own, pinsFor(manifest, packed), out);
    packed[NPM_PACKAGES[current].name] = result;
    if (current === key) candidate = result;
    console.error(`packed ${NPM_PACKAGES[current].name}@${own}: ${result.tarball}`);
  }
  const deps = Object.entries(packed)
    .filter(([name]) => name !== NPM_PACKAGES[key].name)
    .map(([name, { tarball }]) => `${name}=${tarball}`)
    .join(",");
  const lines = `tarball=${candidate?.tarball}\nwith=${deps}\n`;
  process.stdout.write(lines);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines);
}

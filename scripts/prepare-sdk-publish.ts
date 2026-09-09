// Rewrite a package.json for publishing: the resolved version, `main`/`types`/`exports` repointed at the
// built `dist/` (the repo's source `exports: "./src/index.ts"` serves workspace consumption only), and
// every `workspace:` dependency pinned to the exact sibling version publishing alongside. Pure, so the
// rewrite is unit-tested; the publish workflow and the tarball-consumer CI job run the same code.

import { EXACT_SEMVER } from "./npm-packages.ts";

/**
 * A source export entry: TypeScript under `src/`, which `build` emits to the same path under `dist/`.
 * Segments are plain names, so `..`, `node_modules` and `.d.ts` inputs (a dead `.d.js` target) fail.
 */
const SOURCE_ENTRY = /^\.\/src\/((?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+)\.ts$/;

export type PublishedExports = Record<string, { types: string; default: string }>;

/**
 * The published `exports` map for a source map: each `./src/<name>.ts` becomes the dist pair
 * `{ types: ./dist/<name>.d.ts, default: ./dist/<name>.js }`; a bare string is the `"."` entry.
 * Anything else fails closed — a subpath the build does not emit would publish a dead entry.
 */
export function publishedExports(source: unknown): PublishedExports {
  const entries = typeof source === "string" ? { ".": source } : source;
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
    throw new Error("exports must be a ./src/<name>.ts path or a subpath map of them");
  }
  const out: PublishedExports = {};
  for (const [subpath, target] of Object.entries(entries)) {
    if (subpath !== "." && !subpath.startsWith("./")) {
      throw new Error(`exports subpath ${JSON.stringify(subpath)} must be "." or start with "./"`);
    }
    const match = typeof target === "string" ? SOURCE_ENTRY.exec(target) : null;
    if (!match || match[1]?.split("/").includes("node_modules")) {
      throw new Error(
        `exports[${JSON.stringify(subpath)}] must be a ./src/<name>.ts path, got ${JSON.stringify(target)}`,
      );
    }
    out[subpath] = { types: `./dist/${match[1]}.d.ts`, default: `./dist/${match[1]}.js` };
  }
  if (!out["."]) throw new Error('exports must include the "." entry');
  return out;
}

const DEPENDENCY_FIELDS = ["dependencies", "peerDependencies", "optionalDependencies"] as const;

/**
 * Every `workspace:` range becomes the sibling's exact publish version; `publishConfig.exports` and
 * `devDependencies` are discarded (the override would shadow the dist map, and ours carry
 * `workspace:` ranges). Other metadata — `files`, `publishConfig.access`, registry dependencies — is
 * preserved verbatim.
 */
export function preparePublishManifest(
  pkg: Record<string, unknown>,
  version: string,
  workspaceVersions: Record<string, string> = {},
): Record<string, unknown> {
  const { devDependencies: _dev, ...published } = pkg;
  const exports = publishedExports(pkg.exports);
  const next: Record<string, unknown> = {
    ...published,
    version,
    main: exports["."]?.default,
    types: exports["."]?.types,
    exports,
  };
  const publishConfig = pkg.publishConfig;
  if (publishConfig && typeof publishConfig === "object") {
    const { exports: _dropped, ...rest } = publishConfig as Record<string, unknown>;
    next.publishConfig = rest;
  }
  for (const field of DEPENDENCY_FIELDS) {
    const deps = pkg[field];
    if (deps && typeof deps === "object") {
      next[field] = rewriteWorkspaceRanges(deps as Record<string, string>, workspaceVersions);
    }
  }
  return next;
}

/**
 * `workspace:*` (or `workspace:^` / `workspace:~`) becomes the sibling's exact publish version — exact
 * whatever the workspace modifier, because a published range could drift onto an untested sibling.
 * A workspace dependency with no version supplied, or a supplied value that is not one exact semver
 * version (a tag, a range, a URL), fails closed: the literal would publish an uninstallable or
 * untested package.
 */
export function rewriteWorkspaceRanges(
  deps: Record<string, string>,
  workspaceVersions: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, range] of Object.entries(deps)) {
    if (!range.startsWith("workspace:")) {
      out[name] = range;
      continue;
    }
    const pinned = workspaceVersions[name];
    if (!pinned) {
      throw new Error(
        `${name} is a workspace dependency but no publish version was supplied for it (--dep ${name}=<version>)`,
      );
    }
    if (!EXACT_SEMVER.test(pinned)) {
      throw new Error(`${name} pin ${JSON.stringify(pinned)} is not an exact semver version`);
    }
    out[name] = pinned;
  }
  return out;
}

/** `--dep name=version` pairs from argv, and the remaining arguments in order. */
export function parseDependencyPins(args: string[]): {
  pins: Record<string, string>;
  rest: string[];
} {
  const pins: Record<string, string> = {};
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg !== "--dep") {
      rest.push(arg);
      continue;
    }
    const pair = args[++i];
    const at = pair?.lastIndexOf("=") ?? -1;
    if (!pair || at <= 0) throw new Error("--dep expects name=version");
    pins[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return { pins, rest };
}

/**
 * CLI arguments: `<version> [package.json path] [--dep name=version ...]`; `$VERSION` may replace the
 * first positional but never shifts the path, which is always the second positional.
 */
export function parseCliArgs(
  args: string[],
  env: { VERSION?: string },
): { version: string; manifestPath: string; pins: Record<string, string> } {
  const { pins, rest } = parseDependencyPins(args);
  const version = env.VERSION ?? rest[0];
  if (!version) {
    throw new Error(
      "usage: prepare-sdk-publish.ts <version> [package.json path] [--dep name=version ...]  (or $VERSION)",
    );
  }
  return { version, manifestPath: rest[1] ?? "package.json", pins };
}

if (import.meta.main) {
  let parsed: ReturnType<typeof parseCliArgs>;
  try {
    parsed = parseCliArgs(process.argv.slice(2), { VERSION: process.env.VERSION });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
  const fs = await import("node:fs");
  const pkg = JSON.parse(fs.readFileSync(parsed.manifestPath, "utf8"));
  const next = preparePublishManifest(pkg, parsed.version, parsed.pins);
  fs.writeFileSync(parsed.manifestPath, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`prepared ${parsed.manifestPath} for publish as ${parsed.version}`);
}

// Rewrite a package.json for publishing: the resolved version, `main`/`types`/`exports` repointed at the
// built `dist/` (the repo's source `exports: "./src/index.ts"` serves workspace consumption only), and
// every `workspace:` dependency pinned to the exact sibling version publishing alongside. Pure, so the
// rewrite is unit-tested; the publish workflow and the tarball-consumer CI job run the same code.

import { EXACT_SEMVER } from "./npm-packages.ts";

/** The published `exports` map — dist-based, dual types/default condition. */
export const PUBLISHED_EXPORTS = {
  ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
} as const;

const DEPENDENCY_FIELDS = ["dependencies", "peerDependencies", "optionalDependencies"] as const;

/**
 * Sets `version`, `main`, `types`, `exports` (dist-based), drops any `publishConfig.exports` override
 * so the top-level `exports` wins, and replaces every `workspace:` range with the sibling's exact
 * version. Everything else — `files`, `publishConfig.access`, non-workspace dependencies — is preserved
 * verbatim.
 */
export function preparePublishManifest(
  pkg: Record<string, unknown>,
  version: string,
  workspaceVersions: Record<string, string> = {},
): Record<string, unknown> {
  const next: Record<string, unknown> = {
    ...pkg,
    version,
    main: "./dist/index.js",
    types: "./dist/index.d.ts",
    exports: PUBLISHED_EXPORTS,
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

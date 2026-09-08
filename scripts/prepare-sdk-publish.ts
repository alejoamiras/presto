// B7 (F14/F15): rewrite a package.json for publishing — set the resolved version, repoint
// `main`/`types`/`exports` at the built `dist/` (replacing the source `exports: "./src/index.ts"` the repo
// uses for workspace consumption), and pin `workspace:` dependencies to the versions publishing alongside.
// Extracted from an inline `node -e` in the publish workflow so the rewrite is diff-reviewable, unit-tested
// (the mutation is pure), and reusable by the tarball-consumer CI job.

/** The published `exports` map — dist-based, dual types/default condition. */
export const PUBLISHED_EXPORTS = {
  ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
} as const;

const DEPENDENCY_FIELDS = ["dependencies", "peerDependencies", "optionalDependencies"] as const;

/**
 * Pure rewrite: given the source manifest, the resolved version, and the publish versions of any
 * workspace siblings it depends on, return the manifest to publish. Sets `version`, `main`, `types`,
 * `exports` (dist-based), drops any `publishConfig.exports` override so the top-level `exports` wins,
 * and replaces every `workspace:` range with the sibling's exact version. Everything else — `files`,
 * `publishConfig.access`, non-workspace dependencies — is preserved verbatim.
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
 * `workspace:*` (or `workspace:^` / `workspace:~`) becomes the sibling's exact publish version — exact,
 * whatever the workspace modifier, because a published range could drift onto an untested sibling. A
 * workspace dependency with no version supplied fails closed: shipping the literal `workspace:` range
 * would publish an uninstallable package.
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

// CLI: `bun scripts/prepare-sdk-publish.ts <version> [package.json path] [--dep name=version ...]`.
// Version also accepted via $VERSION. Reads, rewrites in place, writes back with a trailing newline.
if (import.meta.main) {
  const { pins, rest } = parseDependencyPins(process.argv.slice(2));
  const version = process.env.VERSION ?? rest[0];
  if (!version) {
    console.error(
      "usage: prepare-sdk-publish.ts <version> [package.json path] [--dep name=version ...]  (or $VERSION)",
    );
    process.exit(1);
  }
  const manifestPath = (process.env.VERSION ? rest[0] : rest[1]) ?? "package.json";
  const fs = await import("node:fs");
  const pkg = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const next = preparePublishManifest(pkg, version, pins);
  fs.writeFileSync(manifestPath, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`prepared ${manifestPath} for publish as ${version}`);
}

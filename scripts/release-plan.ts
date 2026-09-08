/**
 * Decide what one `release-sdk.yml` run publishes, before anything is published. Pure planning over
 * facts the caller gathers (registry versions, release tags, provenance, source changes), so the
 * release DAG is unit-testable; the CLI gathers the facts and writes the plan to `$GITHUB_OUTPUT`.
 *
 * Rules (decision ledger D-32, D-48, D-53, D-56):
 * - `aztec-derived` packages always publish; a republished base gets a revision suffix.
 * - `manifest` packages publish their version exactly once. A version already on npm is REUSED when
 *   its release tag and provenance both name the same commit and the package's sources are unchanged
 *   since that commit; otherwise it is a collision and the run fails before publishing anything.
 * - A package whose `workspace:` dependency is being published in this run cannot have that
 *   dependency's provenance or a registry-dependency consumer rerun checked up front: those checks
 *   are DEFERRED to after the dependency is published and verified, and the plan says so.
 * - A `workspace:` dependency that is neither selected nor already on npm is a hard failure.
 *
 * Usage: bun scripts/release-plan.ts --packages <key|all> [--dry-run]
 */

import { baseVersionFor, resolvePublishVersion } from "./get-sdk-publish-version.ts";
import {
  isPackageKey,
  type Manifest,
  NPM_PACKAGES,
  type NpmPackage,
  type PackageKey,
  readManifest,
  releaseTag,
  resolvePackage,
  workspaceDependencies,
} from "./npm-packages.ts";

export type Action = "publish" | "reuse";

/** What the caller knows about one package before the run publishes anything. */
export interface PackageFacts {
  manifest: Manifest;
  /** Versions already on npm. */
  published: string[];
  /** For a manifest version already on npm: does its release tag exist and match its provenance commit? */
  releaseVerified?: boolean;
  /** For a manifest version already on npm: have the package's sources changed since the tag commit? */
  changedSinceTag?: boolean;
}

export interface PlanEntry {
  key: PackageKey;
  name: string;
  version: string;
  action: Action;
  /** `name=version` pins for the package's `workspace:` dependencies, for `prepare-sdk-publish.ts --dep`. */
  dependencyVersions: Record<string, string>;
  /** Registry-dependent checks that must wait until a dependency published in this run is verified. */
  deferred: string[];
}

export type ReleasePlan = Partial<Record<PackageKey, PlanEntry>>;

/** Expand the `packages` input: one key, or every descriptor entry in dependency order. */
export function selectPackages(input: string): PackageKey[] {
  if (input === "all") return orderByDependencies(Object.keys(NPM_PACKAGES) as PackageKey[]);
  if (!isPackageKey(input)) throw new Error(`unknown packages selection ${JSON.stringify(input)}`);
  return [input];
}

/** Dependencies before dependents, so the plan and the workflow agree on publish order. */
export function orderByDependencies(
  keys: PackageKey[],
  manifests: (key: PackageKey) => Manifest = (key) => readManifest(NPM_PACKAGES[key]),
): PackageKey[] {
  const ordered: PackageKey[] = [];
  const visit = (key: PackageKey, trail: PackageKey[]) => {
    if (ordered.includes(key)) return;
    if (trail.includes(key)) throw new Error(`dependency cycle: ${[...trail, key].join(" -> ")}`);
    for (const dep of workspaceDependencies(manifests(key))) visit(dep, [...trail, key]);
    ordered.push(key);
  };
  for (const key of keys) visit(key, []);
  return ordered;
}

function decide(pkg: NpmPackage, facts: PackageFacts): { version: string; action: Action } {
  const base = baseVersionFor(pkg, facts.manifest);
  if (pkg.versionMode === "aztec-derived") {
    return { version: resolvePublishVersion(base, facts.published), action: "publish" };
  }
  if (!facts.published.includes(base)) return { version: base, action: "publish" };
  if (!facts.releaseVerified) {
    throw new Error(
      `${pkg.name}@${base} is on npm but its release tag and provenance do not agree; fix forward by bumping the version`,
    );
  }
  if (facts.changedSinceTag) {
    throw new Error(
      `${pkg.name}@${base} is published but ${pkg.dir} changed since its release tag; bump the version`,
    );
  }
  return { version: base, action: "reuse" };
}

/**
 * The plan for `selection` (already in dependency order) given `facts` for every selected package
 * and every `workspace:` dependency they reference.
 */
export function planRelease(
  selection: PackageKey[],
  facts: Partial<Record<PackageKey, PackageFacts>>,
): ReleasePlan {
  const plan: ReleasePlan = {};
  for (const key of selection) {
    const pkg = NPM_PACKAGES[key];
    const own = facts[key];
    if (!own) throw new Error(`no facts for ${key}`);
    const { version, action } = decide(pkg, own);
    const entry: PlanEntry = {
      key,
      name: pkg.name,
      version,
      action,
      dependencyVersions: {},
      deferred: [],
    };
    for (const dep of workspaceDependencies(own.manifest)) {
      resolveDependency(entry, dep, plan, facts);
    }
    plan[key] = entry;
  }
  return plan;
}

function resolveDependency(
  entry: PlanEntry,
  dep: PackageKey,
  plan: ReleasePlan,
  facts: Partial<Record<PackageKey, PackageFacts>>,
): void {
  const depPkg = NPM_PACKAGES[dep];
  const planned = plan[dep];
  if (planned) {
    entry.dependencyVersions[depPkg.name] = planned.version;
    if (planned.action === "publish") {
      entry.deferred.push(
        `${depPkg.name}@${planned.version} provenance (published in this run)`,
        `${entry.name} consumer rerun against registry ${depPkg.name}@${planned.version}`,
      );
    }
    return;
  }
  const depFacts = facts[dep];
  if (!depFacts) throw new Error(`no facts for dependency ${dep} of ${entry.key}`);
  const version = baseVersionFor(depPkg, depFacts.manifest);
  if (!depFacts.published.includes(version)) {
    throw new Error(
      `${entry.name} depends on ${depPkg.name}@${version}, which is neither selected for this run nor on npm`,
    );
  }
  entry.dependencyVersions[depPkg.name] = version;
}

/** One line per package for the run summary, deferred checks included. */
export function describePlan(plan: ReleasePlan): string {
  return Object.values(plan)
    .map((entry) => {
      const deps = Object.entries(entry.dependencyVersions)
        .map(([name, version]) => `${name}@${version}`)
        .join(", ");
      const lines = [
        `${entry.name}@${entry.version}: ${entry.action}${deps ? ` (depends on ${deps})` : ""}`,
      ];
      for (const check of entry.deferred) lines.push(`  deferred: ${check}`);
      return lines.join("\n");
    })
    .join("\n");
}

// ── fact gathering (registry, git) ──

function run(command: string[]): string {
  const result = Bun.spawnSync(command, { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    throw new Error(`${command.join(" ")} failed: ${result.stderr.toString().trim()}`);
  }
  return result.stdout.toString().trim();
}

function publishedVersions(name: string): string[] {
  const result = Bun.spawnSync(["npm", "view", name, "versions", "--json"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    if (result.stderr.toString().includes("E404")) return [];
    throw new Error(`npm view ${name} versions failed: ${result.stderr.toString().trim()}`);
  }
  const parsed = JSON.parse(result.stdout.toString());
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function releaseFacts(
  pkg: NpmPackage,
  version: string,
): Promise<Pick<PackageFacts, "releaseVerified" | "changedSinceTag">> {
  const { fetchAndVerifySdkProvenance } = await import("./sdk-release-verification.ts");
  const { resolveRemoteTagCommit } = await import("./promote-sdk-latest.ts");
  const tag = releaseTag(pkg, version);
  const refs = run([
    "git",
    "ls-remote",
    "--tags",
    "origin",
    `refs/tags/${tag}`,
    `refs/tags/${tag}^{}`,
  ]);
  const tagCommit = resolveRemoteTagCommit(refs);
  if (!tagCommit) return { releaseVerified: false };
  let provenanceCommit: string;
  try {
    provenanceCommit = (await fetchAndVerifySdkProvenance(version, undefined, undefined, pkg))
      .commit;
  } catch {
    return { releaseVerified: false };
  }
  if (provenanceCommit !== tagCommit) return { releaseVerified: false };
  const diff = Bun.spawnSync(["git", "diff", "--quiet", tagCommit, "HEAD", "--", pkg.dir]);
  return { releaseVerified: true, changedSinceTag: diff.exitCode !== 0 };
}

async function gatherFacts(keys: PackageKey[]): Promise<Partial<Record<PackageKey, PackageFacts>>> {
  const facts: Partial<Record<PackageKey, PackageFacts>> = {};
  const pending = [...keys];
  while (pending.length) {
    const key = pending.shift() as PackageKey;
    if (facts[key]) continue;
    const pkg: NpmPackage = NPM_PACKAGES[key];
    const manifest = readManifest(pkg);
    const published = publishedVersions(pkg.name);
    const entry: PackageFacts = { manifest, published };
    const base = baseVersionFor(pkg, manifest);
    if (pkg.versionMode === "manifest" && published.includes(base)) {
      Object.assign(entry, await releaseFacts(pkg, base));
    }
    facts[key] = entry;
    pending.push(...workspaceDependencies(manifest));
  }
  return facts;
}

function parseArgs(args: string[]): { packages: string; dryRun: boolean } {
  const at = args.indexOf("--packages");
  const packages = at >= 0 ? args[at + 1] : undefined;
  if (!packages) throw new Error("usage: release-plan.ts --packages <key|all> [--dry-run]");
  return { packages, dryRun: args.includes("--dry-run") };
}

if (import.meta.main) {
  const { packages, dryRun } = parseArgs(process.argv.slice(2));
  const selection = selectPackages(packages);
  for (const key of selection) resolvePackage(key);
  const plan = planRelease(selection, await gatherFacts(selection));
  const summary = describePlan(plan);
  console.log(`${dryRun ? "DRY RUN — " : ""}release plan:\n${summary}`);
  const output = process.env.GITHUB_OUTPUT;
  if (output) {
    const fs = await import("node:fs");
    fs.appendFileSync(output, workflowOutputs(plan, summary));
  }
}

/**
 * `$GITHUB_OUTPUT` lines: the plan, the summary, and per descriptor key `publish_<key>`,
 * `version_<key>`, `deps_<key>` (dashes as underscores) so job conditions need no JSON walking.
 */
export function workflowOutputs(plan: ReleasePlan, summary: string): string {
  const lines = [`plan=${JSON.stringify(plan)}`, `summary<<EOF`, summary, "EOF"];
  for (const key of Object.keys(NPM_PACKAGES) as PackageKey[]) {
    const entry = plan[key];
    const slug = key.replace(/-/g, "_");
    lines.push(`publish_${slug}=${entry?.action === "publish"}`);
    lines.push(`version_${slug}=${entry?.version ?? ""}`);
    const deps = Object.entries(entry?.dependencyVersions ?? {})
      .map(([name, version]) => `${name}=${version}`)
      .join(",");
    lines.push(`deps_${slug}=${deps}`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Decide what one `release-sdk.yml` run publishes, before anything is published. Pure planning over
 * facts the caller gathers (registry versions, release records, provenance, source changes), so the
 * release DAG is unit-testable; the CLI gathers the facts and writes the plan to `$GITHUB_OUTPUT`.
 *
 * Rules:
 * - `aztec-derived` packages always publish; a republished base gets a revision suffix.
 * - `manifest` packages publish their version exactly once. A version already on npm is REUSED only
 *   when its release tag and cryptographically verified provenance name the same commit, its GitHub
 *   release exists, its build inputs are unchanged since that commit, and the dependency pins this run
 *   would give it equal the ones in the published artifact; anything else is a collision and the run
 *   fails before publishing anything.
 * - A candidate that is not on npm but already has a release tag or GitHub release is a collision.
 * - A package whose `workspace:` dependency is being published in this run cannot have that
 *   dependency's provenance or a registry-dependency consumer rerun checked up front: those checks
 *   are DEFERRED to the package's own publish job, and the plan says so.
 * - A `workspace:` dependency that is not selected must already be on npm at the pinned version with
 *   a verified, unchanged release.
 *
 * Usage: bun scripts/release-plan.ts --packages <key|all> [--dry-run]
 */

import { baseVersionFor, resolvePublishVersion } from "./get-sdk-publish-version.ts";
import {
  isPackageKey,
  isValidVersion,
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
  /** For a candidate NOT on npm: does a release tag or GitHub release already exist for it? */
  recordsExist?: boolean;
  /**
   * For a manifest version already on npm: tag commit == verified provenance commit, signatures
   * verified by npm, GitHub release present.
   */
  releaseVerified?: boolean;
  /** For a manifest version already on npm: have its build inputs changed since the tag commit? */
  changedSinceTag?: boolean;
  /** For a manifest version already on npm: the `dependencies` the published artifact carries. */
  publishedDependencies?: Record<string, string>;
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
  const version =
    pkg.versionMode === "aztec-derived" ? resolvePublishVersion(base, facts.published) : base;
  if (!isValidVersion(pkg, version)) {
    throw new Error(`${pkg.name}: ${version} is not a valid ${pkg.versionMode} version`);
  }
  if (!facts.published.includes(version)) {
    if (facts.recordsExist) {
      throw new Error(
        `${pkg.name}@${version} is not on npm but a release tag or GitHub release already exists; fix forward by bumping the version`,
      );
    }
    return { version, action: "publish" };
  }
  requireReusable(pkg, version, facts);
  return { version, action: "reuse" };
}

function requireReusable(pkg: NpmPackage, version: string, facts: PackageFacts): void {
  if (!facts.releaseVerified) {
    throw new Error(
      `${pkg.name}@${version} is on npm but its release records and provenance do not verify; fix forward by bumping the version`,
    );
  }
  if (facts.changedSinceTag) {
    throw new Error(
      `${pkg.name}@${version} is published but its build inputs changed since its release tag; bump the version`,
    );
  }
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
    if (action === "reuse") requireSamePins(entry, own);
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
    if (planned.action === "publish" && entry.action === "publish") {
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
  requireReusable(depPkg, version, depFacts);
  entry.dependencyVersions[depPkg.name] = version;
}

/** A reused artifact is immutable: the pins this run would give it must be the ones it already has. */
function requireSamePins(entry: PlanEntry, facts: PackageFacts): void {
  for (const [name, version] of Object.entries(entry.dependencyVersions)) {
    const published = facts.publishedDependencies?.[name];
    if (published !== version) {
      throw new Error(
        `${entry.name}@${entry.version} is published with ${name}@${published ?? "(absent)"} but this run would pin ${version}; bump the version to pick up the new dependency`,
      );
    }
  }
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

// ── fact gathering (registry, git, GitHub) ──

/** Build inputs of a package beyond its own directory; a change here can change the artifact. */
const SHARED_BUILD_INPUTS = ["bun.lock", "tsconfig.json"];

function run(command: string[]): string {
  const result = Bun.spawnSync(command, { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    throw new Error(`${command.join(" ")} failed: ${result.stderr.toString().trim()}`);
  }
  return result.stdout.toString().trim();
}

/** `npm view` output as JSON, or `undefined` when the registry has no such package or version. */
function npmViewJson(spec: string, field: string): unknown {
  const result = Bun.spawnSync(["npm", "view", spec, field, "--json"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    if (result.stderr.toString().includes("E404")) return undefined;
    throw new Error(`npm view ${spec} ${field} failed: ${result.stderr.toString().trim()}`);
  }
  const text = result.stdout.toString().trim();
  return text ? JSON.parse(text) : undefined;
}

function publishedVersions(name: string): string[] {
  const parsed = npmViewJson(name, "versions");
  if (parsed === undefined) return [];
  return Array.isArray(parsed) ? parsed : [parsed as string];
}

function remoteTagCommit(tag: string): string | undefined {
  const refs = run([
    "git",
    "ls-remote",
    "--tags",
    "origin",
    `refs/tags/${tag}`,
    `refs/tags/${tag}^{}`,
  ]);
  const lines = refs.split("\n").filter(Boolean);
  const peeled = lines.find((line) => line.endsWith("^{}"));
  return (peeled ?? lines[0])?.split(/\s+/)[0];
}

function githubReleaseExists(tag: string): boolean {
  const result = Bun.spawnSync(["gh", "release", "view", tag, "--json", "tagName"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode === 0) return true;
  if (result.stderr.toString().includes("release not found")) return false;
  throw new Error(`gh release view ${tag} failed: ${result.stderr.toString().trim()}`);
}

async function releaseFacts(
  pkg: NpmPackage,
  version: string,
): Promise<Pick<PackageFacts, "releaseVerified" | "changedSinceTag" | "publishedDependencies">> {
  const { fetchAndVerifySdkProvenance } = await import("./sdk-release-verification.ts");
  const { verifySdkPackageSignatures } = await import("./verify-sdk-package-signatures.ts");
  const tag = releaseTag(pkg, version);
  const tagCommit = remoteTagCommit(tag);
  if (!tagCommit) return { releaseVerified: false };
  try {
    const provenance = await fetchAndVerifySdkProvenance(version, tagCommit, undefined, pkg);
    await verifySdkPackageSignatures(version, pkg);
    if (provenance.commit !== tagCommit || !githubReleaseExists(tag)) {
      return { releaseVerified: false };
    }
  } catch {
    return { releaseVerified: false };
  }
  const diff = Bun.spawnSync([
    "git",
    "diff",
    "--quiet",
    tagCommit,
    "HEAD",
    "--",
    pkg.dir,
    ...SHARED_BUILD_INPUTS,
  ]);
  return {
    releaseVerified: true,
    changedSinceTag: diff.exitCode !== 0,
    publishedDependencies: publishedPins(`${pkg.name}@${version}`),
  };
}

/** Every pin the published artifact carries, across the fields the manifest preparer rewrites. */
function publishedPins(spec: string): Record<string, string> {
  const pins: Record<string, string> = {};
  for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    const deps = npmViewJson(spec, field) as Record<string, string> | undefined;
    for (const [name, version] of Object.entries(deps ?? {})) {
      if (pins[name] !== undefined && pins[name] !== version) {
        throw new Error(`${spec} pins ${name} inconsistently across dependency fields`);
      }
      pins[name] = version;
    }
  }
  return pins;
}

async function packageFacts(pkg: NpmPackage): Promise<PackageFacts> {
  const manifest = readManifest(pkg);
  const published = publishedVersions(pkg.name);
  const facts: PackageFacts = { manifest, published };
  const base = baseVersionFor(pkg, manifest);
  const candidate =
    pkg.versionMode === "aztec-derived" ? resolvePublishVersion(base, published) : base;
  if (published.includes(candidate)) {
    Object.assign(facts, await releaseFacts(pkg, candidate));
  } else {
    const tag = releaseTag(pkg, candidate);
    facts.recordsExist = remoteTagCommit(tag) !== undefined || githubReleaseExists(tag);
  }
  return facts;
}

async function gatherFacts(keys: PackageKey[]): Promise<Partial<Record<PackageKey, PackageFacts>>> {
  const facts: Partial<Record<PackageKey, PackageFacts>> = {};
  const pending = [...keys];
  while (pending.length) {
    const key = pending.shift() as PackageKey;
    if (facts[key]) continue;
    const entry = await packageFacts(NPM_PACKAGES[key]);
    facts[key] = entry;
    pending.push(...workspaceDependencies(entry.manifest));
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

export const MINIMUM_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface ResolvedDependency {
  ecosystem: "npm" | "cargo";
  name: string;
  version: string;
  source: string;
}

export interface ActionReference {
  repository: string;
  path: string;
  sha: string;
  tag: string;
}

interface NpmPackument {
  time?: Record<string, string>;
  versions?: Record<string, { deprecated?: unknown }>;
}

interface CrateVersions {
  versions?: Array<{ num?: unknown; created_at?: unknown; yanked?: unknown }>;
}

interface GitHubRelease {
  draft?: unknown;
  prerelease?: unknown;
  published_at?: unknown;
  tag_name?: unknown;
}

interface GitObject {
  object?: { sha?: unknown; type?: unknown; url?: unknown };
}

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const CARGO_LOCKS = [
  "packages/presto/core/Cargo.lock",
  "packages/presto/server/Cargo.lock",
  "packages/presto/src-tauri/Cargo.lock",
];

function splitResolvedPackage(value: string): { name: string; version: string } | undefined {
  const separator = value.lastIndexOf("@");
  if (separator <= 0) return undefined;
  const name = value.slice(0, separator);
  const version = value.slice(separator + 1);
  if (!name || !version || version.startsWith("workspace:")) return undefined;
  return { name, version };
}

export function parseBunLock(text: string): ResolvedDependency[] {
  if (!text.trim()) return [];
  const lock = Bun.JSONC.parse(text) as { packages?: Record<string, unknown> };
  const records: ResolvedDependency[] = [];

  for (const value of Object.values(lock.packages ?? {})) {
    if (!Array.isArray(value) || typeof value[0] !== "string") continue;
    const resolved = splitResolvedPackage(value[0]);
    if (!resolved) continue;
    records.push({
      ecosystem: "npm",
      ...resolved,
      source: typeof value[1] === "string" && value[1] ? value[1] : "registry:npm",
    });
  }

  return records;
}

export function parseCargoLock(text: string): ResolvedDependency[] {
  if (!text.trim()) return [];
  const lock = Bun.TOML.parse(text) as {
    package?: Array<{ name?: unknown; version?: unknown; source?: unknown }>;
  };

  return (lock.package ?? []).flatMap((entry) => {
    if (typeof entry.name !== "string" || typeof entry.version !== "string") return [];
    if (typeof entry.source !== "string") return [];
    return [
      {
        ecosystem: "cargo" as const,
        name: entry.name,
        version: entry.version,
        source: entry.source,
      },
    ];
  });
}

function dependencyIdentity(record: ResolvedDependency): string {
  // A source change is a new trust decision even when the package name and version stay constant.
  return [record.ecosystem, record.name, record.version, record.source].join("\0");
}

export function changedDependencies(
  base: ResolvedDependency[],
  current: ResolvedDependency[],
): ResolvedDependency[] {
  const existing = new Set(base.map(dependencyIdentity));
  return current.filter((record) => !existing.has(dependencyIdentity(record)));
}

function uniqueDependencies(records: ResolvedDependency[]): ResolvedDependency[] {
  return [...new Map(records.map((record) => [dependencyIdentity(record), record])).values()];
}

export function parseActionReferences(text: string): ActionReference[] {
  const references: ActionReference[] = [];
  // action-pins.test.ts enforces this exact SHA plus human-readable tag form across the repository.
  const pattern = /uses:\s*([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[^@\s]+)?)@([0-9a-f]{40})\s*#\s*(\S+)/g;

  for (const match of text.matchAll(pattern)) {
    const [, actionPath, sha, tag] = match;
    if (!actionPath || !sha || !tag) continue;
    const [owner, repository, ...path] = actionPath.split("/");
    if (!owner || !repository) continue;
    references.push({
      repository: `${owner}/${repository}`,
      path: path.join("/"),
      sha,
      tag,
    });
  }

  return references;
}

function actionIdentity(reference: ActionReference): string {
  return [reference.repository, reference.path, reference.sha, reference.tag].join("\0");
}

export function changedActions(
  base: ActionReference[],
  current: ActionReference[],
): ActionReference[] {
  const existing = new Set(base.map(actionIdentity));
  const unique = new Map<string, ActionReference>();
  for (const reference of current) {
    const identity = actionIdentity(reference);
    if (!existing.has(identity)) unique.set(identity, reference);
  }
  return [...unique.values()];
}

export function assertEligibleTimestamp(label: string, publishedAt: unknown, now: Date): Date {
  if (typeof publishedAt !== "string") {
    throw new Error(`${label}: publication timestamp is missing`);
  }
  const published = new Date(publishedAt);
  if (!Number.isFinite(published.getTime())) {
    throw new Error(`${label}: publication timestamp is invalid`);
  }
  const eligibleAt = published.getTime() + MINIMUM_AGE_MS;
  if (eligibleAt > now.getTime()) {
    throw new Error(`${label}: published ${published.toISOString()}, eligible ${new Date(eligibleAt).toISOString()}`);
  }
  return published;
}

function requestHeaders(token?: string): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "presto-dependency-age",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function fetchJson<T>(url: string, fetchImpl: FetchLike, token?: string): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetchImpl(url, { headers: requestHeaders(token) });
    if (response.ok) return (await response.json()) as T;

    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === 3) throw new Error(`${url}: HTTP ${response.status}`);
    const retryAfter = Number(response.headers.get("retry-after"));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1_000 : 500 * 2 ** attempt;
    await Bun.sleep(delay);
  }
  throw new Error(`${url}: request retries exhausted`);
}

export async function verifyNpmDependency(
  dependency: ResolvedDependency,
  now: Date,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  if (dependency.source !== "registry:npm") {
    throw new Error(`${dependency.name}@${dependency.version}: unsupported npm source ${dependency.source}`);
  }
  const packument = await fetchJson<NpmPackument>(
    `https://registry.npmjs.org/${encodeURIComponent(dependency.name)}`,
    fetchImpl,
  );
  const metadata = packument.versions?.[dependency.version];
  if (!metadata) throw new Error(`${dependency.name}@${dependency.version}: registry metadata is missing`);
  if (metadata.deprecated) throw new Error(`${dependency.name}@${dependency.version}: release is deprecated`);
  assertEligibleTimestamp(
    `${dependency.name}@${dependency.version}`,
    packument.time?.[dependency.version],
    now,
  );
}

export async function verifyCargoDependency(
  dependency: ResolvedDependency,
  now: Date,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  if (!dependency.source.startsWith("registry+https://github.com/rust-lang/crates.io-index")) {
    throw new Error(`${dependency.name}@${dependency.version}: unsupported Cargo source ${dependency.source}`);
  }
  const body = await fetchJson<CrateVersions>(
    `https://crates.io/api/v1/crates/${encodeURIComponent(dependency.name)}/versions`,
    fetchImpl,
  );
  const metadata = body.versions?.find((version) => version.num === dependency.version);
  if (!metadata) throw new Error(`${dependency.name}@${dependency.version}: crates.io metadata is missing`);
  if (metadata.yanked) throw new Error(`${dependency.name}@${dependency.version}: release is yanked`);
  assertEligibleTimestamp(`${dependency.name}@${dependency.version}`, metadata.created_at, now);
}

async function resolveGitHubTag(
  repository: string,
  tag: string,
  fetchImpl: FetchLike,
  token?: string,
): Promise<string> {
  let object = (
    await fetchJson<GitObject>(
      `https://api.github.com/repos/${repository}/git/ref/tags/${encodeURIComponent(tag)}`,
      fetchImpl,
      token,
    )
  ).object;

  for (let depth = 0; depth < 5 && object?.type === "tag"; depth++) {
    if (typeof object.url !== "string") throw new Error(`${repository}@${tag}: invalid annotated tag`);
    object = (await fetchJson<GitObject>(object.url, fetchImpl, token)).object;
  }
  if (object?.type !== "commit" || typeof object.sha !== "string") {
    throw new Error(`${repository}@${tag}: tag does not resolve to a commit`);
  }
  return object.sha;
}

export async function verifyActionReference(
  reference: ActionReference,
  now: Date,
  fetchImpl: FetchLike = fetch,
  token = process.env.GITHUB_TOKEN,
): Promise<void> {
  const release = await fetchJson<GitHubRelease>(
    `https://api.github.com/repos/${reference.repository}/releases/tags/${encodeURIComponent(reference.tag)}`,
    fetchImpl,
    token,
  );
  if (release.tag_name !== reference.tag || release.draft || release.prerelease) {
    throw new Error(`${reference.repository}@${reference.tag}: tag is not an exact stable release`);
  }
  assertEligibleTimestamp(
    `${reference.repository}@${reference.tag}`,
    release.published_at,
    now,
  );
  const resolved = await resolveGitHubTag(
    reference.repository,
    reference.tag,
    fetchImpl,
    token,
  );
  if (resolved !== reference.sha) {
    throw new Error(
      `${reference.repository}@${reference.tag}: tag resolves to ${resolved}, not ${reference.sha}`,
    );
  }
}

async function runGit(args: string[]): Promise<string> {
  const process = Bun.spawn(["git", ...args], { stdout: "pipe", stderr: "pipe" });
  const output = await new Response(process.stdout).text();
  const exitCode = await process.exited;
  if (exitCode !== 0) {
    const error = await new Response(process.stderr).text();
    throw new Error(`git ${args.join(" ")} failed: ${error.trim()}`);
  }
  return output;
}

async function readAtRef(ref: string, path: string): Promise<string> {
  try {
    return await runGit(["show", `${ref}:${path}`]);
  } catch {
    // A missing base path becomes an empty baseline, so every current entry is checked fail-closed.
    return "";
  }
}

async function actionFilesAtRef(ref?: string): Promise<string[]> {
  if (ref) {
    const output = await runGit(["ls-tree", "-r", "--name-only", ref, "--", ".github"]);
    return output.split("\n").filter((path) => /\.ya?ml$/.test(path));
  }
  const files: string[] = [];
  for (const pattern of [".github/**/*.yml", ".github/**/*.yaml"]) {
    for await (const path of new Bun.Glob(pattern).scan(".")) files.push(path);
  }
  return files;
}

async function loadActions(ref?: string): Promise<ActionReference[]> {
  const files = await actionFilesAtRef(ref);
  const references: ActionReference[] = [];
  for (const path of files) {
    const text = ref ? await readAtRef(ref, path) : await Bun.file(path).text();
    references.push(...parseActionReferences(text));
  }
  return references;
}

async function verifyInBatches<T>(
  values: T[],
  verify: (value: T) => Promise<void>,
): Promise<string[]> {
  const failures: string[] = [];
  for (let index = 0; index < values.length; index += 6) {
    const batch = values.slice(index, index + 6);
    const results = await Promise.allSettled(batch.map(verify));
    for (const result of results) {
      if (result.status === "rejected") {
        failures.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
      }
    }
  }
  return failures;
}

function readArgument(name: string): string | undefined {
  const index = Bun.argv.indexOf(name);
  return index >= 0 ? Bun.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const base = readArgument("--base");
  if (!base) throw new Error("usage: bun scripts/dependency-age.ts --base <git-ref> [--now <ISO>]");
  const nowText = readArgument("--now");
  const now = nowText ? new Date(nowText) : new Date();
  if (!Number.isFinite(now.getTime())) throw new Error(`invalid --now value: ${nowText}`);

  const baseNpm = parseBunLock(await readAtRef(base, "bun.lock"));
  const currentNpm = parseBunLock(await Bun.file("bun.lock").text());
  const npm = uniqueDependencies(changedDependencies(baseNpm, currentNpm));

  const cargo: ResolvedDependency[] = [];
  for (const path of CARGO_LOCKS) {
    const baseEntries = parseCargoLock(await readAtRef(base, path));
    const currentEntries = parseCargoLock(await Bun.file(path).text());
    cargo.push(...changedDependencies(baseEntries, currentEntries));
  }

  const uniqueCargo = uniqueDependencies(cargo);
  const actions = changedActions(await loadActions(base), await loadActions());
  console.log(
    `Checking ${npm.length} npm, ${uniqueCargo.length} Cargo, and ${actions.length} Action changes`,
  );

  const failures = [
    ...(await verifyInBatches(npm, (entry) => verifyNpmDependency(entry, now))),
    ...(await verifyInBatches(uniqueCargo, (entry) => verifyCargoDependency(entry, now))),
    ...(await verifyInBatches(actions, (entry) => verifyActionReference(entry, now))),
  ];
  if (failures.length > 0) throw new Error(failures.map((failure) => `- ${failure}`).join("\n"));
  console.log("All changed dependency references satisfy the seven-day policy.");
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

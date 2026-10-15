export interface UpdaterReleaseCandidate {
  tagName: string;
  draft: boolean;
  prerelease: boolean;
  assetNames: string[];
  pubkey: string;
  /** API digest of the release's own signed `latest.json` asset. */
  feedDigest?: string;
}

export interface UpdaterBaseline {
  tag: string;
  version: string;
}

/** The live updater feed as served: its claimed version and the SHA-256 of its exact bytes. */
export interface LiveFeed {
  version: string;
  sha256: string;
}

interface SelectUpdaterBaselineOptions {
  version: string;
  currentPubkey: string;
  releases: UpdaterReleaseCandidate[];
}

interface GitHubRelease {
  tag_name?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  assets?: Array<{ name?: unknown; digest?: unknown }>;
}

interface GitHubContent {
  content?: unknown;
  encoding?: unknown;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const TAG_PREFIX = "presto-v";
const FEED_ASSET = "latest.json";
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/;
const FEED_ATTEMPTS = 5;
const FEED_TIMEOUT_MS = 15_000;

function versionFromTag(tagName: string): string | undefined {
  if (!tagName.startsWith(TAG_PREFIX)) return undefined;
  const version = tagName.slice(TAG_PREFIX.length);
  try {
    Bun.semver.order(version, version);
    return version;
  } catch {
    return undefined;
  }
}

function hasCompleteInstallerSet(candidate: UpdaterReleaseCandidate, version: string): boolean {
  const required = [
    `Presto-${version}-macOS-Apple-Silicon.dmg`,
    `Presto-${version}-macOS-Intel.dmg`,
    `Presto-${version}-Linux-x86_64.AppImage`,
    `Presto-${version}-Windows-x86_64-setup.exe`,
  ];
  const names = new Set(candidate.assetNames);
  return required.every((name) => names.has(name));
}

export function selectUpdaterBaseline(options: SelectUpdaterBaselineOptions): UpdaterBaseline {
  const eligible = options.releases
    .flatMap((release) => {
      const version = versionFromTag(release.tagName);
      if (
        !version ||
        release.draft ||
        Bun.semver.order(version, options.version) !== -1 ||
        !hasCompleteInstallerSet(release, version)
      ) {
        return [];
      }
      return [{ release, version }];
    })
    .sort((a, b) => Bun.semver.order(b.version, a.version));

  const sameKey = eligible.find(({ release }) => release.pubkey === options.currentPubkey);
  if (sameKey) {
    return {
      tag: sameKey.release.tagName,
      version: sameKey.version,
    };
  }

  throw new Error("no complete published lower presto release uses the current updater key");
}

/**
 * The release installed users run: the one whose own signed `latest.json` the live feed serves
 * byte for byte. Throws, naming the reason, unless it is a published, complete, same-key stable
 * below `version`.
 */
export function selectLiveStableBaseline(
  options: SelectUpdaterBaselineOptions & { feed: LiveFeed },
): UpdaterBaseline {
  const { version, currentPubkey, releases, feed } = options;
  const tag = `${TAG_PREFIX}${feed.version}`;
  const fail = (reason: string) => new Error(`live updater feed serves ${feed.version}: ${reason}`);
  if (!versionFromTag(tag)) throw fail("not a release version");
  const release = releases.find((candidate) => candidate.tagName === tag);
  if (!release) throw fail(`no published release ${tag}`);
  if (!release.feedDigest || !SHA256_DIGEST.test(release.feedDigest)) {
    throw fail(`${tag} has no ${FEED_ASSET} digest to bind the feed to`);
  }
  if (release.feedDigest !== `sha256:${feed.sha256}`) {
    throw fail(`its bytes are not ${tag}'s own signed ${FEED_ASSET}`);
  }
  if (release.draft || release.prerelease || feed.version.includes("-")) {
    throw fail(`${tag} is not a published stable release`);
  }
  if (!hasCompleteInstallerSet(release, feed.version)) {
    throw fail(`${tag} lacks a complete installer set`);
  }
  if (release.pubkey !== currentPubkey) {
    throw fail(`${tag} uses another updater key, so installed users cannot verify ${version}`);
  }
  if (Bun.semver.order(feed.version, version) !== -1) {
    throw fail(
      `not below ${version}, so installed users would never update to it (right after a promote, re-run once the feed has propagated)`,
    );
  }
  return { tag, version: feed.version };
}

/** The smoke baselines, greatest lower first; the live stable joins only when it is another release. */
export function updaterBaselines(
  greatestLower: UpdaterBaseline,
  liveStable: UpdaterBaseline,
): UpdaterBaseline[] {
  return greatestLower.tag === liveStable.tag ? [greatestLower] : [greatestLower, liveStable];
}

/** Refuses a publish whose smokes never started from the release the live feed serves now. */
export function assertLiveStableSmoked(feed: LiveFeed, smoked: UpdaterBaseline[]): void {
  if (!smoked.some((baseline) => baseline.tag === `${TAG_PREFIX}${feed.version}`)) {
    const tested = smoked.map((baseline) => baseline.version).join(", ");
    throw new Error(
      `live updater feed now serves ${feed.version}, but this run's updater smokes started only from ${tested}`,
    );
  }
}

/**
 * Reads the public feed without credentials or redirects, retrying transport failures. Its body
 * is never retried for content: a stale or malformed feed fails the caller instead.
 */
export async function loadLiveFeed(
  url: string,
  fetchImpl: FetchLike = fetch,
  retryDelayMs = 3_000,
): Promise<LiveFeed> {
  if (new URL(url).protocol !== "https:") throw new Error(`live updater feed is not https: ${url}`);
  let bytes: Uint8Array | undefined;
  let failure = "";
  for (let attempt = 1; !bytes && attempt <= FEED_ATTEMPTS; attempt++) {
    try {
      const response = await fetchImpl(url, {
        redirect: "error",
        signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
      });
      if (response.ok) bytes = new Uint8Array(await response.arrayBuffer());
      else failure = `HTTP ${response.status}`;
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    if (!bytes && attempt < FEED_ATTEMPTS) await Bun.sleep(retryDelayMs * attempt);
  }
  if (!bytes) {
    throw new Error(
      `live updater feed ${url} unreachable after ${FEED_ATTEMPTS} attempts: ${failure}`,
    );
  }
  let version: unknown;
  try {
    version = JSON.parse(new TextDecoder().decode(bytes))?.version;
  } catch {
    version = undefined;
  }
  if (typeof version !== "string" || version.length === 0) {
    throw new Error(`live updater feed ${url} carries no version`);
  }
  return { version, sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex") };
}

function githubHeaders(token: string): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function loadGitHubReleases(
  repository: string,
  token: string,
  fetchImpl: FetchLike,
): Promise<GitHubRelease[]> {
  const releases: GitHubRelease[] = [];
  for (let page = 1; ; page++) {
    const response = await fetchImpl(
      `https://api.github.com/repos/${repository}/releases?per_page=100&page=${page}`,
      { headers: githubHeaders(token) },
    );
    if (!response.ok) {
      throw new Error(`GitHub releases query failed with HTTP ${response.status}`);
    }
    const batch = (await response.json()) as GitHubRelease[];
    if (!Array.isArray(batch)) throw new Error("GitHub releases response was not an array");
    releases.push(...batch);
    if (batch.length < 100) return releases;
  }
}

function releaseShape(release: GitHubRelease): UpdaterReleaseCandidate | undefined {
  if (
    typeof release.tag_name !== "string" ||
    typeof release.draft !== "boolean" ||
    typeof release.prerelease !== "boolean"
  ) {
    return undefined;
  }
  if (!release.tag_name.startsWith(TAG_PREFIX)) return undefined;
  const assets = release.assets ?? [];
  const feedDigest = assets.find((asset) => asset.name === FEED_ASSET)?.digest;
  return {
    tagName: release.tag_name,
    draft: release.draft,
    prerelease: release.prerelease,
    assetNames: assets.flatMap((asset) => (typeof asset.name === "string" ? [asset.name] : [])),
    pubkey: "",
    ...(typeof feedDigest === "string" ? { feedDigest } : {}),
  };
}

async function loadReleasePubkey(
  repository: string,
  token: string,
  tagName: string,
  fetchImpl: FetchLike,
): Promise<string> {
  const response = await fetchImpl(
    `https://api.github.com/repos/${repository}/contents/packages/presto/src-tauri/tauri.conf.json?ref=${encodeURIComponent(tagName)}`,
    { headers: githubHeaders(token) },
  );
  if (!response.ok) {
    throw new Error(`failed to read updater configuration at ${tagName}: HTTP ${response.status}`);
  }
  const content = (await response.json()) as GitHubContent;
  if (content.encoding !== "base64" || typeof content.content !== "string") {
    throw new Error(`invalid updater configuration response at ${tagName}`);
  }
  const config = JSON.parse(Buffer.from(content.content.replace(/\s/g, ""), "base64").toString());
  const pubkey = config?.plugins?.updater?.pubkey;
  if (typeof pubkey !== "string" || pubkey.length === 0) {
    throw new Error(`missing updater public key at ${tagName}`);
  }
  return pubkey;
}

async function buildReleaseCandidate(
  repository: string,
  token: string,
  release: GitHubRelease,
  fetchImpl: FetchLike,
): Promise<UpdaterReleaseCandidate | undefined> {
  const candidate = releaseShape(release);
  if (!candidate) return undefined;
  const version = versionFromTag(candidate.tagName);
  // Ineligible releases skip config fetches; selection filters them before comparing keys.
  if (!version || candidate.draft || !hasCompleteInstallerSet(candidate, version)) return candidate;
  const pubkey = await loadReleasePubkey(repository, token, candidate.tagName, fetchImpl);
  return { ...candidate, pubkey };
}

export async function loadUpdaterReleaseCandidates(
  repository: string,
  token: string,
  fetchImpl: FetchLike = fetch,
): Promise<UpdaterReleaseCandidate[]> {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error(`invalid GitHub repository: ${repository}`);
  }

  const releases = await loadGitHubReleases(repository, token, fetchImpl);
  const candidates: UpdaterReleaseCandidate[] = [];
  for (const release of releases) {
    const candidate = await buildReleaseCandidate(repository, token, release, fetchImpl);
    if (candidate) candidates.push(candidate);
  }
  return candidates;
}

function readArg(name: string): string {
  const index = Bun.argv.indexOf(name);
  const value = index >= 0 ? Bun.argv[index + 1] : undefined;
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

function parseSmoked(json: string): UpdaterBaseline[] {
  const smoked: unknown = JSON.parse(json);
  if (
    !Array.isArray(smoked) ||
    smoked.length === 0 ||
    !smoked.every(
      (baseline) => typeof baseline?.tag === "string" && typeof baseline?.version === "string",
    )
  ) {
    throw new Error("--smoked must be the resolver's non-empty baselines array");
  }
  return smoked;
}

async function resolve(feedUrl: string): Promise<void> {
  const repository = readArg("--repository");
  const version = readArg("--version");
  const currentPubkey = readArg("--pubkey");
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is required");
  const releases = await loadUpdaterReleaseCandidates(repository, token);
  const greatestLower = selectUpdaterBaseline({ version, currentPubkey, releases });
  const feed = await loadLiveFeed(feedUrl);
  const liveStable = selectLiveStableBaseline({ version, currentPubkey, releases, feed });
  console.log(
    JSON.stringify({
      baselines: updaterBaselines(greatestLower, liveStable),
      greatestLower: greatestLower.version,
      liveStable: liveStable.version,
    }),
  );
}

if (import.meta.main) {
  try {
    const feedUrl = readArg("--feed-url");
    if (Bun.argv.includes("--smoked")) {
      const smoked = parseSmoked(readArg("--smoked"));
      const feed = await loadLiveFeed(feedUrl);
      assertLiveStableSmoked(feed, smoked);
      console.log(
        `live updater feed serves ${feed.version}, which this run's updater smokes covered`,
      );
    } else {
      await resolve(feedUrl);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

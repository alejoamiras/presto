export interface UpdaterReleaseCandidate {
  tagName: string;
  draft: boolean;
  assetNames: string[];
  pubkey: string;
}

export interface UpdaterBaseline {
  tag: string;
  version: string;
}

interface SelectUpdaterBaselineOptions {
  version: string;
  currentPubkey: string;
  releases: UpdaterReleaseCandidate[];
}

interface GitHubRelease {
  tag_name?: unknown;
  draft?: unknown;
  assets?: Array<{ name?: unknown }>;
}

interface GitHubContent {
  content?: unknown;
  encoding?: unknown;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const TAG_PREFIX = "presto-v";

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

function githubHeaders(token: string): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

export async function loadUpdaterReleaseCandidates(
  repository: string,
  token: string,
  fetchImpl: FetchLike = fetch,
): Promise<UpdaterReleaseCandidate[]> {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error(`invalid GitHub repository: ${repository}`);
  }

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
    if (batch.length < 100) break;
  }

  const candidates: UpdaterReleaseCandidate[] = [];
  for (const release of releases) {
    if (typeof release.tag_name !== "string" || typeof release.draft !== "boolean") continue;
    if (!release.tag_name.startsWith(TAG_PREFIX)) continue;
    const version = versionFromTag(release.tag_name);

    const assetNames = (release.assets ?? []).flatMap((asset) =>
      typeof asset.name === "string" ? [asset.name] : [],
    );
    const shapeOnly: UpdaterReleaseCandidate = {
      tagName: release.tag_name,
      draft: release.draft,
      assetNames,
      pubkey: "",
    };
    // Ineligible releases skip config fetches; selection rejects their empty-key sentinels.
    if (!version || release.draft || !hasCompleteInstallerSet(shapeOnly, version)) {
      candidates.push(shapeOnly);
      continue;
    }

    const configResponse = await fetchImpl(
      `https://api.github.com/repos/${repository}/contents/packages/presto/src-tauri/tauri.conf.json?ref=${encodeURIComponent(release.tag_name)}`,
      { headers: githubHeaders(token) },
    );
    if (!configResponse.ok) {
      throw new Error(
        `failed to read updater configuration at ${release.tag_name}: HTTP ${configResponse.status}`,
      );
    }
    const content = (await configResponse.json()) as GitHubContent;
    if (content.encoding !== "base64" || typeof content.content !== "string") {
      throw new Error(`invalid updater configuration response at ${release.tag_name}`);
    }
    const config = JSON.parse(Buffer.from(content.content.replace(/\s/g, ""), "base64").toString());
    const pubkey = config?.plugins?.updater?.pubkey;
    if (typeof pubkey !== "string" || pubkey.length === 0) {
      throw new Error(`missing updater public key at ${release.tag_name}`);
    }
    candidates.push({ ...shapeOnly, pubkey });
  }
  return candidates;
}

function readArg(name: string): string {
  const index = Bun.argv.indexOf(name);
  const value = index >= 0 ? Bun.argv[index + 1] : undefined;
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

if (import.meta.main) {
  try {
    const repository = readArg("--repository");
    const version = readArg("--version");
    const currentPubkey = readArg("--pubkey");
    const token = process.env.GITHUB_TOKEN;
    if (!token) throw new Error("GITHUB_TOKEN is required");
    const releases = await loadUpdaterReleaseCandidates(repository, token);
    const result = selectUpdaterBaseline({
      version,
      currentPubkey,
      releases,
    });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

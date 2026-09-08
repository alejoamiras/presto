import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseNpmPackResult } from "./npm-pack-result";
import { NPM_PACKAGES, type NpmPackage } from "./npm-packages";
import { SDK_PACKAGE, SDK_VERSION_PATTERN } from "./sdk-release-verification";
import { assertCorePin, CORE_NAME, expectedCoreVersion } from "./tarball-consumer/assert-core-pin";
import { verifySdkPackageSignatures } from "./verify-sdk-package-signatures";

interface PublishedManifest {
  name: string;
  version: string;
  dependencies: Record<string, string>;
}

/**
 * A published package must be the requested candidate and carry the playground's exact dependency
 * graph. A `workspace:` range in the workspace manifest resolves to that sibling's current version,
 * which the published pin must equal.
 */
export function assertPublishedManifest(
  manifest: PublishedManifest,
  name: string,
  version: string,
  workspaceDependencies: Record<string, string>,
  workspaceVersions: Record<string, string> = {},
) {
  if (manifest.name !== name || manifest.version !== version) {
    throw new Error(`Published ${name} identity does not match the requested candidate`);
  }
  for (const [dep, pin] of Object.entries(manifest.dependencies)) {
    const range = workspaceDependencies[dep];
    const expected = range?.startsWith("workspace:") ? workspaceVersions[dep] : range;
    if (expected !== pin) {
      throw new Error(
        `Published ${name} dependency ${dep}@${pin} does not match the playground graph`,
      );
    }
  }
}

export function assertPublishedSdkManifest(
  manifest: PublishedManifest,
  version: string,
  workspaceDependencies: Record<string, string>,
  workspaceVersions: Record<string, string> = {},
) {
  assertPublishedManifest(manifest, SDK_PACKAGE, version, workspaceDependencies, workspaceVersions);
}

/**
 * A published adapter's exact peer pin must be the peer version the playground graph actually
 * gives it: provenance proves the artifact's origin, not that it matches this installed peer.
 */
export function assertPeerPin(
  manifest: { name: string; peerDependencies?: Record<string, string> },
  peer: string,
  installedVersion: string,
) {
  const pin = manifest.peerDependencies?.[peer];
  if (pin !== installedVersion) {
    throw new Error(
      `Published ${manifest.name} pins peer ${peer}@${pin ?? "(none)"} but the playground installs ${installedVersion}`,
    );
  }
}

/** npm's integrity form (`sha512-<base64>`) of a tarball's bytes. */
export function tarballIntegrity(bytes: ArrayBuffer | Uint8Array): string {
  const hasher = new Bun.CryptoHasher("sha512");
  hasher.update(bytes);
  return `sha512-${hasher.digest("base64")}`;
}

/**
 * The bytes deployed must be the bytes the signed provenance names: `npm pack` is a separate
 * registry conversation from the signature audit, and a registry can answer each differently.
 */
export function assertVerifiedTarball(
  bytes: ArrayBuffer | Uint8Array,
  signed: string,
  spec: string,
) {
  if (tarballIntegrity(bytes) !== signed) {
    throw new Error(`Downloaded ${spec} tarball does not match its signed provenance digest`);
  }
}

/** The directory `name` resolves to from `from`: the copy a bundler resolving there bundles. */
export function packageRoot(name: string, from: string): string {
  const entry = Bun.resolveSync(name, from);
  const marker = `/node_modules/${name}/`;
  const at = entry.lastIndexOf(marker);
  if (at < 0) throw new Error(`${name} does not resolve to a node_modules copy from ${from}`);
  return entry.slice(0, at + marker.length - 1);
}

/** Every adapter the playground runs must pin the one core it installs. */
export function sharedCorePin(manifests: PublishedManifest[]): string {
  const pins = new Set(manifests.map((m) => expectedCoreVersion(m.dependencies[CORE_NAME])));
  if (pins.size !== 1 || pins.has(undefined)) {
    throw new Error(
      `Published adapters pin different ${CORE_NAME} versions: ${[...pins].join(", ")}`,
    );
  }
  return [...pins][0] as string;
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "..");
  const directory = await mkdtemp(join(tmpdir(), "presto-published-playground-"));
  const run = (args: string[]) => {
    const result = Bun.spawnSync(args, { cwd: directory, stdout: "pipe", stderr: "pipe" });
    if (result.exitCode !== 0) throw new Error(result.stderr.toString());
    return result.stdout.toString().trim();
  };
  const readJson = (rel: string) => Bun.file(join(root, rel)).json();
  /** Signed provenance plus a tarball whose bytes carry the digest it names. */
  const fetchVerified = async (pkg: NpmPackage, version: string) => {
    const spec = `${pkg.name}@${version}`;
    const provenance = await verifySdkPackageSignatures(version, pkg);
    const packed = parseNpmPackResult(
      JSON.parse(run(["npm", "pack", "--ignore-scripts", "--json", spec])),
      pkg.name,
      version,
    );
    const tarball = join(directory, packed.filename);
    assertVerifiedTarball(await Bun.file(tarball).arrayBuffer(), provenance.integrity, spec);
    const manifest: PublishedManifest = JSON.parse(
      run(["tar", "-xzOf", tarball, "package/package.json"]),
    );
    return { tarball, manifest };
  };

  const version = process.argv[2] || run(["npm", "view", `${SDK_PACKAGE}@testnet`, "version"]);
  if (!SDK_VERSION_PATTERN.test(version)) throw new Error("Invalid published SDK candidate");
  const playground = await readJson("packages/playground/package.json");
  const workspaceVersions = {
    [CORE_NAME]: (await readJson("packages/sdk-core/package.json")).version,
  };
  const sdk = await fetchVerified(NPM_PACKAGES.presto, version);
  assertPublishedManifest(
    sdk.manifest,
    SDK_PACKAGE,
    version,
    (await readJson("packages/sdk/package.json")).dependencies,
    workspaceVersions,
  );
  const adapters = [sdk];
  // The Noir adapter, when the playground depends on it, at the workspace version of this commit.
  const noirPackage = NPM_PACKAGES["presto-noir"];
  if (playground.dependencies?.[noirPackage.name]) {
    const noirVersion = (await readJson(`${noirPackage.dir}/package.json`)).version;
    const noir = await fetchVerified(noirPackage, noirVersion);
    assertPublishedManifest(
      noir.manifest,
      noirPackage.name,
      noirVersion,
      (await readJson(`${noirPackage.dir}/package.json`)).dependencies,
      workspaceVersions,
    );
    adapters.push(noir);
  }
  // The playground must run every adapter on the exact published core they pin — never a rebuild.
  const corePin = sharedCorePin(adapters.map((a) => a.manifest));
  const core = await fetchVerified(NPM_PACKAGES["presto-core"], corePin);
  const swap = Bun.spawnSync(
    [
      "bash",
      ".github/scripts/packaged-e2e-swap-sdk.sh",
      sdk.tarball,
      core.tarball,
      ...(adapters[1] ? [adapters[1].tarball] : []),
    ],
    { cwd: root, stdout: "inherit", stderr: "inherit" },
  );
  if (swap.exitCode !== 0) throw new Error("Could not install the published SDK into playground");
  const installedDir = join(root, "packages/playground/node_modules/@alejoamiras/presto");
  const installed = await Bun.file(join(installedDir, "package.json")).json();
  assertPublishedSdkManifest(
    installed,
    version,
    (await readJson("packages/sdk/package.json")).dependencies,
    workspaceVersions,
  );
  const installedCore = await Bun.file(
    join(installedDir, "node_modules/@alejoamiras/presto-core/package.json"),
  ).json();
  assertCorePin(installed, installedCore);
  if (adapters[1]) {
    const noirDir = join(root, "packages/playground/node_modules/@alejoamiras/presto-noir");
    const installedNoir = await Bun.file(join(noirDir, "package.json")).json();
    // Vite dedupes `@aztec/bb.js` to the copy resolved from the playground root, whatever sits
    // beside the adapter; that copy is the peer the built bundle runs the adapter on.
    const bbJsDir = packageRoot("@aztec/bb.js", join(root, "packages/playground"));
    const bbJs = await Bun.file(join(bbJsDir, "package.json")).json();
    assertPeerPin(installedNoir, "@aztec/bb.js", bbJs.version);
    assertCorePin(installedNoir, installedCore);
  }
  console.log(
    `Playground uses verified published ${SDK_PACKAGE}@${version} on ${CORE_NAME}@${installedCore.version}` +
      (adapters[1] ? ` with ${noirPackage.name}@${adapters[1].manifest.version}` : ""),
  );
}

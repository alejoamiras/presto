import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseNpmPackResult } from "./npm-pack-result";
import { NPM_PACKAGES, type NpmPackage } from "./npm-packages";
import {
  fetchAndVerifySdkProvenance,
  SDK_PACKAGE,
  SDK_VERSION_PATTERN,
} from "./sdk-release-verification";
import { assertCorePin, CORE_NAME, expectedCoreVersion } from "./tarball-consumer/assert-core-pin";
import { verifySdkPackageSignatures } from "./verify-sdk-package-signatures";

/**
 * The published SDK must be the requested candidate and carry the playground's exact dependency
 * graph. A `workspace:` range in the workspace manifest resolves to that sibling's current version,
 * which the published pin must equal.
 */
export function assertPublishedSdkManifest(
  manifest: { name: string; version: string; dependencies: Record<string, string> },
  version: string,
  workspaceDependencies: Record<string, string>,
  workspaceVersions: Record<string, string> = {},
) {
  if (manifest.name !== SDK_PACKAGE || manifest.version !== version) {
    throw new Error("Published SDK identity does not match the requested candidate");
  }
  for (const [name, pin] of Object.entries(manifest.dependencies)) {
    const range = workspaceDependencies[name];
    const expected = range?.startsWith("workspace:") ? workspaceVersions[name] : range;
    if (expected !== pin) {
      throw new Error(
        `Published SDK dependency ${name}@${pin} does not match the playground graph`,
      );
    }
  }
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "..");
  const directory = await mkdtemp(join(tmpdir(), "presto-published-playground-"));
  const run = (args: string[]) => {
    const result = Bun.spawnSync(args, { cwd: directory, stdout: "pipe", stderr: "pipe" });
    if (result.exitCode !== 0) throw new Error(result.stderr.toString());
    return result.stdout.toString().trim();
  };
  /** Provenance, signatures, and an integrity-matched tarball of one published version. */
  const fetchVerified = async (pkg: NpmPackage, version: string): Promise<string> => {
    await fetchAndVerifySdkProvenance(version, undefined, undefined, pkg);
    await verifySdkPackageSignatures(version, pkg);
    const spec = `${pkg.name}@${version}`;
    const packed = parseNpmPackResult(
      JSON.parse(run(["npm", "pack", "--ignore-scripts", "--json", spec])),
      pkg.name,
      version,
    );
    if (packed.integrity !== run(["npm", "view", spec, "dist.integrity"])) {
      throw new Error(`Published tarball integrity mismatch for ${spec}`);
    }
    return join(directory, packed.filename);
  };

  const version = process.argv[2] || run(["npm", "view", `${SDK_PACKAGE}@testnet`, "version"]);
  if (!SDK_VERSION_PATTERN.test(version)) throw new Error("Invalid published SDK candidate");
  const tarball = await fetchVerified(NPM_PACKAGES.presto, version);
  const manifest = JSON.parse(run(["tar", "-xzOf", tarball, "package/package.json"]));
  const workspace = await Bun.file(join(root, "packages/sdk/package.json")).json();
  const core = await Bun.file(join(root, "packages/sdk-core/package.json")).json();
  const workspaceVersions = { [CORE_NAME]: core.version };
  assertPublishedSdkManifest(manifest, version, workspace.dependencies, workspaceVersions);
  // The playground must run the SDK on the exact published core it pins — never a local rebuild.
  const corePin = expectedCoreVersion(manifest.dependencies[CORE_NAME]);
  if (!corePin) throw new Error("Published SDK must pin an exact core version");
  const coreTarball = await fetchVerified(NPM_PACKAGES["presto-core"], corePin);
  const swap = Bun.spawnSync(
    ["bash", ".github/scripts/packaged-e2e-swap-sdk.sh", tarball, coreTarball],
    { cwd: root, stdout: "inherit", stderr: "inherit" },
  );
  if (swap.exitCode !== 0) throw new Error("Could not install the published SDK into playground");
  const installedDir = join(root, "packages/playground/node_modules/@alejoamiras/presto");
  const installed = await Bun.file(join(installedDir, "package.json")).json();
  assertPublishedSdkManifest(installed, version, workspace.dependencies, workspaceVersions);
  const installedCore = await Bun.file(
    join(installedDir, "node_modules/@alejoamiras/presto-core/package.json"),
  ).json();
  assertCorePin(installed, installedCore);
  console.log(
    `Playground uses verified published ${SDK_PACKAGE}@${version} on ${CORE_NAME}@${installedCore.version}`,
  );
}

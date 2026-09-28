/**
 * Check npm for the latest Aztec version at a given dist-tag and compare with current.
 *
 * Usage: bun scripts/check-aztec-update.ts <dist-tag>
 * Examples:
 *   bun scripts/check-aztec-update.ts nightly
 *   bun scripts/check-aztec-update.ts devnet
 * Output: JSON with { current, latest, needsUpdate }
 *
 * The package names come from the SDK manifest, so the check follows whichever Aztec scope it pins.
 */
import {
  type AztecDependency,
  listAztecDependencies,
  type PackageManifest,
  requireAztecDependency,
} from "./aztec-manifest.ts";

const SDK_SECTIONS = ["dependencies", "devDependencies"] as const;

const distTag = process.argv[2] ?? "";
if (!distTag) {
  console.error("Usage: bun scripts/check-aztec-update.ts <dist-tag>");
  console.error("Examples:");
  console.error("  bun scripts/check-aztec-update.ts nightly");
  console.error("  bun scripts/check-aztec-update.ts devnet");
  process.exit(1);
}

async function getLatestVersion(aztecJs: string, tag: string): Promise<string> {
  const proc = Bun.spawn(["npm", "view", aztecJs, "dist-tags", "--json"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`npm view failed: ${stderr}`);
  }
  const tags = JSON.parse(output);
  const version = tags[tag];
  if (!version) throw new Error(`No '${tag}' dist-tag found for ${aztecJs}`);
  return version;
}

async function verifyAllPackagesExist(
  packages: AztecDependency[],
  version: string,
): Promise<{ allExist: boolean; missing: string[] }> {
  const missing: string[] = [];

  await Promise.all(
    packages.map(async ({ name: pkg }) => {
      const proc = Bun.spawn(["npm", "view", `${pkg}@${version}`, "version", "--json"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        missing.push(pkg);
      }
    }),
  );

  return { allExist: missing.length === 0, missing };
}

async function main() {
  const sdk: PackageManifest = await Bun.file("packages/sdk/package.json").json();
  const { name: aztecJs, version: current } = requireAztecDependency(sdk, "aztec.js", SDK_SECTIONS);
  const latest = await getLatestVersion(aztecJs, distTag);

  if (current === latest) {
    console.log(JSON.stringify({ current, latest, needsUpdate: false }));
    return;
  }

  const { missing } = await verifyAllPackagesExist(
    listAztecDependencies(sdk, SDK_SECTIONS),
    latest,
  );

  if (missing.length > 0) {
    console.error(
      `Warning: Not all packages available at ${latest}. Missing: ${missing.join(", ")}`,
    );
  }

  console.log(
    JSON.stringify({ current, latest, needsUpdate: true, ...(missing.length > 0 && { missing }) }),
  );
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

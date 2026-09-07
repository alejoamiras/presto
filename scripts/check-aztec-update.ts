/**
 * Check npm for the latest Aztec version at a given dist-tag and compare with current.
 *
 * Usage: bun scripts/check-aztec-update.ts <dist-tag>
 * Examples:
 *   bun scripts/check-aztec-update.ts nightly
 *   bun scripts/check-aztec-update.ts devnet
 * Output: JSON with { current, latest, needsUpdate }
 * An ineligible latest release exits non-zero instead of suppressing the update.
 */

import { assertAztecReleaseEligible, readManagedAztecPackages } from "./aztec-release";

async function getCurrentVersion(): Promise<string> {
  const sdkPkg = await Bun.file("packages/sdk/package.json").json();
  const version = sdkPkg.devDependencies?.["@aztec/aztec.js"] ?? sdkPkg.dependencies?.["@aztec/aztec.js"];
  if (!version) throw new Error("Could not find @aztec/aztec.js in packages/sdk/package.json");
  return version;
}

async function getLatestVersion(tag: string): Promise<string> {
  const proc = Bun.spawn(["npm", "view", "@aztec/aztec.js", "dist-tags", "--json"], {
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
  if (!version) throw new Error(`No '${tag}' dist-tag found for @aztec/aztec.js`);
  return version;
}

async function main() {
  const distTag = process.argv[2] ?? "";
  if (!distTag) {
    throw new Error("Usage: bun scripts/check-aztec-update.ts <dist-tag>");
  }
  const current = await getCurrentVersion();
  const latest = await getLatestVersion(distTag);

  if (current === latest) {
    console.log(JSON.stringify({ current, latest, needsUpdate: false }));
    return;
  }

  await assertAztecReleaseEligible(latest, await readManagedAztecPackages());
  console.log(JSON.stringify({ current, latest, needsUpdate: true }));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

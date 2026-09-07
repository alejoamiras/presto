/**
 * Update all @aztec/* version references across the repo.
 *
 * Usage: bun scripts/update-aztec-version.ts <version>
 * Example: bun scripts/update-aztec-version.ts 5.0.0-nightly.20260220
 */

import {
  assertAztecReleaseEligible,
  AZTEC_PACKAGE_FILES,
  isAztecManagedDependency,
  readManagedAztecPackages,
} from "./aztec-release";

const VERSION_PATTERN = /^\d+\.\d+\.\d+(-(?:nightly\.\d{8}|rc\.\d+|aztecnr-rc\.\d+))?$/;
const AZTEC_VERSION_PATTERN = /^\d+\.\d+\.\d+(-(?:nightly|spartan|devnet|aztecnr-rc|rc)[\w.-]*)?$/;

export function isAztecManagedDep(key: string): boolean {
  return isAztecManagedDependency(key);
}

export function validateVersion(version: string): boolean {
  return VERSION_PATTERN.test(version);
}

export function updatePackageJson(content: string, newVersion: string): string {
  const pkg = JSON.parse(content);

  for (const section of ["dependencies", "devDependencies"] as const) {
    const deps = pkg[section];
    if (!deps) continue;
    for (const [key, value] of Object.entries(deps)) {
      if (isAztecManagedDep(key) && typeof value === "string" && AZTEC_VERSION_PATTERN.test(value)) {
        deps[key] = newVersion;
      }
    }
  }

  return `${JSON.stringify(pkg, null, 2)}\n`;
}

const CRS_FILE = "packages/playground/src/aztec.ts";

/** Bump CRS_CACHE_VERSION so returning playground visitors re-download the CRS if bb.js changed its format. */
async function updateCrsCacheVersion(version: string): Promise<boolean> {
  const original = await Bun.file(CRS_FILE).text();
  const updated = original.replace(/(const CRS_CACHE_VERSION\s*=\s*")[^"]*(")/, `$1${version}$2`);
  if (updated === original) return false;
  await Bun.write(CRS_FILE, updated);
  return true;
}

// F-008: the Windows bb.exe pin is NEVER auto-generated here. Auto-downloading the asset and writing its
// own hash is circular (a twice-downloaded asset is not independent evidence). A human adds a reviewed
// `manual-review` entry to WINDOWS_BB_CHECKSUMS (copy-bb.ts); the post-install `check-windows-bb-pin.ts`
// step reports whether the live bb.js version has a pin, and the Windows CI gate fails closed without one.

async function main() {
  const newVersion = process.argv[2];

  if (!newVersion) {
    console.error("Usage: bun scripts/update-aztec-version.ts <version>");
    console.error("Example: bun scripts/update-aztec-version.ts 5.0.0-nightly.20260220");
    process.exit(1);
  }

  if (!validateVersion(newVersion)) {
    console.error(
      `Invalid version format: "${newVersion}". Expected: X.Y.Z, X.Y.Z-nightly.YYYYMMDD, or X.Y.Z-rc.N`,
    );
    process.exit(1);
  }

  // Validate the complete lockstep set before the first write. Partial releases must never leave
  // package manifests or the CRS cache at mixed versions.
  await assertAztecReleaseEligible(newVersion, await readManagedAztecPackages());

  let updatedFiles = 0;

  for (const filePath of AZTEC_PACKAGE_FILES) {
    const file = Bun.file(filePath);
    const original = await file.text();
    const updated = updatePackageJson(original, newVersion);
    if (updated !== original) {
      await Bun.write(filePath, updated);
      console.log(`Updated ${filePath}`);
      updatedFiles++;
    }
  }

  // Update the generated CRS cache key required by every @aztec version change.
  const crsBumped = await updateCrsCacheVersion(newVersion);
  if (crsBumped) console.log(`Bumped CRS_CACHE_VERSION → ${newVersion} in ${CRS_FILE}.`);
  if (updatedFiles === 0 && !crsBumped) {
    console.log("\nAll files already at target version. No changes needed.");
  } else {
    console.log(`\nDone. Updated ${updatedFiles} package.json file(s) to ${newVersion}.`);
  }

  console.log("\nNext steps:");
  console.log("  1. bun install   (the requested version and every managed companion were age-checked first)");
  console.log(
    "  2. bun run --cwd packages/playground typecheck:scripts   (catch @aztec API breaks in the deploy/fund scripts)",
  );
  console.log(
    "  3. ⚠️  Aztec artifacts may have recompiled → the salt=0 SponsoredFPC address can MOVE. Derive + redeploy on testnet if so:",
  );
  console.log(
    "       bun run packages/playground/scripts/deploy-sponsored-fpc.ts --salt 0x0   (--salt 0x0 mandatory; the script defaults to random)",
  );
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

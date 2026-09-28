/**
 * Update every Aztec release package's version across the repo, under either scope generation.
 *
 * Usage: bun scripts/update-aztec-version.ts <version>
 * Example: bun scripts/update-aztec-version.ts 5.0.0-nightly.20260220
 */

import { isAztecPackage } from "./aztec-manifest.ts";

const VERSION_PATTERN = /^\d+\.\d+\.\d+(-(?:nightly\.\d{8}|rc\.\d+|aztecnr-rc\.\d+))?$/;
const AZTEC_VERSION_PATTERN = /^\d+\.\d+\.\d+(-(?:nightly|spartan|devnet|aztecnr-rc|rc)[\w.-]*)?$/;

// The Noir adapter's exact bb.js peer (and its dev copy) move with every Aztec bump; its
// `TESTED_BB_VERSIONS` constant is a separate, deliberate step — the adapter's tests fail loud
// until the new pairing is declared tested.
export const PACKAGE_JSON_FILES = [
  "packages/sdk/package.json",
  "packages/playground/package.json",
  "packages/sdk-noir/package.json",
];
const DEPENDENCY_SECTIONS = ["dependencies", "devDependencies", "peerDependencies"] as const;
// The Noir consumer host installs the adapter's peer itself; a flat `{ name: version }` file.
export const HOST_DEPENDENCY_FILES = [
  "scripts/tarball-consumer/presto-noir/host-dependencies.json",
];

export function validateVersion(version: string): boolean {
  return VERSION_PATTERN.test(version);
}

function bumpPins(deps: Record<string, unknown>, newVersion: string, skipPackages?: Set<string>) {
  for (const [key, value] of Object.entries(deps)) {
    if (isAztecPackage(key) && typeof value === "string" && AZTEC_VERSION_PATTERN.test(value)) {
      if (skipPackages?.has(key)) continue;
      deps[key] = newVersion;
    }
  }
}

export function updatePackageJson(
  content: string,
  newVersion: string,
  skipPackages?: Set<string>,
): string {
  const pkg = JSON.parse(content);
  for (const section of DEPENDENCY_SECTIONS) {
    if (pkg[section]) bumpPins(pkg[section], newVersion, skipPackages);
  }
  return `${JSON.stringify(pkg, null, 2)}\n`;
}

export function updateHostDependencies(
  content: string,
  newVersion: string,
  skipPackages?: Set<string>,
): string {
  const deps = JSON.parse(content);
  bumpPins(deps, newVersion, skipPackages);
  return `${JSON.stringify(deps, null, 2)}\n`;
}

async function findMissingPackages(version: string, packageFiles: string[]): Promise<Set<string>> {
  const allAztecPackages = new Set<string>();
  for (const filePath of packageFiles) {
    const pkg = await Bun.file(filePath).json();
    for (const section of DEPENDENCY_SECTIONS) {
      const deps = pkg[section];
      if (!deps) continue;
      for (const [key, value] of Object.entries(deps)) {
        if (isAztecPackage(key) && typeof value === "string" && AZTEC_VERSION_PATTERN.test(value)) {
          allAztecPackages.add(key);
        }
      }
    }
  }

  const missing = new Set<string>();
  await Promise.all(
    [...allAztecPackages].map(async (pkg) => {
      const proc = Bun.spawn(["npm", "view", `${pkg}@${version}`, "version", "--json"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const exitCode = await proc.exited;
      if (exitCode !== 0) missing.add(pkg);
    }),
  );

  return missing;
}

export const CRS_FILE = "packages/playground/src/aztec.ts";

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

  const skipPackages = await findMissingPackages(newVersion, PACKAGE_JSON_FILES);
  if (skipPackages.size > 0) {
    console.log(`Skipping unpublished packages: ${[...skipPackages].join(", ")}`);
  }

  let updatedFiles = 0;

  const targets = [
    ...PACKAGE_JSON_FILES.map((path) => [path, updatePackageJson] as const),
    ...HOST_DEPENDENCY_FILES.map((path) => [path, updateHostDependencies] as const),
  ];
  for (const [filePath, update] of targets) {
    const original = await Bun.file(filePath).text();
    const updated = update(original, newVersion, skipPackages);
    if (updated !== original) {
      await Bun.write(filePath, updated);
      console.log(`Updated ${filePath}`);
      updatedFiles++;
    }
  }

  // Companion bumps an @aztec version change also requires (lessons from the 5.0.0-rc.2 bump):
  const crsBumped = await updateCrsCacheVersion(newVersion);
  if (crsBumped) console.log(`Bumped CRS_CACHE_VERSION → ${newVersion} in ${CRS_FILE}.`);
  // The Windows bb.exe pin is intentionally NOT touched here (F-008) — see check-windows-bb-pin.ts.

  if (updatedFiles === 0 && !crsBumped) {
    console.log("\nAll files already at target version. No changes needed.");
  } else {
    console.log(`\nDone. Updated ${updatedFiles} package.json file(s) to ${newVersion}.`);
  }

  console.log("\nNext steps:");
  console.log(
    "  1. bun install   (a <7-day-old Aztec release is exempted via bunfig.toml's minimumReleaseAgeExcludes;",
  );
  console.log(
    "     if a NEW Aztec transitive trips the min-age gate, add that exact name to the excludes list —",
  );
  console.log(
    "     Aztec-scoped names only, prune departed ones; scripts/bunfig-aztec-excludes.test.ts enforces both",
  );
  console.log(
    "     directions. NEVER --minimum-release-age=0: that regen lifts the 7-day quarantine for every",
  );
  console.log(
    "     third-party package in the tree — the snappy class the quarantine exists for.)",
  );
  console.log(
    "  2. bun run --cwd packages/playground typecheck:scripts   (catch Aztec API breaks in the deploy/fund scripts)",
  );
  console.log(
    "     Review .github/actions/setup-aztec/installer-aztec-packages.txt against the new installer's graph;",
  );
  console.log(
    "     setup-aztec's graph check names every addition and removal (scripts/aztec-installer-graph.ts).",
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

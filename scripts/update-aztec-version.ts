/**
 * Update every Aztec release package's version across the repo, under either scope generation.
 *
 * Usage: bun scripts/update-aztec-version.ts <version>
 * Example: bun scripts/update-aztec-version.ts 5.0.0-nightly.20260220
 *
 * `<version>` is the `@aztec-labs/*` release. The `@aztec-foundation/*` names move to the version
 * that release's own packages pin, which since 6.0.0-rc.3 is a different number.
 */

import { isAztecPackage, listAztecDependencies, type PackageManifest } from "./aztec-manifest.ts";
import { isExactSemver } from "./npm-packages.ts";

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

/** A release shape the updater knows that npm also reads as a version, never as a dist-tag. */
export function validateVersion(version: string): boolean {
  return VERSION_PATTERN.test(version) && isExactSemver(version);
}

/** One Aztec release's two numbers: `@aztec-labs/*` (and `@aztec/*` through v5), and `@aztec-foundation/*`. */
export type AztecTargets = { labs: string; foundation: string };

export function targetFor(name: string, targets: AztecTargets): string {
  return name.startsWith("@aztec-foundation/") ? targets.foundation : targets.labs;
}

/** The registry reads the updater needs; tests substitute a fixed registry. */
export interface AztecRegistry {
  distTags(name: string): Promise<Record<string, string>>;
  /** `spec`'s direct dependencies, or `undefined` when npm has no such version. */
  dependencies(spec: string): Promise<Record<string, string> | undefined>;
}

async function npmView(args: string[]): Promise<string | undefined> {
  const proc = Bun.spawn(["npm", "view", ...args, "--json"], { stdout: "pipe", stderr: "pipe" });
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return code === 0 ? out : undefined;
}

export const npmRegistry: AztecRegistry = {
  async distTags(name) {
    const out = await npmView([name, "dist-tags"]);
    if (out === undefined) throw new Error(`npm view ${name} dist-tags failed`);
    return JSON.parse(out);
  },
  async dependencies(spec) {
    const out = await npmView([spec, "dependencies"]);
    if (out === undefined) return undefined;
    // npm prints nothing for a version with no dependencies.
    return out.trim() === "" ? {} : JSON.parse(out);
  },
};

/**
 * The one `@aztec-foundation/*` version a release's packages pin, from each package's direct
 * dependencies. Every foundation pin counts, not only the names this repo manages, so pins that
 * disagree anywhere are caught. No pin, two versions, or a range throws, naming each source.
 */
export function foundationVersionOf(pins: Map<string, Record<string, string>>): string {
  const sources = new Map<string, string[]>();
  for (const [pkg, deps] of pins) {
    for (const [name, spec] of Object.entries(deps)) {
      if (!name.startsWith("@aztec-foundation/")) continue;
      const source = `${pkg} → ${name}@${spec}`;
      if (!isExactSemver(spec)) throw new Error(`not an exact @aztec-foundation pin: ${source}`);
      sources.set(spec, [...(sources.get(spec) ?? []), source]);
    }
  }
  const [first, ...others] = sources.keys();
  if (first === undefined) {
    throw new Error(`no @aztec-foundation pin in ${[...pins.keys()].join(", ") || "any package"}`);
  }
  if (others.length > 0) {
    throw new Error(`@aztec-foundation pins disagree: ${[...sources.values()].flat().join("; ")}`);
  }
  return first;
}

const SDK_SECTIONS = ["dependencies", "devDependencies"] as const;

/** The targets of labs release `labs`, read from the pins of every labs package `sdk` names. */
export async function resolveTargets(
  labs: string,
  sdk: PackageManifest,
  registry: AztecRegistry = npmRegistry,
): Promise<AztecTargets> {
  const names = listAztecDependencies(sdk, SDK_SECTIONS)
    .map(({ name }) => name)
    .filter((name) => !name.startsWith("@aztec-foundation/"));
  const deps = await Promise.all(names.map((name) => registry.dependencies(`${name}@${labs}`)));
  const pins = new Map<string, Record<string, string>>();
  names.forEach((name, i) => {
    const found = deps[i];
    if (found) pins.set(`${name}@${labs}`, found);
  });
  return { labs, foundation: foundationVersionOf(pins) };
}

/** The `names` npm does not publish at their own target. */
export async function missingPackages(
  names: Iterable<string>,
  targets: AztecTargets,
  registry: AztecRegistry = npmRegistry,
): Promise<string[]> {
  const unique = [...new Set(names)].sort();
  const found = await Promise.all(
    unique.map((name) => registry.dependencies(`${name}@${targetFor(name, targets)}`)),
  );
  return unique.filter((_, i) => found[i] === undefined);
}

function bumpPins(
  deps: Record<string, unknown>,
  targets: AztecTargets,
  skipPackages?: Set<string>,
) {
  for (const [key, value] of Object.entries(deps)) {
    if (isAztecPackage(key) && typeof value === "string" && AZTEC_VERSION_PATTERN.test(value)) {
      if (skipPackages?.has(key)) continue;
      deps[key] = targetFor(key, targets);
    }
  }
}

export function updatePackageJson(
  content: string,
  targets: AztecTargets,
  skipPackages?: Set<string>,
): string {
  const pkg = JSON.parse(content);
  for (const section of DEPENDENCY_SECTIONS) {
    if (pkg[section]) bumpPins(pkg[section], targets, skipPackages);
  }
  return `${JSON.stringify(pkg, null, 2)}\n`;
}

export function updateHostDependencies(
  content: string,
  targets: AztecTargets,
  skipPackages?: Set<string>,
): string {
  const deps = JSON.parse(content);
  bumpPins(deps, targets, skipPackages);
  return `${JSON.stringify(deps, null, 2)}\n`;
}

/** Every Aztec release package the manifests in `packageFiles` pin at a release version. */
async function managedPackages(packageFiles: string[]): Promise<Set<string>> {
  const names = new Set<string>();
  for (const filePath of packageFiles) {
    const pkg = await Bun.file(filePath).json();
    for (const section of DEPENDENCY_SECTIONS) {
      for (const [key, value] of Object.entries(pkg[section] ?? {})) {
        if (isAztecPackage(key) && typeof value === "string" && AZTEC_VERSION_PATTERN.test(value)) {
          names.add(key);
        }
      }
    }
  }
  return names;
}

export const CRS_FILE = "packages/playground/src/aztec.ts";

/** Bump CRS_CACHE_VERSION (a bb.js version) so returning playground visitors re-download the CRS if bb.js changed its format. */
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

  const sdk: PackageManifest = await Bun.file("packages/sdk/package.json").json();
  const targets = await resolveTargets(newVersion, sdk);
  console.log(`Targets: @aztec-labs/* ${targets.labs}, @aztec-foundation/* ${targets.foundation}`);
  const skipPackages = new Set(
    await missingPackages(await managedPackages(PACKAGE_JSON_FILES), targets),
  );
  if (skipPackages.size > 0) {
    console.log(`Skipping unpublished packages: ${[...skipPackages].join(", ")}`);
  }

  let updatedFiles = 0;

  const files = [
    ...PACKAGE_JSON_FILES.map((path) => [path, updatePackageJson] as const),
    ...HOST_DEPENDENCY_FILES.map((path) => [path, updateHostDependencies] as const),
  ];
  for (const [filePath, update] of files) {
    const original = await Bun.file(filePath).text();
    const updated = update(original, targets, skipPackages);
    if (updated !== original) {
      await Bun.write(filePath, updated);
      console.log(`Updated ${filePath}`);
      updatedFiles++;
    }
  }

  // Companion bumps an @aztec version change also requires (lessons from the 5.0.0-rc.2 bump):
  const crsBumped = await updateCrsCacheVersion(targets.foundation);
  if (crsBumped) console.log(`Bumped CRS_CACHE_VERSION → ${targets.foundation} in ${CRS_FILE}.`);
  // The Windows bb.exe pin is intentionally NOT touched here (F-008) — see check-windows-bb-pin.ts.

  if (updatedFiles === 0 && !crsBumped) {
    console.log("\nAll files already at target version. No changes needed.");
  } else {
    console.log(
      `\nDone. Updated ${updatedFiles} file(s) to ${targets.labs} (foundation ${targets.foundation}).`,
    );
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
    "  3. ⚠️  Aztec artifacts may have recompiled → the salt=0 SponsoredFPC address can MOVE. Check it on testnet:",
  );
  console.log(
    "       AZTEC_NODE_URL=... bun packages/playground/scripts/fpc-state.ts --salt 0x0   (funding: deploy-sponsored-fpc.ts --preflight first)",
  );
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

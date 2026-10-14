/**
 * Check npm for the latest Aztec version at a given dist-tag and compare with current.
 *
 * Usage: bun scripts/check-aztec-update.ts <dist-tag>
 * Examples:
 *   bun scripts/check-aztec-update.ts nightly
 *   bun scripts/check-aztec-update.ts devnet
 * Output: JSON with { current, latest, needsUpdate, foundation?, missing? }
 *
 * The package names come from the SDK manifest, so the check follows whichever Aztec scope it pins.
 * Each name is looked up at its own target: `@aztec-foundation/*` at the version the release pins.
 */
import {
  listAztecDependencies,
  type PackageManifest,
  requireAztecDependency,
} from "./aztec-manifest.ts";
import {
  type AztecRegistry,
  missingPackages,
  npmRegistry,
  resolveTargets,
} from "./update-aztec-version.ts";

const SDK_SECTIONS = ["dependencies", "devDependencies"] as const;

export type UpdateCheck = {
  current: string;
  latest: string;
  needsUpdate: boolean;
  foundation?: string;
  missing?: string[];
};

export async function checkAztecUpdate(
  sdk: PackageManifest,
  distTag: string,
  registry: AztecRegistry = npmRegistry,
): Promise<UpdateCheck> {
  const { name: aztecJs, version: current } = requireAztecDependency(sdk, "aztec.js", SDK_SECTIONS);
  const latest = (await registry.distTags(aztecJs))[distTag];
  if (!latest) throw new Error(`No '${distTag}' dist-tag found for ${aztecJs}`);
  if (current === latest) return { current, latest, needsUpdate: false };

  const targets = await resolveTargets(latest, sdk, registry);
  const names = listAztecDependencies(sdk, SDK_SECTIONS).map(({ name }) => name);
  const missing = await missingPackages(names, targets, registry);
  return {
    current,
    latest,
    needsUpdate: true,
    foundation: targets.foundation,
    ...(missing.length > 0 && { missing }),
  };
}

if (import.meta.main) {
  const distTag = process.argv[2] ?? "";
  if (!distTag) {
    console.error("Usage: bun scripts/check-aztec-update.ts <dist-tag>");
    console.error("Examples:");
    console.error("  bun scripts/check-aztec-update.ts nightly");
    console.error("  bun scripts/check-aztec-update.ts devnet");
    process.exit(1);
  }
  try {
    const sdk: PackageManifest = await Bun.file("packages/sdk/package.json").json();
    const result = await checkAztecUpdate(sdk, distTag);
    if (result.missing) {
      console.error(
        `Warning: Not all packages available at their ${result.latest} targets. Missing: ${result.missing.join(", ")}`,
      );
    }
    console.log(JSON.stringify(result));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

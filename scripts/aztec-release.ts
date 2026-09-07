import {
  verifyNpmDependency,
  type FetchLike,
  type ResolvedDependency,
} from "./dependency-age";

export const AZTEC_PACKAGE_FILES = [
  "packages/sdk/package.json",
  "packages/playground/package.json",
];

// This package imports generated @aztec code without declaring it, so mixed versions fail at runtime.
const LOCKSTEP_PACKAGES = new Set(["@aztec-foundation/aztec-standards"]);

export function isAztecManagedDependency(name: string): boolean {
  return name.startsWith("@aztec/") || LOCKSTEP_PACKAGES.has(name);
}

export function managedAztecPackages(manifests: string[]): string[] {
  const packages = new Set<string>();
  for (const content of manifests) {
    const manifest = JSON.parse(content) as {
      dependencies?: Record<string, unknown>;
      devDependencies?: Record<string, unknown>;
    };
    for (const dependencies of [manifest.dependencies, manifest.devDependencies]) {
      for (const name of Object.keys(dependencies ?? {})) {
        if (isAztecManagedDependency(name)) packages.add(name);
      }
    }
  }
  return [...packages].sort();
}

export async function readManagedAztecPackages(
  packageFiles = AZTEC_PACKAGE_FILES,
): Promise<string[]> {
  return managedAztecPackages(
    await Promise.all(packageFiles.map((path) => Bun.file(path).text())),
  );
}

export async function assertAztecReleaseEligible(
  version: string,
  packages: string[],
  now = new Date(),
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  if (packages.length === 0) throw new Error("No managed Aztec packages were found");

  const dependencies: ResolvedDependency[] = packages.map((name) => ({
    ecosystem: "npm",
    name,
    version,
    source: "registry:npm",
  }));
  const results = await Promise.allSettled(
    dependencies.map((dependency) => verifyNpmDependency(dependency, now, fetchImpl)),
  );
  const failures = results.flatMap((result) =>
    result.status === "rejected"
      ? [result.reason instanceof Error ? result.reason.message : String(result.reason)]
      : [],
  );
  if (failures.length > 0) {
    throw new Error(
      `Aztec ${version} is incomplete or ineligible:\n${failures.map((failure) => `- ${failure}`).join("\n")}`,
    );
  }
}

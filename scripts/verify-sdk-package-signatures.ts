import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isValidVersion, NPM_PACKAGES, type NpmPackage, packageFromArgs } from "./npm-packages.ts";

interface SignatureAudit {
  verified?: Array<{
    name?: string;
    version?: string;
    attestations?: { provenance?: { predicateType?: string } };
  }>;
}

function run(command: string[], cwd: string): string {
  const result = Bun.spawnSync(command, { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    throw new Error(
      `${command.join(" ")} failed (${result.exitCode}): ${result.stderr.toString().trim()}`,
    );
  }
  return result.stdout.toString();
}

export function hasVerifiedSdkProvenance(
  report: SignatureAudit,
  version: string,
  pkg: NpmPackage = NPM_PACKAGES.presto,
): boolean {
  return Boolean(
    report.verified?.some(
      (item) =>
        item.name === pkg.name &&
        item.version === version &&
        item.attestations?.provenance?.predicateType === "https://slsa.dev/provenance/v1",
    ),
  );
}

export async function verifySdkPackageSignatures(
  version: string,
  pkg: NpmPackage = NPM_PACKAGES.presto,
): Promise<void> {
  if (!isValidVersion(pkg, version)) throw new Error(`invalid ${pkg.name} version ${version}`);
  const directory = await mkdtemp(join(tmpdir(), "presto-sdk-signature-audit-"));
  try {
    await Bun.write(
      join(directory, "package.json"),
      `${JSON.stringify({ private: true, dependencies: { [pkg.name]: version } }, null, 2)}\n`,
    );
    run(
      ["npm", "install", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error"],
      directory,
    );
    const installed = run(
      ["node", "-p", `require('./node_modules/${pkg.name}/package.json').version`],
      directory,
    ).trim();
    if (installed !== version) throw new Error(`installed ${installed}, expected ${version}`);
    const report = JSON.parse(
      run(["npm", "audit", "signatures", "--json", "--include-attestations"], directory),
    ) as SignatureAudit;
    if (!hasVerifiedSdkProvenance(report, version, pkg)) {
      throw new Error(`npm did not cryptographically verify provenance for ${pkg.name}@${version}`);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const { pkg, rest } = packageFromArgs(process.argv.slice(2));
  const version = rest[0];
  if (!version) {
    console.error(
      "usage: bun scripts/verify-sdk-package-signatures.ts [--package <key>] <version>",
    );
    process.exit(1);
  }
  await verifySdkPackageSignatures(version, pkg);
  console.log(`verified registry signatures and SLSA provenance for ${pkg.name}@${version}`);
}

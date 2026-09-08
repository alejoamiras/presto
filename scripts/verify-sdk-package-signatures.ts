import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isValidVersion, NPM_PACKAGES, type NpmPackage, packageFromArgs } from "./npm-packages.ts";
import {
  type ProvenanceStatement,
  type VerifiedProvenance,
  verifyProvenanceStatement,
} from "./sdk-release-verification.ts";

const PROVENANCE_PREDICATE = "https://slsa.dev/provenance/v1";

interface SignatureAudit {
  verified?: Array<{
    name?: string;
    version?: string;
    attestations?: { provenance?: { predicateType?: string } };
    attestationBundles?: Array<{
      predicateType?: string;
      bundle?: { dsseEnvelope?: { payload?: string } };
    }>;
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
        item.attestations?.provenance?.predicateType === PROVENANCE_PREDICATE,
    ),
  );
}

/**
 * The provenance statement npm verified: `npm audit signatures --include-attestations` lists a
 * package only after sigstore accepted its bundles and their subject digest matched the manifest
 * npm fetched, so this statement — unlike the registry's attestation endpoint or a lockfile — is
 * the one whose digest may vouch for bytes.
 */
export function verifiedProvenanceStatement(
  report: SignatureAudit,
  version: string,
  pkg: NpmPackage = NPM_PACKAGES.presto,
): ProvenanceStatement {
  const entry = report.verified?.find((item) => item.name === pkg.name && item.version === version);
  if (entry?.attestations?.provenance?.predicateType !== PROVENANCE_PREDICATE) {
    throw new Error(`npm did not cryptographically verify provenance for ${pkg.name}@${version}`);
  }
  const payload = entry.attestationBundles?.find(
    (bundle) => bundle.predicateType === PROVENANCE_PREDICATE,
  )?.bundle?.dsseEnvelope?.payload;
  if (!payload) {
    throw new Error(`npm reported no verified provenance bundle for ${pkg.name}@${version}`);
  }
  return JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
}

/** Registry signatures and provenance verified by npm; the returned digest is the signed one. */
export async function verifySdkPackageSignatures(
  version: string,
  pkg: NpmPackage = NPM_PACKAGES.presto,
  expectedCommit?: string,
  allowedWorkflows?: readonly string[],
): Promise<VerifiedProvenance> {
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
    return verifyProvenanceStatement(
      verifiedProvenanceStatement(report, version, pkg),
      version,
      expectedCommit,
      allowedWorkflows,
      undefined,
      pkg,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const { pkg, rest } = packageFromArgs(process.argv.slice(2));
  const version = rest[0];
  const expectedCommit = rest[1];
  if (!version) {
    console.error(
      "usage: bun scripts/verify-sdk-package-signatures.ts [--package <key>] <version> [expected-commit]",
    );
    process.exit(1);
  }
  const verified = await verifySdkPackageSignatures(version, pkg, expectedCommit);
  console.log(
    `verified registry signatures and SLSA provenance for ${pkg.name}@${version} (${verified.commit}, ${verified.integrity})`,
  );
}

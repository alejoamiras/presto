// Imports only repository modules and runtime built-ins: `_publish-npm.yml` runs this beside its
// OIDC identity with no dependency install. Identity-bound verification lives in
// verify-sdk-package-signatures.ts.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./npm-command.ts";
import { isValidVersion, NPM_PACKAGES, type NpmPackage, packageFromArgs } from "./npm-packages.ts";
import {
  type ProvenanceStatement,
  type VerifiedProvenance,
  verifyProvenanceStatement,
} from "./sdk-release-verification.ts";

const PROVENANCE_PREDICATE = "https://slsa.dev/provenance/v1";

/** A serialized Sigstore bundle, as npm reports it. */
export type AuditedBundle = { dsseEnvelope?: { payload?: string } } & Record<string, unknown>;

export interface SignatureAudit {
  verified?: Array<{
    name?: string;
    version?: string;
    attestations?: { provenance?: { predicateType?: string } };
    attestationBundles?: Array<{ predicateType?: string; bundle?: AuditedBundle }>;
  }>;
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

/** The SLSA provenance bundle npm verified for exactly `pkg@version`, as npm serialized it. */
export function verifiedProvenanceBundle(
  report: SignatureAudit,
  version: string,
  pkg: NpmPackage = NPM_PACKAGES.presto,
): AuditedBundle {
  const entry = report.verified?.find((item) => item.name === pkg.name && item.version === version);
  if (entry?.attestations?.provenance?.predicateType !== PROVENANCE_PREDICATE) {
    throw new Error(`npm did not cryptographically verify provenance for ${pkg.name}@${version}`);
  }
  const bundle = entry.attestationBundles?.find(
    (candidate) => candidate.predicateType === PROVENANCE_PREDICATE,
  )?.bundle;
  if (!bundle?.dsseEnvelope?.payload) {
    throw new Error(`npm reported no verified provenance bundle for ${pkg.name}@${version}`);
  }
  return bundle;
}

/**
 * The provenance statement npm verified: `npm audit signatures --include-attestations` lists a
 * package only after sigstore accepted its bundles and their subject digest matched the manifest
 * npm fetched. These claims are registry consistency, not a signing identity:
 * verify-sdk-package-signatures.ts binds them to the release identity.
 */
export function verifiedProvenanceStatement(
  report: SignatureAudit,
  version: string,
  pkg: NpmPackage = NPM_PACKAGES.presto,
): ProvenanceStatement {
  const payload = verifiedProvenanceBundle(report, version, pkg).dsseEnvelope?.payload ?? "";
  return JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
}

/** `npm audit signatures` for a fresh, script-free install of exactly `pkg@version`. */
export async function auditSignatures(
  version: string,
  pkg: NpmPackage = NPM_PACKAGES.presto,
): Promise<SignatureAudit> {
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
    const installed = (
      (await Bun.file(join(directory, "node_modules", pkg.name, "package.json")).json()) as {
        version?: string;
      }
    ).version;
    if (installed !== version) throw new Error(`installed ${installed}, expected ${version}`);
    return JSON.parse(
      run(["npm", "audit", "signatures", "--json", "--include-attestations"], directory),
    ) as SignatureAudit;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Registry signatures and the provenance claims npm verified, without the signer identity. */
export async function verifyRegistryConsistency(
  version: string,
  pkg: NpmPackage = NPM_PACKAGES.presto,
  expectedCommit?: string,
  allowedWorkflows?: readonly string[],
): Promise<VerifiedProvenance> {
  const report = await auditSignatures(version, pkg);
  return verifyProvenanceStatement(
    verifiedProvenanceStatement(report, version, pkg),
    version,
    expectedCommit,
    allowedWorkflows,
    undefined,
    pkg,
  );
}

if (import.meta.main) {
  const { pkg, rest } = packageFromArgs(process.argv.slice(2));
  const version = rest[0];
  const expectedCommit = rest[1];
  if (!version) {
    console.error(
      "usage: bun scripts/registry-consistency.ts [--package <key>] <version> [expected-commit]",
    );
    process.exit(1);
  }
  const verified = await verifyRegistryConsistency(version, pkg, expectedCommit);
  console.log(
    `registry signatures and SLSA provenance claims consistent for ${pkg.name}@${version} (${verified.commit}, ${verified.integrity})`,
  );
}

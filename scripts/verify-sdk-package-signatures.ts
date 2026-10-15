import type { TrustMaterial } from "@sigstore/verify";
import { NPM_PACKAGES, type NpmPackage, packageFromArgs } from "./npm-packages.ts";
import {
  bindToSigningIdentity,
  RELEASE_SIGNERS,
  verifySigningIdentity,
} from "./provenance-identity.ts";
import {
  auditSignatures,
  type SignatureAudit,
  verifiedProvenanceBundle,
} from "./registry-consistency.ts";
import { type VerifiedProvenance, verifyProvenanceStatement } from "./sdk-release-verification.ts";

export interface SignedProvenanceOptions {
  expectedCommit?: string;
  allowedWorkflows?: readonly string[];
  signers?: readonly string[];
  /** Tests inject trust material; production fetches Sigstore's public-good root through TUF. */
  trust?: TrustMaterial;
}

/**
 * The provenance npm verified for `pkg@version`, bound to the release signing identity: the bundle's
 * certificate must match the identity policy before the statement inside it is trusted, and the
 * statement's claims must then name what the certificate does.
 */
export async function verifySignedReport(
  report: SignatureAudit,
  version: string,
  pkg: NpmPackage = NPM_PACKAGES.presto,
  options: SignedProvenanceOptions = {},
): Promise<VerifiedProvenance> {
  const { statement, identity } = await verifySigningIdentity(
    verifiedProvenanceBundle(report, version, pkg),
    { commit: options.expectedCommit, signers: options.signers ?? RELEASE_SIGNERS },
    options.trust,
  );
  return bindToSigningIdentity(
    verifyProvenanceStatement(
      statement,
      version,
      options.expectedCommit,
      options.allowedWorkflows,
      undefined,
      pkg,
    ),
    identity,
  );
}

/** Registry signatures and identity-bound provenance; the returned digest is the signed one. */
export async function verifySdkPackageSignatures(
  version: string,
  pkg: NpmPackage = NPM_PACKAGES.presto,
  expectedCommit?: string,
  allowedWorkflows?: readonly string[],
  signers: readonly string[] = RELEASE_SIGNERS,
): Promise<VerifiedProvenance> {
  return verifySignedReport(await auditSignatures(version, pkg), version, pkg, {
    expectedCommit,
    allowedWorkflows,
    signers,
  });
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
    `verified registry signatures, SLSA provenance and signing identity for ${pkg.name}@${version} (${verified.commit}, ${verified.integrity})`,
  );
}

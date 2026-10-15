import { type Bundle, bundleFromJSON, type SerializedBundle } from "@sigstore/bundle";
import { getTrustedRoot } from "@sigstore/tuf";
import {
  PolicyError,
  type TrustMaterial,
  toSignedEntity,
  toTrustMaterial,
  type VerificationPolicy,
  Verifier,
} from "@sigstore/verify";
import {
  type ProvenanceStatement,
  SDK_RELEASE_WORKFLOW,
  SDK_REPOSITORY,
  SDK_SOURCE_DEPENDENCY,
  type VerifiedProvenance,
} from "./sdk-release-verification.ts";

/** The reusable workflow that signs every current publication. */
export const RELEASE_SIGNERS: readonly string[] = [".github/workflows/_publish-npm.yml"];
/** Rollback may target presto 5.2.0, signed while the reusable workflow had its earlier name. */
export const ROLLBACK_SIGNERS: readonly string[] = [
  ...RELEASE_SIGNERS,
  ".github/workflows/_publish-sdk.yml",
];

/** The signing identity every accepted certificate carries, besides its signer and commit. */
export const RELEASE_IDENTITY = {
  issuer: "https://token.actions.githubusercontent.com",
  repository: SDK_REPOSITORY,
  // GitHub's immutable IDs: a deleted and recreated repository at the same URI does not match.
  repositoryId: "1357428613",
  ownerId: "2982991",
  ref: "refs/heads/main",
  buildConfig: SDK_RELEASE_WORKFLOW,
  runner: "github-hosted",
} as const;

export type ReleaseIdentity = { -readonly [K in keyof typeof RELEASE_IDENTITY]: string };

export interface SigningIdentity extends ReleaseIdentity {
  signer: string;
  commit: string;
}

// Fulcio certificate extensions, https://github.com/sigstore/fulcio/blob/main/docs/oid-info.md
const FULCIO = "1.3.6.1.4.1.57264.1";
const OID = {
  buildSignerURI: `${FULCIO}.9`,
  runnerEnvironment: `${FULCIO}.11`,
  sourceRepositoryURI: `${FULCIO}.12`,
  sourceRepositoryDigest: `${FULCIO}.13`,
  sourceRepositoryRef: `${FULCIO}.14`,
  sourceRepositoryIdentifier: `${FULCIO}.15`,
  sourceRepositoryOwnerIdentifier: `${FULCIO}.17`,
  buildConfigURI: `${FULCIO}.18`,
  buildConfigDigest: `${FULCIO}.19`,
} as const;

const IN_TOTO_PAYLOAD = "application/vnd.in-toto+json";

/**
 * The extension value as @sigstore/verify compares it: the raw DER `UTF8String`. Only the short
 * length form is produced, so a value of 128 bytes or more is refused rather than mis-encoded.
 */
function derUtf8String(value: string): Buffer {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length > 127) throw new Error(`certificate identity value too long: ${value}`);
  return Buffer.concat([Buffer.from([0x0c, bytes.length]), bytes]);
}

const workflowURI = (identity: ReleaseIdentity, path: string) =>
  `${identity.repository}/${path}@${identity.ref}`;

/** The policy for one signer: the SAN anchored and escaped, every other field exact. */
export function signingPolicy(identity: SigningIdentity): VerificationPolicy {
  const signerURI = workflowURI(identity, identity.signer);
  const oids: Array<[string, string]> = [
    [OID.buildSignerURI, signerURI],
    [OID.runnerEnvironment, identity.runner],
    [OID.sourceRepositoryURI, identity.repository],
    [OID.sourceRepositoryDigest, identity.commit],
    [OID.sourceRepositoryRef, identity.ref],
    [OID.sourceRepositoryIdentifier, identity.repositoryId],
    [OID.sourceRepositoryOwnerIdentifier, identity.ownerId],
    [OID.buildConfigURI, workflowURI(identity, identity.buildConfig)],
    [OID.buildConfigDigest, identity.commit],
  ];
  return {
    // @sigstore/verify matches the SAN with String.prototype.match, so a string would be an
    // unanchored pattern.
    subjectAlternativeName: new RegExp(`^${RegExp.escape(signerURI)}$`),
    extensions: { issuer: identity.issuer },
    oids: oids.map(([oid, value]) => ({
      oid: { id: oid.split(".").map(Number) },
      value: derUtf8String(value),
    })),
  };
}

/** The commit the certificate must carry: the expected one, else the one the statement claims. */
function requiredCommit(statement: ProvenanceStatement, expected?: string): string {
  const commit =
    expected ??
    statement.predicate?.buildDefinition?.resolvedDependencies?.find(
      (dependency) => dependency.uri === SDK_SOURCE_DEPENDENCY,
    )?.digest?.gitCommit;
  if (!commit || !/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error(`provenance has no usable commit: ${commit ?? "missing"}`);
  }
  return commit;
}

function envelopeStatement(bundle: Bundle): ProvenanceStatement {
  if (bundle.content.$case !== "dsseEnvelope") throw new Error("provenance bundle is not DSSE");
  const envelope = bundle.content.dsseEnvelope;
  if (envelope.payloadType !== IN_TOTO_PAYLOAD) {
    throw new Error(`unexpected provenance payload type: ${envelope.payloadType}`);
  }
  return JSON.parse(envelope.payload.toString("utf8"));
}

export interface IdentityExpectation {
  /** Defaults to the commit the statement claims, which the certificate must then carry. */
  commit?: string;
  signers?: readonly string[];
  identity?: ReleaseIdentity;
}

let publicGoodTrust: Promise<TrustMaterial> | undefined;
const defaultTrust = () => {
  publicGoodTrust ??= getTrustedRoot().then((root) => toTrustMaterial(root));
  return publicGoodTrust;
};

/**
 * Verifies a Sigstore bundle (signature, certificate chain, SCT, transparency log) and binds its
 * certificate to the release identity before the statement inside it is trusted. The statement is
 * decoded from the verified envelope's own payload bytes; the claimed commit is read from those
 * bytes beforehand only to choose the commit the certificate must carry.
 *
 * @throws PolicyError when no accepted signer's identity matches the certificate.
 */
export async function verifySigningIdentity(
  serialized: unknown,
  expectation: IdentityExpectation = {},
  trust?: TrustMaterial,
): Promise<{ statement: ProvenanceStatement; identity: SigningIdentity }> {
  const bundle = bundleFromJSON(serialized as SerializedBundle);
  const statement = envelopeStatement(bundle);
  const commit = requiredCommit(statement, expectation.commit);
  const verifier = new Verifier(trust ?? (await defaultTrust()), {
    tlogThreshold: 1,
    ctlogThreshold: 1,
    timestampThreshold: 1,
  });
  const entity = toSignedEntity(bundle);
  const base = expectation.identity ?? RELEASE_IDENTITY;
  let mismatch: PolicyError | undefined;
  for (const signer of expectation.signers ?? RELEASE_SIGNERS) {
    const identity: SigningIdentity = { ...base, signer, commit };
    try {
      verifier.verify(entity, signingPolicy(identity));
      return { statement, identity };
    } catch (error) {
      // Only an identity mismatch may fall through to the next signer.
      if (!(error instanceof PolicyError)) throw error;
      mismatch = error;
    }
  }
  throw mismatch ?? new PolicyError({ code: "UNTRUSTED_SIGNER_ERROR", message: "no signer" });
}

/** The statement's claims, already checked, must name what its certificate does. */
export function bindToSigningIdentity(
  provenance: VerifiedProvenance,
  identity: SigningIdentity,
): VerifiedProvenance {
  const claims = [
    ["repository", provenance.repository, identity.repository],
    ["workflow", provenance.workflow, identity.buildConfig],
    ["ref", provenance.ref, identity.ref],
    ["commit", provenance.commit, identity.commit],
  ] as const;
  for (const [name, claimed, certified] of claims) {
    if (claimed !== certified) {
      throw new Error(`provenance ${name} ${claimed} differs from its certificate's ${certified}`);
    }
  }
  return provenance;
}

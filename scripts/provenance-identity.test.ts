import { describe, expect, test } from "bun:test";
import {
  createHash,
  generateKeyPairSync,
  type KeyObject,
  sign,
  X509Certificate,
} from "node:crypto";
import { resolve } from "node:path";
import { initializeCA, initializeCTLog, initializeTLog } from "@sigstore/mock";
import { TrustedRoot } from "@sigstore/protobuf-specs";
import { PolicyError, type TrustMaterial, toTrustMaterial } from "@sigstore/verify";
import { NPM_PACKAGES, type NpmPackage, provenanceSubject } from "./npm-packages.ts";
import {
  RELEASE_IDENTITY,
  RELEASE_SIGNERS,
  ROLLBACK_SIGNERS,
  verifySigningIdentity,
} from "./provenance-identity.ts";
import type { AuditedBundle, SignatureAudit } from "./registry-consistency.ts";
import {
  SDK_RELEASE_WORKFLOW,
  SDK_REPOSITORY,
  SDK_SOURCE_DEPENDENCY,
} from "./sdk-release-verification.ts";
import { verifySdkPackageSignatures, verifySignedReport } from "./verify-sdk-package-signatures.ts";

const COMMIT = "b842a5322072321e6a0439399b4cc8c6e7823032";
const VERSION = "6.0.0-rc.3";
const CORE_COMMIT = "bc3eeee07f4f238ccce27fe2a7a4d513d5899c10";
const fixture = (name: string) => Bun.file(resolve(import.meta.dir, "__fixtures__", name)).json();
const buffer = (view: ArrayBufferView) =>
  Buffer.from(view.buffer, view.byteOffset, view.byteLength);
const b64 = (bytes: ArrayBufferView | string) =>
  (typeof bytes === "string" ? Buffer.from(bytes) : buffer(bytes)).toString("base64");
const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest();

/** A statement whose every claim is the release's own. */
const statement = () =>
  JSON.stringify({
    _type: "https://in-toto.io/Statement/v1",
    subject: [
      {
        name: provenanceSubject(NPM_PACKAGES.presto, VERSION),
        digest: { sha512: "ab".repeat(64) },
      },
    ],
    predicateType: "https://slsa.dev/provenance/v1",
    predicate: {
      buildDefinition: {
        externalParameters: {
          workflow: {
            ref: "refs/heads/main",
            repository: SDK_REPOSITORY,
            path: SDK_RELEASE_WORKFLOW,
          },
        },
        resolvedDependencies: [{ uri: SDK_SOURCE_DEPENDENCY, digest: { gitCommit: COMMIT } }],
      },
    },
  });

const workflow = (path: string) => `${SDK_REPOSITORY}/${path}@refs/heads/main`;

/** The certificate identity of a genuine release, field by field (Fulcio OID suffixes). */
const releaseCertificate = () => ({
  san: workflow(".github/workflows/_publish-npm.yml"),
  "8": RELEASE_IDENTITY.issuer,
  "9": workflow(".github/workflows/_publish-npm.yml"),
  "11": RELEASE_IDENTITY.runner,
  "12": RELEASE_IDENTITY.repository,
  "13": COMMIT,
  "14": RELEASE_IDENTITY.ref,
  "15": RELEASE_IDENTITY.repositoryId,
  "17": RELEASE_IDENTITY.ownerId,
  "18": workflow(SDK_RELEASE_WORKFLOW),
  "19": COMMIT,
});
type CertificateFields = ReturnType<typeof releaseCertificate>;

const keys = () => generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const spki = (key: KeyObject) => key.export({ format: "der", type: "spki" });

/** A trusted root holding exactly the mock CA, CT log and transparency log. */
function mockTrust(
  ca: { rootCertificate: ArrayBufferView },
  ctLog: { publicKey: ArrayBufferView; logID: ArrayBufferView },
  tlogKey: KeyObject,
): TrustMaterial {
  const validFor = { start: new Date(Date.now() - 3_600_000).toISOString() };
  const key = (raw: ArrayBufferView) => ({
    rawBytes: b64(raw),
    keyDetails: "PKIX_ECDSA_P256_SHA_256",
    validFor,
  });
  return toTrustMaterial(
    TrustedRoot.fromJSON({
      mediaType: "application/vnd.dev.sigstore.trustedroot+json;version=0.1",
      tlogs: [
        {
          baseUrl: "https://tlog.mock",
          hashAlgorithm: "SHA2_256",
          publicKey: key(spki(tlogKey)),
          logId: { keyId: b64(sha256(spki(tlogKey))) },
        },
      ],
      certificateAuthorities: [
        {
          subject: { organization: "mock", commonName: "mock" },
          uri: "https://ca.mock",
          certChain: { certificates: [{ rawBytes: b64(ca.rootCertificate) }] },
          validFor,
        },
      ],
      ctlogs: [
        {
          baseUrl: "https://ctlog.mock",
          hashAlgorithm: "SHA2_256",
          publicKey: key(ctLog.publicKey),
          logId: { keyId: b64(ctLog.logID) },
        },
      ],
      timestampAuthorities: [],
    }),
  );
}

/**
 * A complete Sigstore world from @sigstore/mock — a CA whose certificates carry SCTs from a CT log,
 * and a Rekor log whose inclusion promise a v0.1 bundle carries — so every check before the identity
 * policy passes and the policy alone decides.
 */
async function mockWorld() {
  const created = Date.now();
  // The mock root is valid from its creation; the leaf and its log entry come strictly after.
  const issued = new Date(created + 1000);
  const ctLog = await initializeCTLog(keys(), issued);
  const ca = await initializeCA(keys(), ctLog, issued);
  const tlogKeys = keys();
  const tlog = await initializeTLog("https://tlog.mock", tlogKeys, new Date(created + 2000));
  const trust = mockTrust(ca, ctLog, tlogKeys.publicKey);

  /** A v0.1 bundle over the release's statement, signed under the given certificate identity. */
  async function bundle(fields: CertificateFields) {
    const signer = keys();
    const { san, ...oids } = fields;
    const certificate = await ca.issueCertificate({
      publicKey: spki(signer.publicKey),
      subjectAltName: san,
      extensions: Object.entries(oids).map(([suffix, value]) => ({
        oid: `1.3.6.1.4.1.57264.1.${suffix}`,
        value,
      })),
    });
    const payload = Buffer.from(statement());
    const payloadType = "application/vnd.in-toto+json";
    const pae = Buffer.concat([
      Buffer.from(`DSSEv1 ${payloadType.length} ${payloadType} ${payload.length} `),
      payload,
    ]);
    const signature = sign("sha256", pae, signer.privateKey);
    const envelope = { payload: b64(payload), payloadType, signatures: [{ sig: b64(signature) }] };
    const pem = new X509Certificate(buffer(certificate)).toString();
    const logged = Object.values(
      await tlog.log({
        apiVersion: "0.0.1",
        kind: "dsse",
        spec: {
          envelopeHash: {
            algorithm: "sha256",
            value: sha256(JSON.stringify(envelope)).toString("hex"),
          },
          payloadHash: { algorithm: "sha256", value: sha256(payload).toString("hex") },
          signatures: [{ signature: b64(signature), verifier: b64(pem) }],
        },
      }),
    )[0] as {
      body: string;
      integratedTime: number;
      logID: string;
      logIndex: number;
      verification: { signedEntryTimestamp: string };
    };
    return {
      mediaType: "application/vnd.dev.sigstore.bundle+json;version=0.1",
      verificationMaterial: {
        x509CertificateChain: { certificates: [{ rawBytes: b64(certificate) }] },
        tlogEntries: [
          {
            logIndex: String(logged.logIndex),
            logId: { keyId: b64(Buffer.from(logged.logID, "hex")) },
            kindVersion: { kind: "dsse", version: "0.0.1" },
            integratedTime: String(logged.integratedTime),
            inclusionPromise: { signedEntryTimestamp: logged.verification.signedEntryTimestamp },
            canonicalizedBody: logged.body,
          },
        ],
        timestampVerificationData: { rfc3161Timestamps: [] },
      },
      dsseEnvelope: envelope,
    };
  }
  return { trust, bundle };
}

/** The `npm audit signatures --include-attestations` entry that carries `bundle`. */
const reportFor = (
  bundle: object,
  version = VERSION,
  pkg: NpmPackage = NPM_PACKAGES.presto,
): SignatureAudit => ({
  verified: [
    {
      name: pkg.name,
      version,
      attestations: { provenance: { predicateType: "https://slsa.dev/provenance/v1" } },
      attestationBundles: [
        { predicateType: "https://slsa.dev/provenance/v1", bundle: bundle as AuditedBundle },
      ],
    },
  ],
});

// Each row changes exactly one certificate field while the statement still claims the release.
const mutations: Array<[string, keyof CertificateFields, string]> = [
  [
    "another repository's workflow as SAN",
    "san",
    "https://github.com/someone/presto/.github/workflows/_publish-npm.yml@refs/heads/main",
  ],
  ["a SAN with a suffix", "san", `${workflow(".github/workflows/_publish-npm.yml")}x`],
  ["another build signer", "9", workflow(".github/workflows/other.yml")],
  ["another issuer", "8", "https://issuer.example"],
  ["a self-hosted runner", "11", "self-hosted"],
  ["another repository URI", "12", "https://github.com/someone/presto"],
  ["another source commit", "13", "c".repeat(40)],
  ["another source ref", "14", "refs/heads/feature"],
  ["another repository ID", "15", "1"],
  ["another owner ID", "17", "1"],
  ["another build config", "18", workflow(".github/workflows/other.yml")],
  ["another build config commit", "19", "c".repeat(40)],
];
// The refusal names the mutated field, so no row passes on another field's failure.
const refusal = (field: keyof CertificateFields) =>
  field === "san"
    ? "certificate identity error"
    : field === "8"
      ? "expected issuer="
      : `missing OID 1.3.6.1.4.1.57264.1.${field}`;

// Each row tampers with a bundle signed under the release identity: the cryptographic checks, not
// the identity policy, refuse it, whichever signers are accepted.
type Signed = Awaited<ReturnType<Awaited<ReturnType<typeof mockWorld>>["bundle"]>>;
const entry = (bundle: Signed) =>
  bundle.verificationMaterial.tlogEntries[0] as Signed["verificationMaterial"]["tlogEntries"][0];
const tampered: Array<[string, (bundle: Signed, other: Signed) => Signed]> = [
  [
    "a payload changed after signing",
    (bundle) => ({
      ...bundle,
      dsseEnvelope: { ...bundle.dsseEnvelope, payload: b64(statement().replace("abab", "cdcd")) },
    }),
  ],
  [
    "another signer's certificate",
    (bundle, other) => ({
      ...bundle,
      verificationMaterial: {
        ...bundle.verificationMaterial,
        x509CertificateChain: other.verificationMaterial.x509CertificateChain,
      },
    }),
  ],
  [
    "a second envelope signature",
    (bundle, other) => ({
      ...bundle,
      dsseEnvelope: {
        ...bundle.dsseEnvelope,
        signatures: [...bundle.dsseEnvelope.signatures, ...other.dsseEnvelope.signatures],
      },
    }),
  ],
  [
    "a log entry with another integrated time",
    (bundle) => ({
      ...bundle,
      verificationMaterial: {
        ...bundle.verificationMaterial,
        tlogEntries: [
          { ...entry(bundle), integratedTime: String(Number(entry(bundle).integratedTime) + 1) },
        ],
      },
    }),
  ],
  [
    "another signature's log entry",
    (bundle, other) => ({
      ...bundle,
      verificationMaterial: {
        ...bundle.verificationMaterial,
        tlogEntries: other.verificationMaterial.tlogEntries,
      },
    }),
  ],
];

describe("the verifier binds a provenance statement to its signing identity", async () => {
  const world = await mockWorld();

  test("a statement signed under the release identity verifies through both entry points", async () => {
    const signed = await world.bundle(releaseCertificate());
    const { identity } = await verifySigningIdentity(signed, {}, world.trust);
    expect(identity.signer).toBe(".github/workflows/_publish-npm.yml");
    expect(identity.commit).toBe(COMMIT);
    const verified = await verifySignedReport(reportFor(signed), VERSION, NPM_PACKAGES.presto, {
      expectedCommit: COMMIT,
      trust: world.trust,
    });
    expect(verified.commit).toBe(COMMIT);
    expect(verified.workflow).toBe(SDK_RELEASE_WORKFLOW);
  });

  test.each(mutations)("a certificate with %s is refused", async (_, field, value) => {
    const signed = await world.bundle({ ...releaseCertificate(), [field]: value });
    for (const verifying of [
      verifySigningIdentity(signed, {}, world.trust),
      verifySignedReport(reportFor(signed), VERSION, NPM_PACKAGES.presto, { trust: world.trust }),
    ]) {
      const error = await verifying.then(
        () => undefined,
        (cause: unknown) => cause,
      );
      expect(error).toBeInstanceOf(PolicyError);
      expect((error as Error).message).toContain(refusal(field));
    }
  });

  test.each(tampered)("%s is refused before any identity is considered", async (_, tamper) => {
    const forged = tamper(
      await world.bundle(releaseCertificate()),
      await world.bundle(releaseCertificate()),
    );
    for (const signers of [RELEASE_SIGNERS, ROLLBACK_SIGNERS]) {
      const error = await verifySigningIdentity(forged, { signers }, world.trust).then(
        () => undefined,
        (cause: unknown) => cause,
      );
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(PolicyError);
    }
  });
});

describe("real publications", async () => {
  const trust = toTrustMaterial(TrustedRoot.fromJSON(await fixture("sigstore-trusted-root.json")));

  test("presto 6.0.0-rc.3 verifies at its release commit and no other", async () => {
    const signed = await fixture("slsa-bundle-presto-6.0.0-rc.3.json");
    const verified = await verifySignedReport(reportFor(signed), VERSION, NPM_PACKAGES.presto, {
      expectedCommit: COMMIT,
      trust,
    });
    expect(verified.commit).toBe(COMMIT);
    await expect(
      verifySigningIdentity(signed, { commit: "c".repeat(40) }, trust),
    ).rejects.toBeInstanceOf(PolicyError);
  });

  test("presto-core 1.2.1 verifies at its release commit", async () => {
    const pkg = NPM_PACKAGES["presto-core"];
    const signed = await fixture("slsa-bundle-presto-core-1.2.1.json");
    const verified = await verifySignedReport(reportFor(signed, "1.2.1", pkg), "1.2.1", pkg, {
      expectedCommit: CORE_COMMIT,
      trust,
    });
    expect(verified.commit).toBe(CORE_COMMIT);
  });

  test("presto 5.2.0, signed by the earlier reusable workflow, verifies only on the rollback path", async () => {
    const signed = await fixture("slsa-bundle-presto-5.2.0.json");
    const report = reportFor(signed, "5.2.0");
    await expect(verifySigningIdentity(signed, {}, trust)).rejects.toBeInstanceOf(PolicyError);
    await expect(
      verifySignedReport(report, "5.2.0", NPM_PACKAGES.presto, { trust }),
    ).rejects.toBeInstanceOf(PolicyError);
    const { identity } = await verifySigningIdentity(signed, { signers: ROLLBACK_SIGNERS }, trust);
    expect(identity.signer).toBe(".github/workflows/_publish-sdk.yml");
    const verified = await verifySignedReport(report, "5.2.0", NPM_PACKAGES.presto, {
      signers: ROLLBACK_SIGNERS,
      trust,
    });
    expect(verified.commit).toBe(identity.commit);
  });
});

describe.skipIf(!process.env.PRESTO_LIVE_PROVENANCE)("live registry and TUF", () => {
  test("current publications verify against Sigstore's public-good root", async () => {
    expect((await verifySdkPackageSignatures(VERSION, NPM_PACKAGES.presto, COMMIT)).commit).toBe(
      COMMIT,
    );
    await verifySdkPackageSignatures("1.2.1", NPM_PACKAGES["presto-core"]);
  }, 300_000);
});

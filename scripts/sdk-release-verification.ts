import {
  NPM_PACKAGES,
  type NpmPackage,
  packageFromArgs,
  provenanceSubject,
  VERSION_PATTERNS,
} from "./npm-packages.ts";

export const SDK_PACKAGE = NPM_PACKAGES.presto.name;
export const SDK_RELEASE_WORKFLOW = ".github/workflows/release-sdk.yml";
export const LEGACY_SDK_RELEASE_WORKFLOW = ".github/workflows/publish-testnet.yml";
export const SDK_REPOSITORY = "https://github.com/alejoamiras/presto";
export const SDK_SOURCE_DEPENDENCY = "git+https://github.com/alejoamiras/presto@refs/heads/main";
export const SDK_VERSION_PATTERN = VERSION_PATTERNS["aztec-derived"];

interface AttestationResponse {
  attestations?: Array<{
    predicateType?: string;
    bundle?: {
      dsseEnvelope?: { payload?: string };
    };
  }>;
}

export interface ProvenanceStatement {
  subject?: Array<{ name?: string; digest?: { sha512?: string } }>;
  predicate?: {
    buildDefinition?: {
      externalParameters?: {
        workflow?: { ref?: string; repository?: string; path?: string };
      };
      resolvedDependencies?: Array<{ uri?: string; digest?: { gitCommit?: string } }>;
    };
  };
}

export interface VerifiedProvenance {
  commit: string;
  ref: string;
  repository: string;
  workflow: string;
  /** The subject digest in npm's integrity form (`sha512-<base64>`). */
  integrity: string;
}

function npmView(spec: string, field: string): string {
  const result = Bun.spawnSync(["npm", "view", spec, field], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`npm view failed: ${result.stderr.toString().trim()}`);
  }
  const value = result.stdout.toString().trim();
  if (!value) throw new Error(`npm view ${spec} ${field} returned an empty value`);
  return value;
}

/** The SHA-512 hex digest of the subject named `expectedSubject`. */
function subjectDigest(
  statement: ProvenanceStatement,
  expectedSubject: string,
  expectedSha512?: string,
): string {
  const subject = statement.subject?.find((subject) => subject.name === expectedSubject);
  if (!subject) {
    throw new Error(`provenance subject does not contain ${expectedSubject}`);
  }
  const sha512 = subject.digest?.sha512;
  if (!sha512 || !/^[0-9a-f]{128}$/.test(sha512)) {
    throw new Error("provenance subject has no SHA-512 digest");
  }
  if (expectedSha512 && sha512 !== expectedSha512) {
    throw new Error("provenance subject digest does not match the npm tarball integrity");
  }
  return sha512;
}

/** The provenance must name exactly `pkg@version`: a statement for a sibling package is rejected. */
export function verifyProvenanceStatement(
  statement: ProvenanceStatement,
  version: string,
  expectedCommit?: string,
  allowedWorkflows: readonly string[] = [SDK_RELEASE_WORKFLOW],
  expectedSha512?: string,
  pkg: NpmPackage = NPM_PACKAGES.presto,
): VerifiedProvenance {
  const sha512 = subjectDigest(statement, provenanceSubject(pkg, version), expectedSha512);

  const definition = statement.predicate?.buildDefinition;
  const workflow = definition?.externalParameters?.workflow;
  if (workflow?.repository !== SDK_REPOSITORY) {
    throw new Error(`unexpected provenance repository: ${workflow?.repository ?? "missing"}`);
  }
  if (!workflow?.path || !allowedWorkflows.includes(workflow.path)) {
    throw new Error(`unexpected provenance workflow: ${workflow.path ?? "missing"}`);
  }
  if (workflow.ref !== "refs/heads/main") {
    throw new Error(`unexpected provenance ref: ${workflow.ref ?? "missing"}`);
  }

  const commit = definition?.resolvedDependencies?.find(
    (dependency) => dependency.uri === SDK_SOURCE_DEPENDENCY && dependency.digest?.gitCommit,
  )?.digest?.gitCommit;
  if (!commit) throw new Error("provenance has no resolved git commit");
  if (!/^[0-9a-f]{40}$/.test(commit))
    throw new Error(`provenance has invalid git commit ${commit}`);
  if (expectedCommit && commit !== expectedCommit) {
    throw new Error(`provenance commit ${commit} does not match expected ${expectedCommit}`);
  }

  return {
    commit,
    ref: workflow.ref,
    repository: workflow.repository,
    workflow: workflow.path,
    integrity: `sha512-${Buffer.from(sha512, "hex").toString("base64")}`,
  };
}

/**
 * The registry's attestation payload checked against the registry's own `dist.integrity`: two
 * unauthenticated responses, consistent with each other. The signed statement is what
 * `verifySdkPackageSignatures` yields; only its digest may bind bytes that get deployed.
 */
export async function fetchAndVerifySdkProvenance(
  version: string,
  expectedCommit?: string,
  allowedWorkflows?: readonly string[],
  pkg: NpmPackage = NPM_PACKAGES.presto,
): Promise<VerifiedProvenance> {
  const spec = `${pkg.name}@${version}`;
  const url = npmView(spec, "dist.attestations.url");
  const integrity = npmView(spec, "dist.integrity");
  const match = /^sha512-([A-Za-z0-9+/]+={0,2})$/.exec(integrity);
  const encodedDigest = match?.[1];
  if (!encodedDigest) throw new Error(`unexpected npm integrity format: ${integrity}`);
  const expectedSha512 = Buffer.from(encodedDigest, "base64").toString("hex");
  if (expectedSha512.length !== 128) throw new Error("npm integrity is not a SHA-512 digest");
  const response = await fetch(url);
  if (!response.ok) throw new Error(`attestation request failed: HTTP ${response.status}`);
  const body = (await response.json()) as AttestationResponse;
  const attestation = body.attestations?.find(
    (item) => item.predicateType === "https://slsa.dev/provenance/v1",
  );
  const payload = attestation?.bundle?.dsseEnvelope?.payload;
  if (!payload) throw new Error("npm package has no SLSA provenance attestation payload");
  const statement = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
  return verifyProvenanceStatement(
    statement,
    version,
    expectedCommit,
    allowedWorkflows,
    expectedSha512,
    pkg,
  );
}

if (import.meta.main) {
  const { pkg, rest } = packageFromArgs(process.argv.slice(2));
  const version = rest[0];
  const expectedCommit = rest[1];
  if (!version) {
    console.error(
      "usage: bun scripts/sdk-release-verification.ts [--package <key>] <version> [expected-commit]",
    );
    process.exit(1);
  }
  const verified = await fetchAndVerifySdkProvenance(version, expectedCommit, undefined, pkg);
  console.log(
    `verified npm provenance for ${pkg.name}@${version}: ${verified.repository}/${verified.workflow}@${verified.ref} (${verified.commit})`,
  );
}

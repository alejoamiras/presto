import { afterAll, describe, expect, test } from "bun:test";
import { NPM_PACKAGES } from "./npm-packages.ts";
import {
  fetchAttestationStatement,
  SDK_RELEASE_WORKFLOW,
  SDK_REPOSITORY,
  SDK_SOURCE_DEPENDENCY,
  verifyProvenanceStatement,
} from "./sdk-release-verification.ts";

function statement(
  overrides: {
    path?: string;
    ref?: string;
    commit?: string;
    source?: string;
    digest?: string;
  } = {},
) {
  return {
    subject: [
      {
        name: "pkg:npm/%40alejoamiras/presto@5.2.0-revision.1",
        digest: { sha512: overrides.digest ?? "ab".repeat(64) },
      },
    ],
    predicate: {
      buildDefinition: {
        externalParameters: {
          workflow: {
            repository: SDK_REPOSITORY,
            path: overrides.path ?? SDK_RELEASE_WORKFLOW,
            ref: overrides.ref ?? "refs/heads/main",
          },
        },
        resolvedDependencies: [
          {
            uri: overrides.source ?? SDK_SOURCE_DEPENDENCY,
            digest: { gitCommit: overrides.commit ?? "ab".repeat(20) },
          },
        ],
      },
    },
  };
}

describe("SDK provenance verification", () => {
  test("accepts the exact repository, top-level workflow, main ref, and commit", () => {
    expect(
      verifyProvenanceStatement(statement(), "5.2.0-revision.1", "ab".repeat(20), "ab".repeat(64)),
    ).toEqual({
      commit: "ab".repeat(20),
      ref: "refs/heads/main",
      repository: SDK_REPOSITORY,
      workflow: SDK_RELEASE_WORKFLOW,
      integrity: `sha512-${Buffer.from("ab".repeat(64), "hex").toString("base64")}`,
    });
  });

  test("a subject without a SHA-512 digest cannot vouch for any bytes", () => {
    expect(() => verifyProvenanceStatement(statement({ digest: "" }), "5.2.0-revision.1")).toThrow(
      "no SHA-512 digest",
    );
    expect(() =>
      verifyProvenanceStatement(statement({ digest: "ab".repeat(32) }), "5.2.0-revision.1"),
    ).toThrow("no SHA-512 digest");
  });

  test("rejects provenance from the reusable workflow identity", () => {
    expect(() =>
      verifyProvenanceStatement(
        statement({ path: ".github/workflows/_publish-npm.yml" }),
        "5.2.0-revision.1",
      ),
    ).toThrow("unexpected provenance workflow");
  });

  test("rejects the retired publish-testnet.yml workflow, whose identity no signer policy carries", () => {
    expect(() =>
      verifyProvenanceStatement(
        statement({ path: ".github/workflows/publish-testnet.yml" }),
        "5.2.0-revision.1",
      ),
    ).toThrow("unexpected provenance workflow");
  });

  test("rejects a statement that names a sibling package", () => {
    const core = {
      ...NPM_PACKAGES.presto,
      name: "@alejoamiras/presto-core",
      dir: "packages/sdk-core",
      versionMode: "manifest" as const,
    };
    expect(() =>
      verifyProvenanceStatement(statement(), "5.2.0-revision.1", undefined, undefined, core),
    ).toThrow("does not contain pkg:npm/%40alejoamiras/presto-core@5.2.0-revision.1");
  });

  test("rejects a tag commit that differs from the published provenance", () => {
    expect(() => verifyProvenanceStatement(statement(), "5.2.0-revision.1", "different")).toThrow(
      "does not match expected",
    );
  });

  test("binds the provenance to the exact source dependency and tarball digest", () => {
    expect(() =>
      verifyProvenanceStatement(
        statement({ source: "git+https://github.com/example/fork@refs/heads/main" }),
        "5.2.0-revision.1",
      ),
    ).toThrow("resolved git commit");
    expect(() =>
      verifyProvenanceStatement(statement(), "5.2.0-revision.1", undefined, "cd".repeat(64)),
    ).toThrow("tarball integrity");
  });
});

describe("attestation fetch", () => {
  const payload = Buffer.from(JSON.stringify(statement())).toString("base64");
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(request) {
      const { pathname } = new URL(request.url);
      if (pathname === "/answered") {
        return Response.json({
          attestations: [
            {
              predicateType: "https://slsa.dev/provenance/v1",
              bundle: { dsseEnvelope: { payload } },
            },
          ],
        });
      }
      if (pathname === "/stalled-body") {
        const opened = new ReadableStream({ start: (body) => body.enqueue(Buffer.from("{")) });
        return new Response(opened, { headers: { "content-type": "application/json" } });
      }
      return new Promise<Response>(() => {});
    },
  });
  afterAll(() => server.stop(true));
  const at = (path: string) => new URL(path, server.url).href;

  // A registry or proxy that accepts the connection and never answers, before or after its headers.
  test.each(["/stalled-headers", "/stalled-body"])(
    "a response that stalls (%s) fails, naming the URL, once its time is up",
    async (path) => {
      const started = performance.now();
      await expect(fetchAttestationStatement(at(path), 200)).rejects.toThrow(
        `GET ${at(path)} gave no answer within 0.2 s`,
      );
      expect(performance.now() - started).toBeLessThan(5_000);
    },
  );

  test("a prompt answer yields its provenance statement", async () => {
    expect(await fetchAttestationStatement(at("/answered"), 200)).toEqual(statement());
  });
});

import { describe, expect, test } from "bun:test";
import {
  assertEligibleTimestamp,
  changedActions,
  changedDependencies,
  parseActionReferences,
  parseBunLock,
  parseCargoLock,
  verifyActionReference,
  verifyCargoDependency,
  verifyNpmDependency,
  type ResolvedDependency,
} from "./dependency-age";

const NOW = new Date("2026-09-07T12:00:00.000Z");
const BOUNDARY = "2026-08-31T12:00:00.000Z";

function response(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

describe("seven-day dependency eligibility", () => {
  test("accepts the exact boundary and rejects younger or missing timestamps", () => {
    expect(assertEligibleTimestamp("boundary", BOUNDARY, NOW).toISOString()).toBe(BOUNDARY);
    expect(() => assertEligibleTimestamp("young", "2026-08-31T12:00:00.001Z", NOW)).toThrow(
      "eligible 2026-09-07T12:00:00.001Z",
    );
    expect(() => assertEligibleTimestamp("missing", undefined, NOW)).toThrow(
      "publication timestamp is missing",
    );
  });

  test("detects changed aliases and package sources from Bun's resolved records", () => {
    const base = parseBunLock(`{
      "packages": { "alias": ["real-package@1.0.0", "", {}] }
    }`);
    const versionChanged = parseBunLock(`{
      "packages": { "alias": ["real-package@2.0.0", "", {}] }
    }`);
    const sourceChanged = parseBunLock(`{
      "packages": { "alias": ["real-package@1.0.0", "https://example.test/pkg.tgz", {}] }
    }`);

    expect(changedDependencies(base, versionChanged)).toEqual([
      { ecosystem: "npm", name: "real-package", version: "2.0.0", source: "registry:npm" },
    ]);
    expect(changedDependencies(base, sourceChanged)[0]?.source).toBe(
      "https://example.test/pkg.tgz",
    );
  });

  test("detects young transitive Cargo entries and source changes", () => {
    const base = parseCargoLock(`[[package]]
name = "direct"
version = "1.0.0"
source = "registry+https://github.com/rust-lang/crates.io-index"
`);
    const current = parseCargoLock(`[[package]]
name = "direct"
version = "1.0.0"
source = "registry+https://github.com/rust-lang/crates.io-index"

[[package]]
name = "transitive"
version = "2.0.0"
source = "registry+https://github.com/rust-lang/crates.io-index"
`);
    expect(changedDependencies(base, current).map((entry) => entry.name)).toEqual(["transitive"]);

    const baseDependency = base[0];
    if (!baseDependency) throw new Error("fixture did not produce a dependency");
    const changedSource = [{ ...baseDependency, source: "git+https://example.test/repo" }];
    expect(changedDependencies(base, changedSource)).toEqual(changedSource);
  });

  test("npm and Cargo checks reject missing metadata, young transitives, and non-registry sources", async () => {
    const npm: ResolvedDependency = {
      ecosystem: "npm",
      name: "transitive",
      version: "2.0.0",
      source: "registry:npm",
    };
    await expect(
      verifyNpmDependency(npm, NOW, async () =>
        response({ versions: { "2.0.0": {} }, time: { "2.0.0": "2026-09-01T00:00:00Z" } }),
      ),
    ).rejects.toThrow("eligible");
    await expect(
      verifyNpmDependency(npm, NOW, async () => response({ versions: {}, time: {} })),
    ).rejects.toThrow("metadata is missing");

    const cargo: ResolvedDependency = {
      ecosystem: "cargo",
      name: "transitive",
      version: "2.0.0",
      source: "git+https://example.test/repo",
    };
    await expect(verifyCargoDependency(cargo, NOW)).rejects.toThrow("unsupported Cargo source");
  });

  test("scans composite Actions and verifies release age plus exact tag commit", async () => {
    const oldText = "steps:\n  - uses: owner/action/path@1111111111111111111111111111111111111111 # v1.0.0";
    const newText = "steps:\n  - uses: owner/action/path@2222222222222222222222222222222222222222 # v2.0.0";
    const changed = changedActions(parseActionReferences(oldText), parseActionReferences(newText));
    expect(changed).toHaveLength(1);
    const reference = changed[0];
    if (!reference) throw new Error("fixture did not produce an Action reference");
    expect(reference).toEqual({
      repository: "owner/action",
      path: "path",
      sha: "2222222222222222222222222222222222222222",
      tag: "v2.0.0",
    });

    const calls: string[] = [];
    await verifyActionReference(reference, NOW, async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/releases/tags/")) {
        return response({
          tag_name: "v2.0.0",
          published_at: BOUNDARY,
          draft: false,
          prerelease: false,
        });
      }
      return response({ object: { type: "commit", sha: reference.sha } });
    });
    expect(calls).toHaveLength(2);

    await expect(
      verifyActionReference(reference, NOW, async (input) => {
        if (String(input).includes("/releases/tags/")) {
          return response({
            tag_name: "v2.0.0",
            published_at: BOUNDARY,
            draft: false,
            prerelease: false,
          });
        }
        return response({ object: { type: "commit", sha: "3".repeat(40) } });
      }),
    ).rejects.toThrow("tag resolves to");
  });
});

describe.skipIf(!process.env.DEPENDENCY_AGE_REAL_REGISTRY)("real registry metadata", () => {
  test("verifies a known npm release through live publication metadata", async () => {
    await verifyNpmDependency(
      { ecosystem: "npm", name: "ms", version: "2.1.3", source: "registry:npm" },
      new Date(),
    );
  });
});

import { describe, expect, test } from "bun:test";
import { NPM_PACKAGES, type PackageKey } from "./npm-packages.ts";
import {
  describePlan,
  lockfileSlice,
  orderByDependencies,
  planRelease,
  selectPackages,
  workflowOutputs,
} from "./release-plan.ts";

const core = NPM_PACKAGES["presto-core"];
const noir = NPM_PACKAGES["presto-noir"];
const keys = (list: PackageKey[]) => list;
const withSiblings = <T>(fn: () => T): T => fn();

const verified = { releaseVerified: true, changedSinceTag: false };
const presto = (deps: Record<string, string> = {}) => ({
  manifest: {
    name: NPM_PACKAGES.presto.name,
    version: "0.0.0",
    dependencies: { "@aztec/stdlib": "5.2.0", ...deps },
  },
  published: ["5.1.0"],
});
const coreFacts = (
  published: string[],
  extra: Partial<{
    releaseVerified: boolean;
    changedSinceTag: boolean;
    recordsExist: boolean;
    publishedDependencies: Record<string, string>;
  }> = {},
) => ({
  manifest: { name: core.name, version: "1.0.0" },
  published,
  ...extra,
});
const noirFacts = (
  published: string[],
  extra: Partial<{
    releaseVerified: boolean;
    changedSinceTag: boolean;
    publishedDependencies: Record<string, string>;
  }> = {},
) => ({
  manifest: { name: noir.name, version: "1.0.0", dependencies: { [core.name]: "workspace:*" } },
  published,
  ...extra,
});

describe("release plan", () => {
  test("selection expands `all` in dependency order and rejects unknown keys", () => {
    withSiblings(() => {
      const order = orderByDependencies(keys(["presto", "presto-core"]), (key) =>
        key === "presto" ? presto({ [core.name]: "workspace:*" }).manifest : coreFacts([]).manifest,
      );
      expect(order).toEqual(keys(["presto-core", "presto"]));
    });
    expect(selectPackages("presto")).toEqual(["presto"]);
    expect(() => selectPackages("nope")).toThrow("unknown packages selection");
  });

  test("an aztec-derived package alone publishes with a revision suffix when its base is taken", () => {
    const plan = planRelease(["presto"], { presto: { ...presto(), published: ["5.2.0"] } });
    expect(plan.presto).toMatchObject({
      version: "5.2.0-revision.1",
      action: "publish",
      deferred: [],
    });
    const outputs = workflowOutputs(plan, "summary");
    expect(outputs).toContain(
      "publish_presto=true\nversion_presto=5.2.0-revision.1\ndeps_presto=\n",
    );
    expect(outputs).toContain("summary<<EOF\nsummary\nEOF\n");
  });

  test("a candidate with a leftover tag or release is a collision before anything publishes", () => {
    withSiblings(() => {
      expect(() =>
        planRelease(keys(["presto-core"]), {
          "presto-core": coreFacts([], { recordsExist: true }),
        } as never),
      ).toThrow("release tag or GitHub release already exists");
    });
  });

  test("a malformed manifest version fails the plan before anything publishes", () => {
    withSiblings(() => {
      for (const version of ["1.0.0-alpha..x", "01.0.0", "1.0.0-01", "1.0.0-revision.1"]) {
        expect(() =>
          planRelease(keys(["presto-core"]), {
            "presto-core": { manifest: { name: core.name, version }, published: [] },
          } as never),
        ).toThrow("is not a valid manifest version");
      }
    });
  });
});

describe("release plan: dependencies", () => {
  test("a previously unpublished core is published first and the adapter's dependency checks are deferred", () => {
    withSiblings(() => {
      const plan = planRelease(keys(["presto-core", "presto"]), {
        "presto-core": coreFacts([]),
        presto: presto({ [core.name]: "workspace:*" }),
      } as never);
      expect(plan["presto-core" as PackageKey]).toMatchObject({
        version: "1.0.0",
        action: "publish",
      });
      expect(plan.presto?.dependencyVersions).toEqual({ [core.name]: "1.0.0" });
      expect(plan.presto?.deferred).toEqual([
        `${core.name}@1.0.0 provenance (published in this run)`,
        `${NPM_PACKAGES.presto.name} consumer rerun against registry ${core.name}@1.0.0`,
      ]);
      expect(describePlan(plan)).toContain("deferred:");
    });
  });

  test("a published, verified, unchanged core is reused, not republished, and nothing is deferred", () => {
    withSiblings(() => {
      const plan = planRelease(keys(["presto-core", "presto"]), {
        "presto-core": coreFacts(["1.0.0"], verified),
        presto: presto({ [core.name]: "workspace:*" }),
      } as never);
      expect(plan["presto-core" as PackageKey]?.action).toBe("reuse");
      expect(plan.presto?.deferred).toEqual([]);
    });
  });

  test("a published core whose release does not verify, or whose build inputs moved, is a collision", () => {
    withSiblings(() => {
      expect(() =>
        planRelease(keys(["presto-core"]), {
          "presto-core": coreFacts(["1.0.0"], { releaseVerified: false }),
        } as never),
      ).toThrow("release records and provenance do not verify");
      expect(() =>
        planRelease(keys(["presto-core"]), {
          "presto-core": coreFacts(["1.0.0"], { releaseVerified: true, changedSinceTag: true }),
        } as never),
      ).toThrow("build inputs changed since its release tag");
    });
  });

  test("an unselected dependency must be on npm at the pinned version with a verified, unchanged release", () => {
    withSiblings(() => {
      const adapter = presto({ [core.name]: "workspace:*" });
      expect(() =>
        planRelease(["presto"], { presto: adapter, "presto-core": coreFacts(["0.9.0"]) } as never),
      ).toThrow("neither selected for this run nor on npm");
      expect(() =>
        planRelease(["presto"], {
          presto: adapter,
          "presto-core": coreFacts(["1.0.0"], { releaseVerified: false }),
        } as never),
      ).toThrow("release records and provenance do not verify");
      const ok = planRelease(["presto"], {
        presto: adapter,
        "presto-core": coreFacts(["1.0.0"], verified),
      } as never);
      expect(ok.presto?.dependencyVersions).toEqual({ [core.name]: "1.0.0" });
      expect(ok.presto?.deferred).toEqual([]);
    });
  });

  test("a reused adapter must already carry the pins this run would give it", () => {
    withSiblings(() => {
      const facts = (publishedCore: string) =>
        ({
          "presto-core": coreFacts([]),
          "presto-noir": noirFacts(["1.0.0"], {
            ...verified,
            publishedDependencies: { [core.name]: publishedCore },
          }),
        }) as never;
      // Core 1.0.0 publishes now; Noir 1.0.0 is already out pinned to core 0.9.0 → it must be bumped.
      expect(() => planRelease(keys(["presto-core", "presto-noir"]), facts("0.9.0"))).toThrow(
        "bump the version to pick up the new dependency",
      );
      // Same pins → reuse, and no deferred checks for a package whose publish job will not run.
      const plan = planRelease(keys(["presto-core", "presto-noir"]), facts("1.0.0"));
      expect(plan["presto-noir" as PackageKey]).toMatchObject({ action: "reuse", deferred: [] });
    });
  });

  test("a sibling pinned only as a peer dependency is still recognised on reuse", () => {
    withSiblings(() => {
      const plan = planRelease(keys(["presto-core", "presto-noir"]), {
        "presto-core": coreFacts(["1.0.0"], verified),
        "presto-noir": {
          manifest: {
            name: noir.name,
            version: "1.0.0",
            peerDependencies: { [core.name]: "workspace:^" },
          },
          published: ["1.0.0"],
          ...verified,
          publishedDependencies: { [core.name]: "1.0.0" },
        },
      } as never);
      expect(plan["presto-noir" as PackageKey]).toMatchObject({
        action: "reuse",
        dependencyVersions: { [core.name]: "1.0.0" },
      });
    });
  });
});

describe("lockfileSlice", () => {
  const lock = (overrides: Record<string, unknown> = {}) =>
    JSON.stringify({
      lockfileVersion: 1,
      workspaces: {
        "": { devDependencies: { typescript: "^7.0.2" } },
        "packages/sdk-core": {
          name: "@alejoamiras/presto-core",
          version: "1.0.0",
          dependencies: { "@logtape/logtape": "^2.3.2", ms: "^2.1.3" },
          devDependencies: { "@types/ms": "^2.1.0" },
        },
        "packages/playground": { name: "playground", dependencies: { vite: "^8" } },
      },
      packages: {
        "@logtape/logtape": ["@logtape/logtape@2.3.2", "", {}, "sha512-a"],
        ms: ["ms@2.1.3", "", {}, "sha512-b"],
        "@types/ms": ["@types/ms@2.1.0", "", {}, "sha512-c"],
        typescript: [
          "typescript@7.0.2",
          "",
          { optionalDependencies: { "@typescript/typescript-linux-x64": "7.0.2" } },
          "sha512-d",
        ],
        "@typescript/typescript-linux-x64": [
          "@typescript/typescript-linux-x64@7.0.2",
          "",
          {},
          "sha512-f",
        ],
        vite: ["vite@8.2.2", "", {}, "sha512-e"],
        ...overrides,
      },
    });
  const base = lockfileSlice(lock(), "packages/sdk-core");

  test("ignores other workspaces' dependencies and the package's own dev dependencies", () => {
    expect(lockfileSlice(lock({ vite: ["vite@8.3.0", "", {}, "x"] }), "packages/sdk-core")).toBe(
      base,
    );
    expect(
      lockfileSlice(lock({ "@types/ms": ["@types/ms@2.2.0", "", {}, "x"] }), "packages/sdk-core"),
    ).toBe(base);
  });

  test("changes when a runtime dependency, a nested resolution, or the compiler moves", () => {
    expect(lockfileSlice(lock({ ms: ["ms@2.1.4", "", {}, "x"] }), "packages/sdk-core")).not.toBe(
      base,
    );
    expect(
      lockfileSlice(
        lock({ "@alejoamiras/presto-core/ms": ["ms@2.0.0", "", {}, "x"] }),
        "packages/sdk-core",
      ),
    ).not.toBe(base);
    expect(
      lockfileSlice(lock({ typescript: ["typescript@7.1.0", "", {}, "x"] }), "packages/sdk-core"),
    ).not.toBe(base);
    // The binary lives in the platform package; its bytes can change under an unchanged wrapper.
    expect(
      lockfileSlice(
        lock({
          "@typescript/typescript-linux-x64": [
            "@typescript/typescript-linux-x64@7.0.2",
            "",
            {},
            "x",
          ],
        }),
        "packages/sdk-core",
      ),
    ).not.toBe(base);
  });

  test("parses bun.lock's trailing commas", () => {
    const text = `{"workspaces": {"packages/x": {"name": "x", "dependencies": {"a": "1",},},}, "packages": {"a": ["a@1", "", {}, "h",],},}`;
    expect(JSON.parse(lockfileSlice(text, "packages/x")).packages.a[0]).toBe("a@1");
  });
});

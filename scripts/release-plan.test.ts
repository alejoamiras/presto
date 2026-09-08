import { describe, expect, test } from "bun:test";
import { NPM_PACKAGES, type PackageKey } from "./npm-packages.ts";
import {
  describePlan,
  orderByDependencies,
  planRelease,
  selectPackages,
  workflowOutputs,
} from "./release-plan.ts";

// The DAG is exercised with a sibling package that arrives in a later arc; until it is registered
// the descriptor has only `presto`, so the tests inject the extra entry.
const core = {
  name: "@alejoamiras/presto-core",
  dir: "packages/sdk-core",
  versionMode: "manifest",
  consumerProfile: "presto-core",
} as const;
const registry = NPM_PACKAGES as unknown as Record<string, unknown>;
const keys = (list: string[]) => list as unknown as PackageKey[];
const withCore = <T>(fn: () => T): T => {
  registry["presto-core"] = core;
  try {
    return fn();
  } finally {
    delete registry["presto-core"];
  }
};

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
  extra: Partial<{ releaseVerified: boolean; changedSinceTag: boolean }> = {},
) => ({
  manifest: { name: core.name, version: "1.0.0" },
  published,
  ...extra,
});

describe("release plan", () => {
  test("selection expands `all` in dependency order and rejects unknown keys", () => {
    withCore(() => {
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

  test("a previously unpublished core is published first and the adapter's dependency checks are deferred", () => {
    withCore(() => {
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

  test("a published, tagged, unchanged core is reused, not republished, and nothing is deferred", () => {
    withCore(() => {
      const plan = planRelease(keys(["presto-core", "presto"]), {
        "presto-core": coreFacts(["1.0.0"], { releaseVerified: true, changedSinceTag: false }),
        presto: presto({ [core.name]: "workspace:*" }),
      } as never);
      expect(plan["presto-core" as PackageKey]?.action).toBe("reuse");
      expect(plan.presto?.deferred).toEqual([]);
    });
  });

  test("a published core whose release does not verify, or whose sources moved, is a collision", () => {
    withCore(() => {
      expect(() =>
        planRelease(keys(["presto-core"]), {
          "presto-core": coreFacts(["1.0.0"], { releaseVerified: false }),
        } as never),
      ).toThrow("release tag and provenance do not agree");
      expect(() =>
        planRelease(keys(["presto-core"]), {
          "presto-core": coreFacts(["1.0.0"], { releaseVerified: true, changedSinceTag: true }),
        } as never),
      ).toThrow("changed since its release tag");
    });
  });

  test("an unselected dependency must already be on npm at the pinned version", () => {
    withCore(() => {
      const facts = {
        presto: presto({ [core.name]: "workspace:*" }),
        "presto-core": coreFacts(["0.9.0"]),
      } as never;
      expect(() => planRelease(["presto"], facts)).toThrow(
        "neither selected for this run nor on npm",
      );
      const ok = planRelease(["presto"], {
        presto: presto({ [core.name]: "workspace:*" }),
        "presto-core": coreFacts(["1.0.0"]),
      } as never);
      expect(ok.presto?.dependencyVersions).toEqual({ [core.name]: "1.0.0" });
      expect(ok.presto?.deferred).toEqual([]);
    });
  });
});

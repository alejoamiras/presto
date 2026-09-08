import { describe, expect, test } from "bun:test";
import {
  baseVersionFor,
  resolvePackageVersion,
  resolvePublishVersion,
} from "./get-sdk-publish-version";
import { NPM_PACKAGES } from "./npm-packages.ts";

const aztecDerived = NPM_PACKAGES.presto;
const manifestMode = {
  ...aztecDerived,
  name: "@alejoamiras/presto-core",
  dir: "packages/sdk-core",
  versionMode: "manifest" as const,
};

describe("resolvePublishVersion", () => {
  test("returns base version when not yet published", () => {
    expect(resolvePublishVersion("5.0.0-nightly.20260224", [])).toBe("5.0.0-nightly.20260224");
  });

  test("returns base version when only other versions are published", () => {
    expect(resolvePublishVersion("5.0.0-nightly.20260224", ["5.0.0-nightly.20260223"])).toBe(
      "5.0.0-nightly.20260224",
    );
  });

  test("appends .1 when base is already published", () => {
    expect(resolvePublishVersion("5.0.0-nightly.20260224", ["5.0.0-nightly.20260224"])).toBe(
      "5.0.0-nightly.20260224.1",
    );
  });

  test("appends .2 when .1 is already published", () => {
    expect(
      resolvePublishVersion("5.0.0-nightly.20260224", [
        "5.0.0-nightly.20260224",
        "5.0.0-nightly.20260224.1",
      ]),
    ).toBe("5.0.0-nightly.20260224.2");
  });

  test("skips gaps in revision numbers", () => {
    expect(
      resolvePublishVersion("5.0.0-nightly.20260224", [
        "5.0.0-nightly.20260224",
        "5.0.0-nightly.20260224.1",
        "5.0.0-nightly.20260224.3",
      ]),
    ).toBe("5.0.0-nightly.20260224.4");
  });

  test("works with rc versions", () => {
    expect(resolvePublishVersion("4.1.0-rc.4", ["4.1.0-rc.4"])).toBe("4.1.0-rc.4.1");
  });

  test("stable base returns -revision.1 when already published", () => {
    expect(resolvePublishVersion("4.2.0", ["4.2.0"])).toBe("4.2.0-revision.1");
  });

  test("stable base returns -revision.2 when -revision.1 already published", () => {
    expect(resolvePublishVersion("4.2.0", ["4.2.0", "4.2.0-revision.1"])).toBe("4.2.0-revision.2");
  });

  test("stable base unchanged when not yet published", () => {
    expect(resolvePublishVersion("4.3.0", [])).toBe("4.3.0");
  });

  test("stable base does not confuse prereleases with revisions", () => {
    expect(resolvePublishVersion("4.2.0", ["4.2.0", "4.2.0-rc.1", "4.2.0-rc.2"])).toBe(
      "4.2.0-revision.1",
    );
  });
});

describe("resolvePackageVersion", () => {
  test("aztec-derived packages suffix a republished base", () => {
    expect(resolvePackageVersion(aztecDerived, "4.2.0", ["4.2.0"])).toBe("4.2.0-revision.1");
  });

  test("manifest packages publish verbatim exactly once and are never suffixed", () => {
    expect(resolvePackageVersion(manifestMode, "1.0.0", ["0.9.0"])).toBe("1.0.0");
    expect(() => resolvePackageVersion(manifestMode, "1.0.0", ["1.0.0"])).toThrow(
      "@alejoamiras/presto-core@1.0.0 is already on npm; bump the manifest version",
    );
  });
});

describe("baseVersionFor", () => {
  test("an explicit argument wins for every mode", () => {
    expect(baseVersionFor(aztecDerived, { version: "0.0.0" }, "5.3.0")).toBe("5.3.0");
    expect(baseVersionFor(manifestMode, { version: "1.0.0" }, "1.1.0")).toBe("1.1.0");
  });

  test("manifest packages read their own version; aztec-derived packages read the stdlib pin", () => {
    expect(baseVersionFor(manifestMode, { version: "1.0.0" })).toBe("1.0.0");
    expect(
      baseVersionFor(aztecDerived, {
        version: "0.0.0",
        dependencies: { "@aztec/stdlib": "5.2.0" },
      }),
    ).toBe("5.2.0");
    expect(() => baseVersionFor(manifestMode, {})).toThrow("has no version");
    expect(() => baseVersionFor(aztecDerived, { version: "0.0.0" })).toThrow("no @aztec/stdlib");
  });
});

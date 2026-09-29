import { expect, test } from "bun:test";
import { legacyGate, publishedFor } from "./install-legacy-sdk";

test("the legacy gate runs on one Aztec version and sleeps on any other", () => {
  expect(legacyGate("6.0.0-rc.1", "6.0.0-rc.1")).toBeUndefined();
  expect(legacyGate("5.2.0", "6.0.0-rc.1")).toBe(
    "targets Aztec 5.2.0; the workspace targets 6.0.0-rc.1",
  );
  expect(legacyGate("6.0.0-rc.1", "6.0.0-rc.2")).toBe(
    "targets Aztec 6.0.0-rc.1; the workspace targets 6.0.0-rc.2",
  );
});

test("a publication is built for an Aztec version only as its base or a revision of it", () => {
  const versions = ["5.2.0", "5.2.0-revision.5", "6.0.0-rc.1", "6.0.0-rc.10", "6.0.0-rc.1.2"];
  expect(publishedFor(versions, "6.0.0-rc.1")).toEqual(["6.0.0-rc.1", "6.0.0-rc.1.2"]);
  expect(publishedFor(versions, "5.2.0")).toEqual(["5.2.0", "5.2.0-revision.5"]);
  expect(publishedFor(versions, "6.0.0-rc.2")).toEqual([]);
});

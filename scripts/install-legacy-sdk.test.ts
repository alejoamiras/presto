import { expect, test } from "bun:test";
import { legacyGate } from "./install-legacy-sdk";

test("the legacy gate runs on one Aztec version and sleeps on any other", () => {
  expect(legacyGate("6.0.0-rc.1", "6.0.0-rc.1")).toBeUndefined();
  expect(legacyGate("5.2.0", "6.0.0-rc.1")).toBe(
    "targets Aztec 5.2.0; the workspace targets 6.0.0-rc.1",
  );
  expect(legacyGate("6.0.0-rc.1", "6.0.0-rc.2")).toBe(
    "targets Aztec 6.0.0-rc.1; the workspace targets 6.0.0-rc.2",
  );
});

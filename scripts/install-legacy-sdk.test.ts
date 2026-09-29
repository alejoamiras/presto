import { expect, test } from "bun:test";
import { legacyGate } from "./install-legacy-sdk";

test("the legacy gate runs on one protocol, sleeps across a major, and refuses a stale fixture", () => {
  expect(legacyGate("5.2.0", "5.2.0")).toBeUndefined();
  expect(legacyGate("5.2.0", "6.0.0-rc.1")).toBe(
    "targets Aztec 5.2.0; the workspace targets 6.0.0-rc.1",
  );
  expect(() => legacyGate("5.1.0", "5.2.0")).toThrow("same Aztec protocol version");
  expect(() => legacyGate("6.0.0-rc.1", "6.0.0")).toThrow("same Aztec protocol version");
});

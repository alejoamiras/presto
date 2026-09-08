import { expect, test } from "bun:test";
import { assertCorePin, CORE_NAME, expectedCoreVersion } from "./assert-core-pin";

const core = { name: CORE_NAME, version: "1.0.0" };

test("an exact pin must equal the installed core; a workspace range accepts it", () => {
  expect(assertCorePin({ dependencies: { [CORE_NAME]: "1.0.0" } }, core)).toBe("1.0.0");
  expect(assertCorePin({ dependencies: { [CORE_NAME]: "workspace:*" } }, core)).toBe("1.0.0");
  expect(() => assertCorePin({ dependencies: { [CORE_NAME]: "1.0.1" } }, core)).toThrow(
    "pins @alejoamiras/presto-core@1.0.1 but 1.0.0 is installed",
  );
});

test("a missing dependency, a range, or a foreign core manifest fails closed", () => {
  expect(() => expectedCoreVersion(undefined)).toThrow("does not depend on");
  expect(() => expectedCoreVersion("^1.0.0")).toThrow("not an exact version");
  expect(() => expectedCoreVersion("latest")).toThrow("not an exact version");
  expect(() =>
    assertCorePin({ dependencies: { [CORE_NAME]: "1.0.0" } }, { name: "other", version: "1.0.0" }),
  ).toThrow("is not @alejoamiras/presto-core");
});

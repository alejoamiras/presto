import { expect, test } from "bun:test";
import { assertLocalDependency, tarballIntegrity } from "./assert-local-dependency";

const core = "@alejoamiras/presto-core";
const supplied = tarballIntegrity(new TextEncoder().encode("the packed core"));
const other = tarballIntegrity(new TextEncoder().encode("a different archive"));
const root = `node_modules/${core}`;
const nested = `node_modules/@alejoamiras/presto/node_modules/${core}`;

test("one installation whose integrity is the supplied tarball's passes", () => {
  const lock = { packages: { [root]: { version: "1.0.0", integrity: supplied } } };
  expect(assertLocalDependency(lock, core, supplied)).toBe("1.0.0");
  expect(tarballIntegrity(new Uint8Array())).toMatch(/^sha512-[A-Za-z0-9+/]+={0,2}$/);
});

test("a second copy nested beneath the candidate fails, even with the tarball at the root", () => {
  const lock = {
    packages: {
      [root]: { version: "1.1.0", integrity: supplied },
      [nested]: { version: "1.0.0", integrity: other },
    },
  };
  expect(() => assertLocalDependency(lock, core, supplied)).toThrow("installed 2 times");
  expect(() => assertLocalDependency({ packages: {} }, core, supplied)).toThrow(
    "installed 0 times",
  );
});

test("the same name and version from different bytes is not the supplied tarball", () => {
  const lock = { packages: { [root]: { version: "1.0.0", integrity: other } } };
  expect(() => assertLocalDependency(lock, core, supplied)).toThrow("not the supplied tarball's");
  expect(() =>
    assertLocalDependency({ packages: { [root]: { version: "1.0.0" } } }, core, supplied),
  ).toThrow("integrity (none)");
});

import { expect, test } from "bun:test";
import { assertLocalDependency, installations } from "./assert-local-dependency";

const core = "@alejoamiras/presto-core";
const tarball = "/tmp/candidate/alejoamiras-presto-core-1.0.0.tgz";
const local = { version: "1.0.0", resolved: `file:../candidate/${tarball.split("/").at(-1)}` };

test("one installation resolved from the supplied tarball passes; a deduped reference is not a copy", () => {
  const tree = {
    dependencies: {
      "@alejoamiras/presto": {
        version: "0.0.1-tarball-ci",
        resolved: "file:../p.tgz",
        // What npm prints under a dependant satisfied by the root copy.
        dependencies: { [core]: { version: "1.0.0" } },
      },
      [core]: local,
    },
  };
  expect(installations(tree, core)).toHaveLength(1);
  expect(assertLocalDependency(tree, core, tarball)).toBe("1.0.0");
});

test("a registry copy nested beneath the candidate fails, even with the tarball at the root", () => {
  const tree = {
    dependencies: {
      "@alejoamiras/presto": {
        version: "0.0.1-tarball-ci",
        dependencies: {
          [core]: {
            version: "1.0.0",
            resolved: "https://registry.npmjs.org/@alejoamiras/presto-core/-/presto-core-1.0.0.tgz",
          },
        },
      },
      [core]: { version: "1.1.0", resolved: `file:../candidate/other.tgz` },
    },
  };
  expect(installations(tree, core)).toHaveLength(2);
  expect(() => assertLocalDependency(tree, core, tarball)).toThrow("installed 2 times");
  expect(() =>
    assertLocalDependency(
      { dependencies: { [core]: { version: "1.0.0", resolved: "https://registry.npmjs.org/x" } } },
      core,
      tarball,
    ),
  ).toThrow("not /tmp/candidate");
  expect(() => assertLocalDependency({}, core, tarball)).toThrow("installed 0 times");
});

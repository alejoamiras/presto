import { expect, test } from "bun:test";
import { parseNpmPackResult } from "./npm-pack-result";

const entry = {
  name: "@alejoamiras/presto",
  version: "5.2.0",
  filename: "alejoamiras-presto-5.2.0.tgz",
  integrity: `sha512-${Buffer.alloc(64).toString("base64")}`,
};

test("npm 11 arrays and npm 12 package-keyed objects identify the same tarball", () => {
  const expected = { filename: entry.filename, integrity: entry.integrity };
  expect(parseNpmPackResult([entry], entry.name, entry.version)).toEqual(expected);
  expect(parseNpmPackResult({ [entry.name]: entry }, entry.name, entry.version)).toEqual(expected);
});

test("malformed, multiple, or differently named package results fail closed", () => {
  for (const value of [null, 42, "text", [], {}, [entry, entry], { wrong: entry }, { [entry.name]: entry, other: entry }, [null], ["text"], [[]]]) {
    expect(() => parseNpmPackResult(value, entry.name, entry.version)).toThrow();
  }
  for (const changed of [{ ...entry, name: "other" }, { ...entry, version: "6.0.0" }]) {
    expect(() => parseNpmPackResult([changed], entry.name, entry.version)).toThrow("identity");
  }
});

test("unsafe tarball paths and absent SHA-512 metadata are rejected", () => {
  for (const filename of ["../outside.tgz", "/tmp/outside.tgz", "dir/file.tgz", "dir\\file.tgz", ".hidden.tgz", "file.zip", "file.tgz\0", "", null]) {
    expect(() => parseNpmPackResult([{ ...entry, filename }], entry.name, entry.version)).toThrow("filename");
  }
  for (const integrity of [null, "", "sha1-abc", "sha512-*"]) {
    expect(() => parseNpmPackResult([{ ...entry, integrity }], entry.name, entry.version)).toThrow("SHA-512");
  }
});

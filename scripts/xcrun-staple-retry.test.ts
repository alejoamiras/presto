import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SHIM = resolve(import.meta.dir, "../.github/scripts/xcrun-staple-retry.sh");

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * Installs the shim as an executable `xcrun` first on PATH, as the release build does, and runs
 * `xcrun` by name from a `bundle` directory over a fake real xcrun that logs each call with its
 * working directory. Its `stapler staple` fails until call number `stapleOkFrom`, and
 * `stapler validate` fails for the first `validateFails` calls.
 */
function shim(args: string[], { stapleOkFrom = 1, validateFails = 0, attempts = 6 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "xcrun-shim-"));
  dirs.push(dir);
  const real = join(dir, "real-xcrun");
  writeFileSync(
    real,
    `#!/usr/bin/env bash
echo "$(basename "$PWD"): $*" >>"${dir}/calls"
n() { local c; c=$(cat "${dir}/$1" 2>/dev/null || echo 0); echo $((c + 1)) | tee "${dir}/$1"; }
case "$1 $2" in
  "stapler staple") [ "$(n staples)" -ge ${stapleOkFrom} ] ;;
  "stapler validate") [ "$(n validations)" -gt ${validateFails} ] ;;
  *) exit 7 ;;
esac
`,
    { mode: 0o755 },
  );
  const bin = join(dir, "bin");
  const bundle = join(dir, "bundle");
  mkdirSync(bin);
  mkdirSync(bundle);
  copyFileSync(SHIM, join(bin, "xcrun"));
  chmodSync(join(bin, "xcrun"), 0o755);
  const proc = Bun.spawnSync(["xcrun", ...args], {
    cwd: bundle,
    env: {
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      XCRUN_REAL: real,
      STAPLE_LOG: join(dir, "log"),
      STAPLE_ATTEMPTS: String(attempts),
      STAPLE_DELAY: "0",
    },
  });
  const read = (name: string) => {
    try {
      return readFileSync(join(dir, name), "utf8").split("\n").filter(Boolean);
    } catch {
      return [];
    }
  };
  return { code: proc.exitCode, calls: read("calls"), log: read("log") };
}

describe("xcrun staple retry shim", () => {
  test("passes every other xcrun call through untouched, exit code included", () => {
    const r = shim(["notarytool", "submit", "Presto.zip", "--wait"]);
    expect(r).toEqual({ code: 7, calls: ["bundle: notarytool submit Presto.zip --wait"], log: [] });
  });

  test("retries a failed staple, and a staple whose ticket does not validate, until it does", () => {
    const r = shim(["stapler", "staple", "-v", "Presto.app"], {
      stapleOkFrom: 2,
      validateFails: 1,
    });
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([
      "bundle: stapler staple -v Presto.app",
      "bundle: stapler staple -v Presto.app",
      "bundle: stapler validate Presto.app",
      "bundle: stapler staple -v Presto.app",
      "bundle: stapler validate Presto.app",
    ]);
    expect(r.log.at(-1)).toBe("stapled Presto.app on attempt 3");
  });

  test("gives up with a failure after the attempt budget", () => {
    const r = shim(["stapler", "staple", "-v", "Presto.app"], { stapleOkFrom: 99, attempts: 3 });
    expect(r.code).toBe(1);
    expect(r.calls).toEqual(Array(3).fill("bundle: stapler staple -v Presto.app"));
    expect(r.log.at(-1)).toBe("staple attempt 3/3 failed for Presto.app");
  });
});

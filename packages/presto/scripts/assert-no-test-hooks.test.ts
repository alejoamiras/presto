import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const SCRIPT = path.join(import.meta.dir, "assert-no-test-hooks.sh");
const dir = mkdtempSync(path.join(tmpdir(), "no-test-hooks-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function run(...targets: string[]): { code: number; out: string } {
  const r = Bun.spawnSync(["bash", SCRIPT, ...targets]);
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
}

function file(name: string, body: string | Uint8Array): string {
  const p = path.join(dir, name);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, body);
  return p;
}

/** A stand-in AppImage: `--appimage-extract` unpacks one binary into `squashfs-root/usr/bin`. */
function appImage(name: string, payload: string): string {
  const p = file(
    name,
    `#!/usr/bin/env bash\n[ "$1" = --appimage-extract ] || exit 3\nmkdir -p squashfs-root/usr/bin\nprintf '%s' '${payload}' > squashfs-root/usr/bin/Presto\n`,
  );
  chmodSync(p, 0o755);
  return p;
}

describe("assert-no-test-hooks", () => {
  test("passes clean binaries, bundles and AppImages", () => {
    const clean = file("clean/Presto", new Uint8Array([0, 1, 2, 80, 82, 69]));
    const bundle = file("Clean.app/Contents/MacOS/Presto", "release bytes");
    const r = run(
      clean,
      path.dirname(path.dirname(path.dirname(bundle))),
      appImage("clean.AppImage", "ok"),
    );
    expect(r.code, r.out).toBe(0);
  });

  test("fails on the hook's name anywhere in a binary, a bundle or an AppImage's payload", () => {
    const binary = file(
      "hooked/Presto",
      Buffer.concat([Buffer.from([0, 0]), Buffer.from("PRESTO_E2E_TRAY_REPORT")]),
    );
    const bundle = file("Hooked.app/Contents/Resources/lib", "x PRESTO_E2E_TRAY_REPORT y");
    for (const target of [
      binary,
      path.dirname(path.dirname(bundle)),
      appImage("hooked.AppImage", "PRESTO_E2E_TRAY_REPORT"),
    ]) {
      const r = run(target);
      expect(r.code, target).toBe(1);
      expect(r.out).toContain("contains PRESTO_E2E_TRAY_REPORT");
    }
  });

  test("fails on a missing path and on no arguments", () => {
    expect(run(path.join(dir, "absent")).code).toBe(1);
    expect(run().code).toBe(2);
  });
});

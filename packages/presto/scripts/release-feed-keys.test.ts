import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assertPut, candidateStanding, keyFor, VERSION } from "./release-feed-keys";

const feed = (version: unknown) => JSON.stringify({ version, platforms: {} });
const SCRIPT = path.join(import.meta.dir, "release-feed-keys.ts");

describe("release feed keys", () => {
  test("a version's key follows its grammar, which the Worker serving the keys shares", () => {
    expect(keyFor("1.3.0")).toBe("latest.json");
    expect(keyFor("1.3.0-rc.10")).toBe("latest-rc.json");
    for (const bad of ["1.3.0-beta.1", "01.3.0", "1.3.0-rc.01", "1.3.0+build.7", "1.3", ""]) {
      expect(() => keyFor(bad), bad).toThrow("is not X.Y.Z or X.Y.Z-rc.N");
    }
    const worker = fs.readFileSync(
      path.join(import.meta.dir, "../../release-feed/src/index.ts"),
      "utf8",
    );
    expect(worker).toContain(`const VERSION = ${VERSION};`);
  });

  test("a feed may be written only to its own version's key", () => {
    expect(() => assertPut("latest.json", feed("1.3.0"))).not.toThrow();
    expect(() => assertPut("latest-rc.json", feed("1.3.0-rc.1"))).not.toThrow();
    expect(() => assertPut("latest.json", feed("1.3.0-rc.1"))).toThrow(
      "does not belong in latest.json",
    );
    expect(() => assertPut("latest-rc.json", feed("1.3.0"))).toThrow(
      "does not belong in latest-rc.json",
    );
    expect(() => assertPut("verified-sites.json", feed("1.3.0"))).toThrow("is not a feed key");
    expect(() => assertPut("latest.json", "not json")).toThrow();
    expect(() => assertPut("latest.json", feed(5))).toThrow("no string version");
  });

  test("a candidate stands above a stable only by its X.Y.Z, compared as numbers", () => {
    expect(candidateStanding("1.2.0", null)).toBe("absent");
    expect(candidateStanding("1.2.0", feed("1.3.0-rc.1"))).toBe("above");
    expect(candidateStanding("1.9.0", feed("1.10.0-rc.1"))).toBe("above");
    expect(candidateStanding("1.3.0", feed("1.3.0-rc.4"))).toBe("below");
    expect(candidateStanding("1.10.0", feed("1.9.0-rc.2"))).toBe("below");
    for (const text of ["not json", "null", feed(undefined), feed("1.4.0"), feed("1.4.0-beta.1")]) {
      expect(candidateStanding("1.3.0", text), text).toBe("unreadable");
    }
    expect(() => candidateStanding("1.3.0-rc.1", null)).toThrow("is not a stable version");
  });

  test("the command line prints the decision, and fails with an Actions error otherwise", () => {
    const work = fs.mkdtempSync(path.join(tmpdir(), "release-feed-keys-"));
    try {
      const rc = path.join(work, "latest-rc.json");
      fs.writeFileSync(rc, feed("1.3.0-rc.2"));
      const run = (...args: string[]) => {
        const r = Bun.spawnSync(["bun", SCRIPT, ...args]);
        return [r.exitCode, r.stdout.toString().trim(), r.stderr.toString().trim()];
      };
      expect(run("key", "1.3.0-rc.2")).toEqual([0, "latest-rc.json", ""]);
      expect(run("check-put", "latest-rc.json", rc)).toEqual([0, "", ""]);
      expect(run("standing", "1.2.0", rc)).toEqual([0, "above", ""]);
      expect(run("standing", "1.2.0", "-")).toEqual([0, "absent", ""]);
      const [code, , error] = run("check-put", "latest.json", rc);
      expect([code, error]).toEqual([1, "::error::1.3.0-rc.2 does not belong in latest.json"]);
      expect(run("key")[0]).toBe(1);
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  });
});

import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkSchedule, MAX_SCHEDULE_BYTES } from "./assert-update-schedule";

const N = "9.9.9";
const SINCE = 1_900_000_000;
const NOW = SINCE + 30;
const expected = { by: N, since: SINCE, now: NOW };

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const file = (fields: Record<string, unknown>) =>
  encode({ schema: 1, last_checked_by: N, last_checked_at: SINCE + 10, ...fields });
const reason = (bytes: Uint8Array | undefined) => {
  const verdict = checkSchedule(bytes, expected);
  return verdict.ok ? "ok" : verdict.reason;
};

describe("checkSchedule", () => {
  test("fresh: N's own check since N first answered, within the slack at both ends", () => {
    expect(checkSchedule(file({}), expected)).toEqual({ ok: true, checkedAt: SINCE + 10 });
    expect(reason(file({ last_checked_at: SINCE - 5 }))).toBe("ok");
    expect(reason(file({ last_checked_at: NOW + 120 }))).toBe("ok");
    expect(reason(file({ snooze: { version: N, until: NOW + 86_400 }, extra: true }))).toBe("ok");
  });

  test("missing", () => {
    expect(reason(undefined)).toContain("does not exist");
  });

  test("stale: a check before N first answered", () => {
    expect(reason(file({ last_checked_at: SINCE - 6 }))).toContain("predates");
  });

  test("future: a timestamp beyond the clock-skew allowance", () => {
    expect(reason(file({ last_checked_at: NOW + 121 }))).toContain("ahead of now");
  });

  test("garbage: not JSON, not UTF-8, not an object, or a non-integer time", () => {
    expect(reason(new TextEncoder().encode("{schema:1"))).toContain("not UTF-8 JSON");
    expect(reason(new Uint8Array([0xff, 0xfe, 0x7b, 0x7d]))).toContain("not UTF-8 JSON");
    for (const doc of [null, [], 1, "x"])
      expect(reason(encode(doc))).toContain("not a JSON object");
    for (const at of [SINCE + 0.5, String(SINCE), null, undefined]) {
      expect(reason(file({ last_checked_at: at }))).toContain("not an integer");
    }
  });

  test("schema 2 or none", () => {
    expect(reason(file({ schema: 2 }))).toContain("schema is 2");
    expect(reason(file({ schema: undefined }))).toContain("schema is undefined");
  });

  test("oversized: the app's 4 KiB cap", () => {
    const pad = (total: number) => {
      const base = JSON.stringify({ schema: 1, last_checked_by: N, last_checked_at: SINCE, p: "" });
      return file({ last_checked_at: SINCE, p: "x".repeat(total - base.length) });
    };
    expect(pad(MAX_SCHEDULE_BYTES)).toHaveLength(MAX_SCHEDULE_BYTES);
    expect(reason(pad(MAX_SCHEDULE_BYTES))).toBe("ok");
    expect(reason(pad(MAX_SCHEDULE_BYTES + 1))).toContain("over 4096");
  });

  test("written by N-1: a fresh check from the old build does not count", () => {
    expect(reason(file({ last_checked_by: "0.0.1" }))).toContain('last_checked_by is "0.0.1"');
    expect(reason(file({ last_checked_by: undefined }))).toContain("last_checked_by is undefined");
    expect(reason(file({ last_checked_by: `${N}-rc.1` }))).toContain("last_checked_by");
  });
});

describe("assert-update-schedule CLI", () => {
  const script = join(import.meta.dir, "assert-update-schedule.ts");
  const dir = mkdtempSync(join(tmpdir(), "assert-update-schedule-"));
  const run = (path: string, wait: string, since = String(Math.floor(Date.now() / 1000))) =>
    Bun.spawn(["bun", script, path, "--by", N, "--since", since, "--wait", wait], {
      stdout: "pipe",
      stderr: "pipe",
    });

  test("waits for the app's write, then passes", async () => {
    const path = join(dir, "late.json");
    const proc = run(path, "10");
    await Bun.sleep(1500);
    writeFileSync(path, file({ last_checked_at: Math.floor(Date.now() / 1000) }));
    expect(await proc.exited).toBe(0);
    expect(await new Response(proc.stdout).text()).toContain(`checked by ${N}`);
  });

  test("fails with the last reason once the wait runs out, and rejects bad arguments", async () => {
    const missing = run(join(dir, "never.json"), "0");
    expect(await missing.exited).toBe(1);
    expect(await new Response(missing.stderr).text()).toContain("does not exist");
    expect(await run(join(dir, "x.json"), "-1").exited).toBe(2);
    expect(await run(join(dir, "x.json"), "5", "soon").exited).toBe(2);
  });
});

/**
 * Asserts that the desktop app recorded an update check of its own in `~/.presto/update-schedule.json`.
 *
 * The updater smokes run this once N first answers `/health`. N-1 writes the same file before it
 * installs, so only `--by N` with `--since` at N's first answer attributes the write to N.
 *
 * Usage:
 *   bun assert-update-schedule.ts <file> --by <version> --since <unix-seconds> --wait <seconds>
 */
import { readFileSync } from "node:fs";

/** The app refuses a larger file, so the smoke does too. */
export const MAX_SCHEDULE_BYTES = 4096;
/** The app samples its clock after the check; `--since` is sampled by a poll loop. */
const SINCE_SLACK_SECS = 5;
const FUTURE_SLACK_SECS = 120;

export type Verdict = { ok: true; checkedAt: number } | { ok: false; reason: string };

export interface Expectation {
  by: string;
  since: number;
  now: number;
}

/** `bytes` is `undefined` when the file does not exist. */
export function checkSchedule(bytes: Uint8Array | undefined, expected: Expectation): Verdict {
  if (bytes === undefined) return { ok: false, reason: "the file does not exist" };
  if (bytes.length > MAX_SCHEDULE_BYTES) {
    return { ok: false, reason: `the file is ${bytes.length} bytes, over ${MAX_SCHEDULE_BYTES}` };
  }
  let doc: unknown;
  try {
    doc = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return { ok: false, reason: "the file is not UTF-8 JSON" };
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    return { ok: false, reason: "the file is not a JSON object" };
  }
  const { schema, last_checked_at: at, last_checked_by: by } = doc as Record<string, unknown>;
  if (schema !== 1) return { ok: false, reason: `schema is ${JSON.stringify(schema)}, not 1` };
  if (by !== expected.by) {
    return {
      ok: false,
      reason: `last_checked_by is ${JSON.stringify(by)}, not ${JSON.stringify(expected.by)}`,
    };
  }
  if (typeof at !== "number" || !Number.isSafeInteger(at)) {
    return { ok: false, reason: `last_checked_at is ${JSON.stringify(at)}, not an integer` };
  }
  if (at < expected.since - SINCE_SLACK_SECS) {
    return { ok: false, reason: `last_checked_at ${at} predates --since ${expected.since}` };
  }
  if (at > expected.now + FUTURE_SLACK_SECS) {
    return { ok: false, reason: `last_checked_at ${at} is ahead of now (${expected.now})` };
  }
  return { ok: true, checkedAt: at };
}

function readIfPresent(path: string): Uint8Array | undefined {
  try {
    return readFileSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function flag(args: string[], name: string): string {
  const i = args.indexOf(`--${name}`);
  const value = i === -1 ? undefined : args[i + 1];
  if (value === undefined || value === "") throw new Error(`missing --${name}`);
  return value;
}

function nonNegativeInteger(value: string, name: string): number {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error(`--${name} must be a non-negative integer`);
  return Number(value);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const file = args[0];
  let by: string;
  let since: number;
  let waitSecs: number;
  try {
    if (file === undefined || file.startsWith("--")) throw new Error("missing <file>");
    by = flag(args, "by");
    since = nonNegativeInteger(flag(args, "since"), "since");
    waitSecs = nonNegativeInteger(flag(args, "wait"), "wait");
  } catch (error) {
    console.error(`assert-update-schedule: ${(error as Error).message}`);
    process.exit(2);
  }
  const deadline = Date.now() + waitSecs * 1000;
  for (;;) {
    const verdict = checkSchedule(readIfPresent(file), {
      by,
      since,
      now: Math.floor(Date.now() / 1000),
    });
    if (verdict.ok) {
      console.log(`update schedule: checked by ${by} at ${verdict.checkedAt} (since ${since})`);
      process.exit(0);
    }
    if (Date.now() >= deadline) {
      console.error(
        `::error::${by} did not record its update check within ${waitSecs}s: ${verdict.reason}`,
      );
      process.exit(1);
    }
    await Bun.sleep(1000);
  }
}

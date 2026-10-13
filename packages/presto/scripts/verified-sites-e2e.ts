/**
 * What the WebDriver verified-sites feed serves and what its spec expects, shared by both. The spec
 * runs under Node, so this module stays runtime-neutral: no Bun API, no signing.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/** The origin the feed's lists add and remove; no shipped list names it. */
export const E2E_ORIGIN = "https://verified-sites-e2e.example.com";
export const E2E_NAME = "Presto E2E";
/** Names the feed's state file for the spec; the app never reads it. */
export const FEED_STATE_ENV = "VERIFIED_SITES_E2E_FEED_STATE";
export const HISTORY_DIR = path.join(import.meta.dirname, "..", "verified-sites", "history");

export const MODES = ["none", "with", "without", "tampered"] as const;
export type Mode = (typeof MODES)[number];
export type ServedMode = Exclude<Mode, "none">;

/** Above any real record, and ordered so each step's list outranks the one before it. */
export const VERSIONS: Record<ServedMode, number> = {
  with: 9_000_000_001,
  without: 9_000_000_002,
  tampered: 9_000_000_003,
};

/** The feed's state file. `url` is the list endpoint the app polls, `control` switches what it serves. */
export interface FeedState {
  url: string;
  pubkey: string;
  control: string;
  pid: number;
}

/** `GET /control`: the mode being served and how many list requests each mode has answered. */
export interface ControlStatus {
  serve: Mode;
  served: Record<Mode, number>;
}

interface Entry {
  origins: string[];
  displayName: string;
  [field: string]: unknown;
}

interface List {
  version: number;
  entries: Entry[];
  [field: string]: unknown;
}

/** The newest history record's bytes: the list the app was built with. Throws when there is none. */
export function newestRecord(dir = HISTORY_DIR): Uint8Array {
  const versions = readdirSync(dir)
    .map((name) => /^([1-9][0-9]*)\.json$/.exec(name)?.[1])
    .filter((v): v is string => v !== undefined)
    .map(Number);
  if (versions.length === 0) throw new Error(`no history record in ${dir}`);
  return new Uint8Array(readFileSync(path.join(dir, `${Math.max(...versions)}.json`)));
}

function parse(record: Uint8Array): List {
  return JSON.parse(new TextDecoder().decode(record)) as List;
}

/** The built-in list's first origin and its name, which the `with` list drops; null for an empty list. */
export function firstBuiltIn(record: Uint8Array): { origin: string; name: string } | null {
  const [first] = parse(record).entries;
  const origin = first?.origins[0];
  return first && origin ? { origin, name: first.displayName } : null;
}

function encode(list: List): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(list, null, 2)}\n`);
}

/**
 * The unsigned lists behind each served mode, built from the newest record so that every other entry
 * stays as the app knows it. `with` drops the built-in's first origin and adds {@link E2E_ORIGIN};
 * `without` and `tampered` are `with` minus that entry, at their own versions.
 */
export function feedLists(record: Uint8Array): Record<ServedMode, Uint8Array> {
  const base = parse(record);
  const dropped = firstBuiltIn(record)?.origin;
  const kept = base.entries
    .map((e) => ({ ...e, origins: e.origins.filter((o) => o !== dropped) }))
    .filter((e) => e.origins.length > 0);
  const e2e: Entry = {
    origins: [E2E_ORIGIN],
    displayName: E2E_NAME,
    curatedBy: "alejoamiras",
    addedAt: "2026-10-13",
  };
  return {
    with: encode({ ...base, version: VERSIONS.with, entries: [...kept, e2e] }),
    without: encode({ ...base, version: VERSIONS.without, entries: kept }),
    tampered: encode({ ...base, version: VERSIONS.tampered, entries: kept }),
  };
}

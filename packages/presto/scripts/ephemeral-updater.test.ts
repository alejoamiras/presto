import { afterEach, expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const SCRIPT = path.join(import.meta.dir, "ephemeral-updater.sh");
const SRC = path.resolve(import.meta.dir, "..", "src-tauri");
const PUBKEY = "dGVzdCBwdWJrZXk=";

let dir = "";
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});

/** A scratch src-tauri holding copies of the real Cargo.toml and tauri.conf.json. */
function scratch(): string {
  dir = mkdtempSync(path.join(tmpdir(), "ephemeral-updater-"));
  for (const file of ["Cargo.toml", "tauri.conf.json"]) {
    copyFileSync(path.join(SRC, file), path.join(dir, file));
  }
  return dir;
}

function run(...args: string[]) {
  const proc = Bun.spawnSync(["bash", SCRIPT, ...args], {
    env: { ...process.env, EPHEMERAL_PUBKEY: PUBKEY },
  });
  return { code: proc.exitCode, output: `${proc.stdout}${proc.stderr}` };
}

test("stamp sets the package version and the config's version and pubkey, and nothing else", () => {
  const src = scratch();
  const cargo = readFileSync(path.join(src, "Cargo.toml"), "utf8").split("\n");
  const conf = JSON.parse(readFileSync(path.join(src, "tauri.conf.json"), "utf8"));

  expect(run("stamp", "9.9.9-rc.1", src).code).toBe(0);

  const stamped = readFileSync(path.join(src, "Cargo.toml"), "utf8").split("\n");
  const changed = stamped.flatMap((line, i) => (line === cargo[i] ? [] : [line]));
  expect(changed).toEqual(['version = "9.9.9-rc.1"']);
  expect(stamped).toHaveLength(cargo.length);
  conf.version = "9.9.9-rc.1";
  conf.plugins.updater.pubkey = PUBKEY;
  expect(JSON.parse(readFileSync(path.join(src, "tauri.conf.json"), "utf8"))).toEqual(conf);
  expect(readdirSync(src).sort()).toEqual(["Cargo.toml", "tauri.conf.json"]);
});

test("a version outside the SemVer alphabet is refused before any file changes", () => {
  const src = scratch();
  const before = readFileSync(path.join(src, "Cargo.toml"), "utf8");
  const result = run("stamp", '9.9.9/"e', src);
  expect(result.code).toBe(2);
  expect(readFileSync(path.join(src, "Cargo.toml"), "utf8")).toBe(before);
});

test("an unknown command or role exits 2 without echoing it", () => {
  for (const args of [["::warning::smuggled"], ["build", "::warning::smuggled", "9.9.9", "/tmp"]]) {
    const result = run(...args);
    expect(result.code).toBe(2);
    expect(result.output).not.toContain("smuggled");
  }
});

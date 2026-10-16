/**
 * The WebDriver-only hooks never reach a shipped build: they sit behind one `cfg`, the feature is
 * never on by default, and no release artifact is built with it. The shipped binaries' own bytes are
 * checked in the updater smokes and in the release build.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const PRESTO = path.resolve(import.meta.dir, "..");
const SRC = path.join(PRESTO, "src-tauri", "src");
const WORKFLOWS = path.resolve(PRESTO, "..", "..", ".github", "workflows");
const GATED = '#[cfg(feature = "webdriver")]';
/** Every variable a WebDriver-only hook reads; the scans' needle is their shared prefix. */
const HOOK_NAMES = [
  "PRESTO_E2E_TRAY_REPORT",
  "PRESTO_E2E_VERIFIED_SITES_URL",
  "PRESTO_E2E_VERIFIED_SITES_PUBKEY",
  "PRESTO_E2E_CUSTOM_BB_PATH",
];

function rustFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".rs"))
    .map((file) => path.join(dir, file));
}

async function text(file: string): Promise<string> {
  return Bun.file(file).text();
}

/** Each line that mentions `needle`, with the non-blank line above it. */
function mentions(source: string, needle: string): { line: string; above: string }[] {
  const lines = source.split("\n");
  return lines.flatMap((line, i) => {
    if (!line.includes(needle)) return [];
    const above = lines
      .slice(0, i)
      .reverse()
      .find((l) => l.trim() !== "");
    return [{ line: line.trim(), above: above?.trim() ?? "" }];
  });
}

const LAST_WEBDRIVER_SPECS = ["tray-update.spec.ts", "developer.spec.ts", "autostart.spec.ts"];

describe("WebDriver-only tray hooks", () => {
  test("K1: the hook module compiles only with the webdriver feature", async () => {
    const main = await text(path.join(SRC, "main.rs"));
    const declarations = mentions(main, "mod e2e_tray;");
    expect(declarations).toEqual([{ line: "mod e2e_tray;", above: GATED }]);
  });

  test("K2: the hooks, the report variable and the short revert live only in e2e_tray.rs", async () => {
    for (const file of rustFiles(SRC)) {
      const name = path.relative(SRC, file);
      if (name === "e2e_tray.rs") continue;
      const source = await text(file);
      expect(source, name).not.toContain("PRESTO_E2E_");
      // A use of the module is gated on its own line, never reachable from a default build.
      for (const { line, above } of mentions(source, "e2e_tray::")) {
        expect(above, `${name}: ${line}`).toBe(GATED);
      }
    }
    const hooks = await text(path.join(SRC, "e2e_tray.rs"));
    expect(HOOK_NAMES.filter((name) => !hooks.includes(name))).toEqual([]);
    expect(hooks).toContain("pub const REVERT: Duration = Duration::from_secs(2);");
  });

  test("K3: no default feature enables webdriver, directly or through another feature", async () => {
    const manifest = Bun.TOML.parse(await text(path.join(PRESTO, "src-tauri", "Cargo.toml"))) as {
      features: Record<string, string[]>;
    };
    const seen = new Set<string>();
    const pending = [...(manifest.features.default ?? [])];
    while (pending.length > 0) {
      const feature = pending.pop() as string;
      if (seen.has(feature)) continue;
      seen.add(feature);
      pending.push(...(manifest.features[feature] ?? []));
    }
    expect(
      [...seen].filter((f) => f === "webdriver" || f.includes("tauri-plugin-webdriver")),
    ).toEqual([]);
  });

  test("K4: only the WebDriver gate builds with the feature, and it uploads no binary", async () => {
    const withFeature: string[] = [];
    for (const file of readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f))) {
      if (/(--features|-F)[ =]["']?[\w,-]*webdriver/.test(await text(path.join(WORKFLOWS, file)))) {
        withFeature.push(file);
      }
    }
    expect(withFeature).toEqual(["_e2e-webdriver.yml"]);

    const uploads = (await steps("_e2e-webdriver.yml")).filter((s) =>
      s.uses?.includes("upload-artifact"),
    );
    expect(uploads.length).toBeGreaterThan(0);
    for (const upload of uploads)
      expect(String(upload.with?.path)).not.toMatch(/target|Presto(\.exe)?\b/);
  });

  // wdio runs only the specs it lists, so an unlisted spec would pass by never running.
  test("L3: wdio lists every WebDriver spec, then the tray, developer and autostart specs last", async () => {
    const conf = await text(path.join(PRESTO, "wdio.conf.ts"));
    const listed = [...conf.matchAll(/"\.\/e2e-webdriver\/([\w-]+\.spec\.ts)"/g)].map((m) => m[1]);
    const files = readdirSync(path.join(PRESTO, "e2e-webdriver")).filter((f) =>
      f.endsWith(".spec.ts"),
    );
    expect([...listed].sort()).toEqual(files.sort());
    expect(listed.slice(-3)).toEqual(LAST_WEBDRIVER_SPECS);
  });

  test("K5: every smoke build is scanned for the hooks, and the WebDriver build proves the scan can fire", async () => {
    for (const workflow of ["smoke-updater-unix.yml", "smoke-updater-windows.yml"]) {
      const builds = (await steps(workflow)).filter((s) =>
        /^Build (synthetic N-1|N) /.test(s.name ?? ""),
      );
      expect(builds.map((s) => s.run?.match(/ephemeral-updater\.sh build (\S+) /)?.[1])).toEqual([
        "n-1",
        "n",
      ]);
    }
    const script = await text(path.join(PRESTO, "scripts", "ephemeral-updater.sh"));
    for (const os of ["macOS", "Linux", "Windows"]) {
      for (const role of ["n-1", "n"]) {
        expect(collectWithFailingScanner(script, os, role), `${os} ${role}`).toEqual([
          "scanned",
          23,
        ]);
      }
    }
    const teeth = (await steps("_e2e-webdriver.yml")).find(
      (s) => s.name === "Assert the WebDriver binary carries the test hooks",
    );
    const run = teeth?.run ?? "";
    expect(teethOver(run, HOOK_NAMES)).toBe(0);
    for (const name of HOOK_NAMES) {
      expect(
        teethOver(
          run,
          HOOK_NAMES.filter((n) => n !== name),
        ),
        name,
      ).toBe(1);
    }
  });
});

describe("WebDriver launchers", () => {
  test("L4: both launchers start the list feed before the app and export every hook variable", async () => {
    const ci = await steps("_e2e-webdriver.yml");
    const names = ci.map((s) => s.name);
    const feed = names.indexOf("Start the verified-sites feed");
    expect(feed).toBeGreaterThan(-1);
    expect(feed).toBeLessThan(names.indexOf("Launch app"));
    const local = await text(path.join(PRESTO, "scripts", "run-webdriver-local.sh"));
    const localLaunch = local.split('setsid "$BIN"')[0] ?? "";
    for (const before of [ci[feed]?.run ?? "", localLaunch]) {
      expect(before).toContain("bun scripts/verified-sites-e2e-feed.ts --state");
    }
    for (const launch of [ci[names.indexOf("Launch app")]?.run ?? "", localLaunch]) {
      for (const name of HOOK_NAMES) {
        expect(launch, name).toMatch(new RegExp(`^\\s*export (\\w+ )*${name}\\b`, "m"));
      }
    }
  });
});

interface Step {
  name?: string;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
}

async function steps(workflow: string): Promise<Step[]> {
  const parsed = Bun.YAML.parse(await text(path.join(WORKFLOWS, workflow))) as {
    jobs: Record<string, { steps?: Step[] }>;
  };
  return Object.values(parsed.jobs).flatMap((job) => job.steps ?? []);
}

/**
 * Runs ephemeral-updater.sh build's per-OS artifact collection for one OS and role, with a scanner
 * that prints "scanned" and fails with 23. Returns [stdout, exit code].
 */
function collectWithFailingScanner(script: string, os: string, role: string): [string, number] {
  const collect = script.split('\n  mkdir -p "$out"\n')[1]?.split("\n  esac\n")[0] ?? "";
  expect(collect).toStartWith('  case "$RUNNER_OS" in\n');
  const stubs =
    'bash() { [[ "$1" == */assert-no-test-hooks.sh ]] && echo scanned; return 23; }; cp() { :; }; n1_dmg() { :; }';
  // A function body, so an early `return` in the block skips the scan as it would in build.
  const run = Bun.spawnSync(
    ["bash", "-c", `set -euo pipefail; ${stubs}; collect() {\n${collect}\n  esac\n}; collect`],
    {
      env: {
        PATH: process.env.PATH,
        RUNNER_OS: os,
        role,
        PRESTO: "p",
        bundle: "b",
        root: "r",
        out: "o",
      },
    },
  );
  return [String(run.stdout).trim(), run.exitCode];
}

/**
 * Runs the WebDriver workflow's teeth step on a stand-in release binary that carries `names`.
 * Returns the step's exit code.
 */
function teethOver(run: string, names: string[]): number {
  const cwd = mkdtempSync(path.join(tmpdir(), "webdriver-teeth-"));
  try {
    mkdirSync(path.join(cwd, "src-tauri/target/release"), { recursive: true });
    writeFileSync(path.join(cwd, "src-tauri/target/release/Presto"), `\0${names.join("\0")}\0`);
    const r = Bun.spawnSync(["bash", "-e", "-c", run], {
      cwd,
      env: { PATH: process.env.PATH, RUNNER_OS: "Linux", MODE: "release" },
    });
    return r.exitCode;
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

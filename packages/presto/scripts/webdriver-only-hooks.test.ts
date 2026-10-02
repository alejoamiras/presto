/**
 * The WebDriver-only tray hooks never reach a shipped build: they sit behind one `cfg`, the feature
 * is never on by default, and no release artifact is built with it. The shipped binaries' own bytes
 * are checked in the updater smokes.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import path from "node:path";

const PRESTO = path.resolve(import.meta.dir, "..");
const SRC = path.join(PRESTO, "src-tauri", "src");
const WORKFLOWS = path.resolve(PRESTO, "..", "..", ".github", "workflows");
const GATED = '#[cfg(feature = "webdriver")]';

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
    expect(hooks).toContain("PRESTO_E2E_TRAY_REPORT");
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
  test("L3: wdio lists every WebDriver spec, the tray spec before autostart", async () => {
    const conf = await text(path.join(PRESTO, "wdio.conf.ts"));
    const listed = [...conf.matchAll(/"\.\/e2e-webdriver\/([\w-]+\.spec\.ts)"/g)].map((m) => m[1]);
    const files = readdirSync(path.join(PRESTO, "e2e-webdriver")).filter((f) =>
      f.endsWith(".spec.ts"),
    );
    expect([...listed].sort()).toEqual(files.sort());
    expect(listed.indexOf("tray-update.spec.ts")).toBe(listed.indexOf("autostart.spec.ts") - 1);
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
    // Both roles share the per-OS collection below; a scan at the branch's top level runs for both.
    const script = await text(path.join(PRESTO, "scripts", "ephemeral-updater.sh"));
    const collect = script.split('\n  mkdir -p "$out"\n')[1]?.split("\n  esac\n")[0] ?? "";
    const branches = collect.split(/\n {4}(?=\w+\)\n)/).slice(1);
    expect(branches.map((b) => b.split(")")[0])).toEqual(["macOS", "Linux", "Windows"]);
    for (const branch of branches) {
      const scans = branch.split("\n").filter((l) => l.includes("assert-no-test-hooks.sh"));
      expect(scans.length, branch).toBe(1);
      expect(scans[0], branch).toStartWith('      bash "$PRESTO/scripts/assert-no-test-hooks.sh" ');
    }
    const teeth = (await steps("_e2e-webdriver.yml")).find((s) =>
      s.run?.includes("grep -qa PRESTO_E2E_TRAY_REPORT"),
    );
    expect(teeth?.name).toBe("Assert the WebDriver binary carries the tray hooks");
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

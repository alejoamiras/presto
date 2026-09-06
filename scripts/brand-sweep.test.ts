/** Product identity and visual regression contracts. Historical audits are immutable. */
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");

const PRODUCT_SURFACES = [
  "packages/presto/src-tauri/frontend/style.css",
  "packages/presto/src-tauri/frontend/onboarding.css",
  "packages/presto/src-tauri/frontend/renewal.css",
  "packages/presto/src-tauri/frontend/onboarding.html",
  "packages/presto/src-tauri/frontend/settings.html",
  "packages/presto/src-tauri/frontend/authorize.html",
  "packages/presto/src-tauri/frontend/update-prompt.html",
  "packages/presto/src-tauri/frontend/renewal.html",
  "packages/landing/index.html",
  "packages/landing/src/style.css",
  "packages/landing/src/main.ts",
  "packages/landing/src/race.ts",
  "packages/playground/index.html",
  "packages/playground/src/style.css",
  "packages/playground/src/main.ts",
  "packages/playground/src/ui.ts",
  "packages/playground/src/results.ts",
  "packages/playground/src/spark-orbit.ts",
];

const RETIRED = [
  "d4ff28",
  "b8dd1e",
  "0b0a06",
  "131008",
  "1a1610",
  "2a2518",
  "f0e8d0",
  "9a9080",
  "0e1400",
  "rgba(212, 255, 40",
  '"Space Grotesk"',
  "Space+Grotesk",
  '"Inter"',
  "family=Inter",
  '"JetBrains Mono"',
  "JetBrains+Mono",
];

/** Permanent identity-bearing literals; changing them after release breaks OS identity. */
const IDENTITY_PRESENT: Record<string, string[]> = {
  "packages/presto/src-tauri/tauri.conf.json": [
    '"productName": "Presto"',
    '"identifier": "build.presto.presto"',
    '"publisher": "Presto"',
    "https://presto.build/releases/latest.json",
    '"copyright": "© 2026 Presto contributors"',
    '"homepage": "https://presto.build"',
  ],
  "packages/presto/src-tauri/Cargo.toml": ['name = "presto"', "Presto"],
  "packages/presto/src-tauri/src/certs.rs": ["Presto Local CA", ".presto"],
  "packages/presto/src-tauri/src/trust/linux.rs": ["presto-ca-"],
  "packages/presto/src-tauri/src/trust/windows.rs": ["Presto Local CA"],
  "packages/presto/src-tauri/src/autostart.rs": ['"Presto"'],
  "packages/presto/src-tauri/src/crash_recovery.rs": ["Presto Crash Recovery"],
  "packages/presto/src-tauri/src/update_marker.rs": ["Presto", '"Presto"'],
  "packages/presto/src-tauri/nsis/hooks.nsi": ["Presto Local CA"],
  "packages/sdk/package.json": ["@alejoamiras/presto"],
  ".github/workflows/release-presto.yml": ["Presto-"],
};


describe("brand sweep", () => {
  test("retired visual values are gone from every product surface", async () => {
    const hits: string[] = [];
    for (const rel of PRODUCT_SURFACES) {
      const text = await Bun.file(join(ROOT, rel)).text();
      for (const pattern of RETIRED) {
        if (text.toLowerCase().includes(pattern.toLowerCase())) hits.push(`${rel}: ${pattern}`);
      }
    }
    expect(hits).toEqual([]);
  });

  test("Presto identity literals are present at their sites", async () => {
    const missing: string[] = [];
    for (const [rel, literals] of Object.entries(IDENTITY_PRESENT)) {
      const text = await Bun.file(join(ROOT, rel)).text();
      for (const lit of literals) {
        if (!text.includes(lit)) missing.push(`${rel}: ${lit}`);
      }
    }
    expect(missing).toEqual([]);
  });

  test("retired operational names occur only in historical audits and the migration guide", async () => {
    const files = Bun.spawnSync(["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: ROOT });
    expect(files.exitCode).toBe(0);
    // Build the retired spelling so the guard does not match its own source.
    const retired = new RegExp("aztec[ _%-]*" + "accelerator|aztec%20" + "accelerator|AZTEC_" + "ACCEL_|\\bAccelerator(?:Prover|Config|Status|Phase|Protocol|HttpError)|accelerator" + "Version", "i");
    const hits: string[] = [];
    const paths = new Set(files.stdout.toString().split("\0").filter(Boolean));
    expect(paths.size).toBeGreaterThan(100);
    expect(paths.has("packages/presto/src-tauri/tauri.conf.json")).toBe(true);
    expect(retired.test("Accelerator" + "Prover")).toBe(true);
    for (const rel of paths) {
      if (rel.startsWith("audit/") || rel === "packages/sdk/MIGRATION.md") continue;
      const path = join(ROOT, rel);
      if (!existsSync(path)) continue; // Staged deletions.
      const bytes = await Bun.file(path).arrayBuffer();
      if (new Uint8Array(bytes).includes(0)) continue; // Binary assets.
      const text = new TextDecoder().decode(bytes);
      if (retired.test(rel) || retired.test(text)) hits.push(rel);
    }
    expect(hits).toEqual([]);
  });
});

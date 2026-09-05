import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const workflow = Bun.YAML.parse(readFileSync(join(root, ".github/workflows/presto-previews.yml"), "utf8")) as {
  jobs: { upload: { steps: Array<{ name?: string; run?: string; uses?: string }> } };
};
const writer = workflow.jobs.upload.steps.find((step) => step.name === "Write fixed preview configuration")?.run;
const script = /node <<'NODE'\n([\s\S]*?)\nNODE/.exec(writer ?? "")?.[1];

test("credentialed previews generate fixed SPA config without reading PR code", () => {
  expect(script).toBeDefined();
  expect(workflow.jobs.upload.steps.some((step) => step.uses?.startsWith("actions/checkout@"))).toBe(false);
  const directory = mkdtempSync(join(tmpdir(), "presto-preview-config-"));
  try {
    for (const site of ["landing", "playground"]) {
      const result = Bun.spawnSync(["node", "-e", script!], {
        env: { ...process.env, SITE: site, RUNNER_TEMP: directory, GITHUB_WORKSPACE: root },
        stdout: "pipe", stderr: "pipe",
      });
      expect(result.exitCode).toBe(0);
      const config = JSON.parse(readFileSync(join(directory, "presto-preview.json"), "utf8"));
      const production = JSON.parse(readFileSync(join(root, `packages/${site}/wrangler.jsonc`), "utf8"));
      expect(config).toEqual({
        name: production.name,
        compatibility_date: production.compatibility_date,
        workers_dev: true,
        preview_urls: true,
        assets: { directory: join(root, "dist"), not_found_handling: production.assets.not_found_handling },
      });
      // Header files ship with the static artifact; they are not read as executable configuration.
      const headers = readFileSync(join(root, `packages/${site}/public/_headers`), "utf8");
      expect(headers).toContain("Cross-Origin-Opener-Policy: same-origin");
      expect(headers).toContain("Cross-Origin-Embedder-Policy: credentialless");
    }
    const rejected = Bun.spawnSync(["node", "-e", script!], {
      env: { ...process.env, SITE: "../foreign-worker", RUNNER_TEMP: directory, GITHUB_WORKSPACE: root },
      stdout: "pipe", stderr: "pipe",
    });
    expect(rejected.exitCode).not.toBe(0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { CRS_FILE, HOST_DEPENDENCY_FILES, PACKAGE_JSON_FILES } from "./update-aztec-version";

const ROOT = path.resolve(import.meta.dir, "..");
const read = (relative: string) => fs.readFileSync(path.join(ROOT, relative), "utf8");
const WORKFLOWS = fs
  .readdirSync(path.join(ROOT, ".github/workflows"))
  .filter((file) => file.endsWith(".yml"))
  .map((file) => [file, read(`.github/workflows/${file}`)] as const);

interface Step {
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, string>;
}
interface Job {
  needs?: string[];
  if?: string;
  steps?: Step[];
}
const app = Bun.YAML.parse(read(".github/workflows/app.yml")) as { jobs: Record<string, Job> };
const filters = Bun.YAML.parse(
  app.jobs.changes?.steps?.find((step) => step.with?.filters)?.with?.filters ?? "",
) as Record<string, string[]>;
const routed = (file: string, filter: string[]) =>
  filter.some((pattern) => new Bun.Glob(pattern).match(file));

/** Repository modules `entry` loads, transitively, by relative import. */
function localModules(entry: string, seen = new Set<string>()): Set<string> {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  for (const { path: specifier } of transpiler.scanImports(read(entry))) {
    if (!specifier.startsWith(".")) continue;
    const target = Bun.resolveSync(specifier, path.join(ROOT, path.dirname(entry)));
    localModules(path.relative(ROOT, target), seen);
  }
  return seen;
}

describe("site deployment contract", () => {
  test("Workers Builds deploys the sites: no workflow deploys them or holds their token", () => {
    const deploys = WORKFLOWS.flatMap(([file, text]) =>
      text
        .split("\n")
        .filter((line) => /wrangler (deploy|preview|versions upload)/.test(line))
        .filter((line) => /packages\/(landing|playground)\//.test(line))
        .filter((line) => !line.includes("--dry-run"))
        .map((line) => `${file}: ${line.trim()}`),
    );
    expect(deploys).toEqual([]);
    for (const [, text] of WORKFLOWS) {
      expect(text).not.toMatch(/CLOUDFLARE_DEPLOY_API_TOKEN|PRESTO_PREVIEWS_ENABLED/);
      expect(text).not.toMatch(/aws-actions|aws s3|cloudfront/i);
    }
  });

  test("both sites serve static assets with Worker Previews and the isolation headers", () => {
    for (const site of ["landing", "playground"]) {
      const config = JSON.parse(read(`packages/${site}/wrangler.jsonc`));
      expect(config.assets).toEqual({
        directory: "./dist",
        not_found_handling: "single-page-application",
      });
      expect(config.preview_urls).toBe(true);
      // Worker Previews refuse to run without this block, even an empty one.
      expect(config.previews).toEqual({});

      const headers = read(`packages/${site}/public/_headers`);
      expect(headers).toContain("Cross-Origin-Opener-Policy: same-origin");
      // Only the playground proves in the page; Safari isolates it under `require-corp` alone.
      const coep = /^\s*Cross-Origin-Embedder-Policy:\s*(\S+)\s*$/im.exec(headers)?.[1];
      expect(coep).toBe(site === "playground" ? "require-corp" : undefined);
    }
  });

  test("a PR runs the production playground build, and App Status depends on it", () => {
    const job = app.jobs["published-build"];
    expect(job?.if).toBe("needs.changes.outputs.published == 'true'");
    const build = job?.steps?.find(
      (step) => step.run === "bun scripts/workers-build.ts playground",
    );
    expect(build?.env).toEqual({ WORKERS_CI_BRANCH: "main" });
    const status = app.jobs["app-status"];
    expect(status?.needs).toContain("published-build");
    expect(status?.steps?.[0]?.run).toContain(`\${{ needs.published-build.result }}`);
  });

  test("the production build is routed on every file it runs, and on none an Aztec bump writes", () => {
    const published = filters.published ?? [];
    const runs = [
      ...localModules("scripts/workers-build.ts"),
      ...localModules("scripts/published-playground.ts"),
      "packages/playground/published-sdk.json",
      ".github/scripts/packaged-e2e-swap-sdk.sh",
      // The swap script depends on the node_modules layout this Bun lays out.
      ".bun-version",
    ];
    expect(runs.filter((file) => !routed(file, published))).toEqual([]);

    // bunfig.toml: an Aztec bump edits its release-age excludes by hand.
    const aztecBump = [
      ...PACKAGE_JSON_FILES,
      ...HOST_DEPENDENCY_FILES,
      CRS_FILE,
      "bun.lock",
      "bunfig.toml",
    ];
    expect(aztecBump.filter((file) => routed(file, published))).toEqual([]);
  });
});

describe("release-feed deployment contract", () => {
  test("only the promote workflow writes the exact verified feed bytes to production KV", () => {
    const release = read(".github/workflows/release-presto.yml");
    expect(release).toContain("wrangler kv key put latest.json --path feed/latest.json --remote");
    expect(release.match(/wrangler kv key put/g)).toHaveLength(1);
    expect(release).toContain("CLOUDFLARE_RELEASE_FEED_API_TOKEN");
    expect(release.match(/environment: release-feed/g)).toHaveLength(2);
  });

  test("the release-feed Worker is deployed independently from feed promotion", () => {
    const deploy = read(".github/workflows/deploy-release-feed.yml");
    expect(deploy).toContain(
      "wrangler versions upload --config packages/release-feed/wrangler.jsonc",
    );
    expect(deploy).toContain(
      'wrangler versions deploy "$VERSION_ID@100%" --yes --config packages/release-feed/wrangler.jsonc',
    );
    expect(deploy).toContain("WRANGLER_OUTPUT_FILE_PATH");
    expect(deploy).toContain('entry.type === "version-upload"');
    expect(deploy).toContain('upload.worker_name !== "presto-release-feed"');
    expect(deploy).not.toContain("wrangler deploy --config");
    expect(deploy).not.toContain("wrangler triggers deploy");
    expect(deploy).toContain("environment: release-feed");
    expect(deploy).toContain("CLOUDFLARE_RELEASE_FEED_DEPLOY_API_TOKEN");
    expect(deploy).not.toContain("CLOUDFLARE_RELEASE_FEED_API_TOKEN");
    expect(deploy).not.toContain("wrangler kv key put");
    expect(deploy).not.toContain("push:");
  });

  test("OpenTofu configuration is gone", () => {
    expect(fs.existsSync(path.join(ROOT, "infra/tofu/providers.tf"))).toBe(false);
    expect(read("package.json")).not.toContain("lint:tofu");
    expect(read(".github/workflows/actionlint.yml")).not.toMatch(/opentofu|\btofu\b/i);
  });
});

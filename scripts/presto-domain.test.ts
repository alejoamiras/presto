import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const text = (path: string) => readFileSync(resolve(root, path), "utf8");
const json = (path: string) => JSON.parse(text(path));

test("the permanent domain and native identity agree before the first RC", () => {
  const identity = json("infra/presto-identity.json");
  const native = json("packages/presto/src-tauri/tauri.conf.json");
  expect(identity.domain).toBe("presto.build");
  expect(native.identifier).toBe("build.presto.presto");
  expect(native.bundle.homepage).toBe("https://presto.build");
  expect(native.plugins.updater.endpoints).toEqual(["https://presto.build/releases/latest.json"]);
});

test("production routes keep all three workers.dev fallback endpoints enabled", () => {
  for (const [site, routes] of [
    ["landing", [{ pattern: "presto.build", custom_domain: true }]],
    ["playground", [{ pattern: "playground.presto.build", custom_domain: true }]],
    ["release-feed", [{ pattern: "presto.build/releases/*", zone_name: "presto.build" }]],
  ] as const) {
    const config = json(`packages/${site}/wrangler.jsonc`);
    expect(config.name).toBe(`presto-${site}`);
    expect(config.routes).toEqual(routes);
    expect(config.workers_dev).toBe(true);
    expect(config.preview_urls).toBe(true);
  }
});

test("public links, feed probes and recognized origins use the permanent domain", () => {
  for (const [site, host] of [["landing", "presto.build"], ["playground", "playground.presto.build"]]) {
    const html = text(`packages/${site}/index.html`);
    expect(html).toContain(`<link rel="canonical" href="https://${host}"`);
    expect(html).not.toContain("workers.dev");
  }
  for (const file of ["packages/landing/src/feed.ts", ".github/workflows/update-feed-health.yml", ".github/workflows/release-presto.yml"]) {
    expect(text(file)).toContain("https://presto.build/releases/latest.json");
    expect(text(file)).not.toContain("alejo-amiras.workers.dev/releases/");
  }
  const sites = json("packages/presto/verified-sites.json");
  const playground = sites.entries.find((entry: { displayName: string }) => entry.displayName === "Presto Playground");
  expect(playground.origins).toEqual([
    "https://playground.presto.build",
    "https://presto-playground.alejo-amiras.workers.dev",
  ]);
});

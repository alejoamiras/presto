/**
 * Production build smoke test — runs against `vite build && vite preview`.
 *
 * Catches build-time breakage (polyfill issues, missing imports, bundler bugs)
 * that don't appear in `vite dev` mode. This test would have caught PR #34
 * where Vite 8 broke the Buffer polyfill in production builds.
 *
 * Usage: bun run --cwd packages/playground test:e2e:production-smoke
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

/** The `Cross-Origin-*` headers the deployed `public/_headers` sends, lower-cased names. */
function deployedHeaders(): Record<string, string> {
  const file = readFileSync(resolve(import.meta.dirname, "../public/_headers"), "utf8");
  const headers: Record<string, string> = {};
  let route = "";
  for (const line of file.split(/\r?\n/)) {
    if (/^[^\s#]/.test(line)) route = line.trim();
    // `! Name` detaches a header that a broader rule attached.
    expect(line).not.toMatch(/^\s+!\s*Cross-Origin-/i);
    const [, name, value] = /^\s+(Cross-Origin-[\w-]+):\s*(.*?)\s*$/i.exec(line) ?? [];
    if (name === undefined || value === undefined) continue;
    // A narrower route leaves the document without the header; Cloudflare joins a repeat into an
    // invalid comma-separated value.
    expect(route, name).toBe("/*");
    expect(headers[name.toLowerCase()], name).toBeUndefined();
    headers[name.toLowerCase()] = value;
  }
  return headers;
}

test("production build loads in-browser without JS errors or a request to Presto", async ({
  page,
}) => {
  const errors: string[] = [];
  const prestoRequests: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("request", (request) => {
    if (["59833", "59834"].includes(new URL(request.url()).port)) {
      prestoRequests.push(request.url());
    }
  });

  const response = await page.goto("/");
  // Chromium isolates under either COEP value, so only the header itself shows a drift between the
  // preview server and the deployment (WebKit isolates under `require-corp` alone).
  const deployed = deployedHeaders();
  expect(deployed).toEqual({
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-embedder-policy": "require-corp",
  });
  for (const [name, value] of Object.entries(deployed)) {
    expect(response?.headers()[name], name).toBe(value);
  }

  // Wait for the app to initialize — key UI elements should render
  await expect(page.locator("#mode-local")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("#mode-accelerated")).toBeVisible();
  await expect(page.locator("#deploy-btn")).toBeVisible();

  // Give async modules time to load (polyfills, lazy imports, etc.)
  await page.waitForTimeout(3_000);

  expect(errors).toEqual([]);
  await expect(page.locator("#mode-local")).toHaveAttribute("data-active", "true");
  await expect(page.locator("#presto-label")).toHaveText("not connected");
  expect(prestoRequests).toEqual([]);
});

test("production build serves all static assets", async ({ page }) => {
  const failedResources: string[] = [];
  page.on("response", (response) => {
    // Ignore proxy routes (Aztec node, presto) — they're expected to fail without services.
    // The node health probe is a POST to the bare /aztec RPC endpoint (no /status since 5.0).
    const url = response.url();
    if (
      response.status() >= 400 &&
      !url.endsWith("/aztec") &&
      !url.includes("/aztec/") &&
      !url.includes("localhost:59833") &&
      !url.includes("localhost:59834")
    ) {
      failedResources.push(`${response.status()} ${url}`);
    }
  });

  await page.goto("/");
  await page.waitForTimeout(3_000);

  expect(failedResources).toEqual([]);
});

test("production build ships the third-party licence notices it links to", async ({ page }) => {
  await page.goto("/");
  const href = await page.locator("#third-party-licenses").getAttribute("href");
  expect(href).toBe("/third-party-licenses.txt");

  // A missing file would still answer 200 with index.html (SPA fallback), so check the body.
  const response = await page.request.get(href as string);
  expect(response.headers()["content-type"]).toContain("text/plain");
  const body = await response.text();
  expect(body.startsWith("THIRD-PARTY SOFTWARE NOTICES")).toBe(true);
  expect(body).toContain("@aztec/stdlib ");
  expect(body).toContain("Apache License");
});

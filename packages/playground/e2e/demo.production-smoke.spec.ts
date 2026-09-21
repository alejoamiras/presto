/**
 * Production build smoke test — runs against `vite build && vite preview`.
 *
 * Catches build-time breakage (polyfill issues, missing imports, bundler bugs)
 * that don't appear in `vite dev` mode. This test would have caught PR #34
 * where Vite 8 broke the Buffer polyfill in production builds.
 *
 * Usage: bun run --cwd packages/playground test:e2e:production-smoke
 */
import { expect, test } from "@playwright/test";

test("production build loads without JS errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("/");

  // Wait for the app to initialize — key UI elements should render
  await expect(page.locator("#mode-local")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("#mode-accelerated")).toBeVisible();
  await expect(page.locator("#deploy-btn")).toBeVisible();

  // Give async modules time to load (polyfills, lazy imports, etc.)
  await page.waitForTimeout(3_000);

  expect(errors).toEqual([]);
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

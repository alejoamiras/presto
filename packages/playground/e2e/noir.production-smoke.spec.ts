import { expect, test } from "@playwright/test";

/**
 * The production bundle proves the Noir fixture with real bb.js WASM: worker packaging, the
 * embedded fixture chunk, and cross-origin isolation all survive `vite build`. Loaded with
 * `?noirStub=true` on purpose — the dev-only stub must be dead code here, so a byte-identical
 * proof with real WASM traffic is what proves the build.
 *
 * Usage: bun run --cwd packages/playground test:e2e:production-smoke
 */
test("production build proves the Noir fixture with real bb.js WASM, stub-free", async ({
  page,
}) => {
  test.setTimeout(5 * 60 * 1000);
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  const wasmTraffic: string[] = [];
  page.on("request", (request) => {
    if (/\.wasm(\?|$)|worker\.js(\?|$)|crs\.aztec\.network|\.dat(\?|$)/.test(request.url())) {
      wasmTraffic.push(request.url());
    }
  });

  await page.goto("/?noirStub=true");
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  await page.click("#mode-local");
  await expect(page.locator("#noir-btn")).toBeEnabled({ timeout: 30_000 });
  await page.click("#noir-btn");
  await expect(page.locator("#noir-btn")).toHaveText("Proving...");
  await expect(page.locator("#noir-btn")).toHaveText("Prove Noir Circuit", {
    timeout: 4 * 60 * 1000,
  });

  await expect(page.locator("#noir-tag-local")).toHaveText("identical to fixture");
  await expect(page.locator("#log")).toContainText("byte-identical to the bb.js WASM reference");
  expect(wasmTraffic, "real WASM proving must fetch bb.js workers or wasm").not.toEqual([]);
  expect(errors).toEqual([]);
});

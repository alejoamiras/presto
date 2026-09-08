import { expect, type Page, test } from "@playwright/test";

/**
 * One real-browser Noir proof: bb.js WASM workers in Chromium (CRS from the network), then Presto
 * when PRESTO_URL names one. Keeps browser worker packaging a release guarantee for the adapter.
 * No Aztec node or wallet is needed.
 *
 * Usage: bun run --cwd packages/playground test:e2e:smoke
 */
const PRESTO_URL = process.env.PRESTO_URL || "";

let page: Page;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  page.on("pageerror", (err) => console.log(`[browser:pageerror] ${err.message}`));
  await page.goto("/");
  await expect(page.locator("#noir-btn")).toBeEnabled({ timeout: 30_000 });
});

test.afterAll(async () => {
  await page?.close();
});

async function proveAndAssert(mode: "local" | "accelerated") {
  await page.click("#noir-btn");
  await expect(page.locator("#noir-btn")).toHaveText("Proving...");
  await expect(page.locator("#noir-btn")).toHaveText("Prove Noir Circuit", {
    timeout: 10 * 60 * 1000,
  });
  const log = await page.locator("#log").textContent();
  expect(log).not.toContain("Noir proof failed:");
  await expect(page.locator(`#noir-tag-${mode}`)).toHaveText("identical to fixture");
  await expect(page.locator(`#noir-time-${mode}`)).toHaveText(/^\d+\.\d+s$/);
}

test("proves the Noir fixture in the browser with real bb.js WASM", async () => {
  await page.click("#mode-local");
  await expect(page.locator("#mode-local")).toHaveClass(/mode-active/);
  await proveAndAssert("local");
});

test.describe("with Presto", () => {
  test.beforeEach(() => {
    test.skip(!PRESTO_URL, "PRESTO_URL env var not set");
  });

  test("proves the Noir fixture natively, never falling back", async () => {
    await page.click("#mode-accelerated");
    await expect(page.locator("#mode-accelerated")).toHaveClass(/mode-active/);
    await proveAndAssert("accelerated");
    expect(await page.locator("#log").textContent()).not.toContain("proving in-browser for now");
  });
});

import { expect, type Page, test } from "@playwright/test";
import { connectPresto } from "./connect";

/**
 * Real-browser Noir proofs against the dev server: bb.js WASM workers in Chromium (CRS from the
 * network), then Presto natively when PRESTO_URL names an HTTPS one. The Noir backend ignores the
 * page's HTTP consent, so an `http:` URL (the headless server) skips the native proof. No Aztec node
 * or wallet is needed. The production bundle's packaging is covered by noir.production-smoke.spec.ts.
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
    test.skip(PRESTO_URL.startsWith("http:"), "the Noir backend proves natively over HTTPS only");
  });

  test("proves the Noir fixture natively, never falling back", async () => {
    await connectPresto(page);
    await proveAndAssert("accelerated");
    expect(await page.locator("#log").textContent()).not.toContain("proving in-browser for now");
  });
});

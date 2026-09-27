/**
 * Deploy smoke against a live network with real proofs: one account deploy per mode. With
 * PRESTO_URL set, the Presto deploy must prove natively; an `http:` URL names the headless server,
 * which has no TLS listener, so the page's per-tab HTTP consent is taken first.
 *
 * Usage: AZTEC_NODE_URL=<node> [PRESTO_URL=<presto>] bun run --cwd packages/playground test:e2e:smoke
 */
import { expect, type Page, test } from "@playwright/test";
import { connectPresto, useHttpForSession } from "./connect";
import { deployAndAssert, expectNativeProof, initSharedPage } from "./fullstack.helpers";

const PRESTO_URL = process.env.PRESTO_URL || "";

let sharedPage: Page;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  sharedPage = await initSharedPage(browser);
});

test.afterAll(async () => {
  if (sharedPage) await sharedPage.close();
});

// ── Accelerated ──

test.describe("Accelerated", () => {
  test.beforeEach(() => {
    test.skip(!PRESTO_URL, "PRESTO_URL env var not set");
  });

  test("deploys account", async () => {
    const page = sharedPage;
    await connectPresto(page);
    if (PRESTO_URL.startsWith("http:")) await useHttpForSession(page);
    await deployAndAssert(page, "accelerated");
    await expectNativeProof(page);
  });
});

// ── Local ──

test.describe("Local", () => {
  test("deploys account", async () => {
    const page = sharedPage;
    await page.click("#mode-local");
    await expect(page.locator("#mode-local")).toHaveClass(/mode-active/);
    await deployAndAssert(page, "local");
  });
});

import { expect, type Page } from "@playwright/test";

export const PRESTO_ORIGINS = ["http://127.0.0.1:59833", "https://127.0.0.1:59834"];

/**
 * Selects Presto mode the way a visitor does: the Presto button, then Continue in the dialog if the
 * site is not connected yet. A connected page just switches mode.
 */
export async function connectPresto(page: Page): Promise<void> {
  // The main panel appears only after startup has applied the browser's stored decision.
  await expect(page.locator("#embedded-ui")).toBeVisible({ timeout: 60_000 });
  const presto = page.locator("#mode-accelerated");
  if ((await presto.getAttribute("data-active")) !== "true") {
    await presto.click();
    if (await page.locator("#presto-connect-dialog").isVisible()) {
      await page.locator("#presto-connect-continue").click();
    }
  }
  await expect(presto).toHaveAttribute("data-active", "true");
}

/**
 * Replaces the browser's stored Local Network Access decision for the page. The stub reports no
 * change events; tests move it with `setMockPermission`.
 */
export async function mockPermission(
  page: Page,
  initial: "denied" | "prompt" | "granted",
): Promise<void> {
  await page.addInitScript((state) => {
    const target = window as typeof window & { __mockLnaPermission?: string };
    target.__mockLnaPermission = state;
    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      value: { query: async () => ({ state: target.__mockLnaPermission }) },
    });
  }, initial);
}

export async function setMockPermission(
  page: Page,
  state: "denied" | "prompt" | "granted",
): Promise<void> {
  await page.evaluate((next) => {
    (window as typeof window & { __mockLnaPermission?: string }).__mockLnaPermission = next;
  }, state);
}

/**
 * Counts and aborts every request to either Presto origin, any path. Register it before any
 * narrower Presto route: Playwright tries the most recently registered route first.
 */
export async function recordPresto(page: Page): Promise<string[]> {
  const seen: string[] = [];
  for (const origin of PRESTO_ORIGINS) {
    await page.route(`${origin}/**`, (route) => {
      seen.push(route.request().url());
      return route.abort();
    });
  }
  return seen;
}

import { expect, type Page } from "@playwright/test";

export const PRESTO_ORIGINS = ["http://127.0.0.1:59833", "https://127.0.0.1:59834"];

/**
 * Waits for startup: `main.ts` drops `#embedded-ui`'s `hidden` class once the mode buttons are set and
 * the browser's stored decision is applied. Visibility is not proof: on the dev server the stylesheet
 * comes with the module graph, so if that graph fails to load (a cold Vite can 504 a stale dependency,
 * then reload) the panel shows unstyled while `main.ts` never ran. A reload after this returns is not
 * covered.
 */
export async function appReady(page: Page, timeout: number): Promise<void> {
  await expect(page.locator("#embedded-ui")).not.toContainClass("hidden", { timeout });
}

/**
 * Selects Presto mode the way a visitor does: the Presto button, then Continue in the dialog if the
 * site is not connected yet. A connected page just switches mode. Returns once the first check has
 * settled: a run started while it is in flight under a `prompt` permission proves in the browser.
 */
export async function connectPresto(page: Page): Promise<void> {
  await appReady(page, 60_000);
  const presto = page.locator("#mode-accelerated");
  if ((await presto.getAttribute("data-active")) !== "true") {
    await presto.click();
    if (await page.locator("#presto-connect-dialog").isVisible()) {
      await page.locator("#presto-connect-continue").click();
    }
  }
  await expect(presto).toHaveAttribute("data-active", "true");
  await expect(page.locator("#presto-label")).not.toHaveText(/^(not connected|checking…)$/, {
    timeout: 60_000,
  });
}

/**
 * Takes the page's per-tab consent to prove over plain HTTP, the only listener the headless server
 * has. The page must already be showing the Encrypted Connection help.
 */
export async function useHttpForSession(page: Page): Promise<void> {
  await page.locator("#presto-use-http").click();
  await expect(page.locator("#http-session-confirmation")).toBeVisible();
  await page.locator("#http-session-confirm").click();
  await expect(page.locator("#presto-label")).toHaveText("running");
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

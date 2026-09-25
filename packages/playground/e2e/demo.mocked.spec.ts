import { expect, type Page, type Route, test } from "@playwright/test";
import { mockPermission, recordPresto, setMockPermission } from "./connect";

// ── Helpers ──

// The app's node health check is the node_getNodeInfo JSON-RPC POST to /aztec
// (5.0.0 nodes 405 a plain GET /status, so there is no /status probe anymore).

/** Block the node RPC so the app stays in "services unavailable" state. */
async function mockServicesOffline(page: Page) {
  await page.route("**/aztec", (route) =>
    route.fulfill({ status: 503, body: "Service Unavailable" }),
  );
}

/**
 * Answer the health probe (node_getNodeInfo) as healthy; every other RPC 500s
 * so wallet init fails gracefully (there is no real node behind the mock).
 */
async function mockServicesOnline(page: Page) {
  await page.route("**/aztec", (route) => {
    const req = route.request();
    if (req.method() === "POST" && req.postData()?.includes("node_getNodeInfo")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: { nodeVersion: "5.0.0" } }),
      });
    }
    return route.fulfill({ status: 500, body: "not a real node" });
  });
}

const HEALTHY = JSON.stringify({ status: "ok", api_version: 1 });

async function mockHealth(page: Page, handler: (route: Route) => Promise<void> | void) {
  await page.route("http://127.0.0.1:59833/health", handler);
  await page.route("https://127.0.0.1:59834/health", handler);
}

const healthy = (route: Route) =>
  route.fulfill({ status: 200, contentType: "application/json", body: HEALTHY });

/** Let startup finish: the Services row settles once the permission read has been applied. */
async function loaded(page: Page) {
  await expect(page.locator("#embedded-ui")).toBeVisible({ timeout: 10_000 });
}

// ── JS error safety net — catches runtime errors across all mocked tests ──

const jsErrors: string[] = [];

test.beforeEach(async ({ page }) => {
  jsErrors.length = 0;
  page.on("pageerror", (err) => jsErrors.push(err.message));
});

test.afterEach(() => {
  expect(jsErrors, "Unexpected JS runtime errors").toEqual([]);
});

// ── Tests ──
// Assertions use data-* attributes (data-active, data-status) instead of CSS
// classes, so design refactors don't break tests.

test("page loads in-browser and asks before connecting", async ({ page }) => {
  await mockServicesOffline(page);
  await mockPermission(page, "prompt");
  await page.goto("/");
  await loaded(page);

  await expect(page.locator("#mode-local")).toHaveAttribute("data-active", "true");
  await expect(page.locator("#mode-accelerated")).toHaveAttribute("data-active", "false");
  await expect(page.locator("#presto-mode-hint")).toHaveText("connect");
  await expect(page.locator("#presto-label")).toHaveText("not connected");
  await expect(page.locator("#presto-connect")).toBeVisible();
  await expect(page.locator("#deploy-btn")).toBeDisabled();
  await expect(page.locator("#token-flow-btn")).toBeDisabled();
});

test("nothing reaches Presto before consent, a Noir proof included", async ({ page }) => {
  await mockServicesOffline(page);
  await mockPermission(page, "prompt");
  const requests = await recordPresto(page);
  await page.goto("/?noirStub=true");
  await loaded(page);
  await expect(page.locator("#presto-connect")).toBeVisible();

  await page.click("#noir-btn");
  await expect(page.locator("#noir-tag-local")).toHaveText("identical to fixture", {
    timeout: 20_000,
  });
  expect(requests).toEqual([]);

  // Validity: the same recorder sees the first request once the visitor continues.
  await page.click("#presto-connect");
  await page.click("#presto-connect-continue");
  await expect.poll(() => requests.length).toBeGreaterThan(0);
});

test("Connect explains the browser's question, then Continue connects", async ({ page }) => {
  await mockServicesOffline(page);
  await mockPermission(page, "prompt");
  await mockHealth(page, healthy);
  await page.goto("/");
  await loaded(page);

  await page.click("#mode-accelerated");
  const dialog = page.locator("#presto-connect-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("your browser will ask for permission");
  await expect(page.locator("#presto-connect-cancel")).toBeFocused();
  await page.click("#presto-connect-continue");

  await expect(dialog).toBeHidden();
  await expect(page.locator("#presto-label")).toHaveText("running");
  await expect(page.locator("#presto-status")).toHaveAttribute("data-status", "online");
  await expect(page.locator("#mode-accelerated")).toHaveAttribute("data-active", "true");
  await expect(page.locator("#presto-mode-hint")).toHaveText("fastest");
  await expect(page.locator("#presto-connect")).toBeHidden();
});

test("a visitor who already allowed this site connects with no click", async ({ page }) => {
  await mockServicesOffline(page);
  await mockPermission(page, "granted");
  await mockHealth(page, healthy);
  await page.goto("/");

  await expect(page.locator("#presto-label")).toHaveText("running");
  await expect(page.locator("#mode-accelerated")).toHaveAttribute("data-active", "true");
  await expect(page.locator("#presto-connect-dialog")).toBeHidden();
  await expect(page.locator("#accel-banner")).toBeHidden();
  await expect(page.locator("#presto-cta")).toBeHidden();
});

test("a blocked site gets guidance, no dialog and no request", async ({ page }) => {
  await mockServicesOffline(page);
  await mockPermission(page, "denied");
  const requests = await recordPresto(page);
  await page.goto("/");
  await loaded(page);

  await expect(page.locator("#presto-label")).toHaveText("blocked by your browser");
  await expect(page.locator("#presto-permission-help")).toBeVisible();
  await page.click("#mode-accelerated");
  await expect(page.locator("#presto-connect-dialog")).toBeHidden();
  await expect(page.locator("#presto-permission-help")).toBeFocused();
  await expect(page.locator("#mode-local")).toHaveAttribute("data-active", "true");
  await page.click("#presto-permission-retry");
  await expect(page.locator("#presto-label")).toHaveText("blocked by your browser");
  expect(requests).toEqual([]);
});

test("Not now sends nothing and returns focus", async ({ page }) => {
  await mockServicesOffline(page);
  await mockPermission(page, "prompt");
  const requests = await recordPresto(page);
  await page.goto("/");
  await loaded(page);

  await page.click("#presto-connect");
  await page.click("#presto-connect-cancel");
  await expect(page.locator("#presto-connect-dialog")).toBeHidden();
  await expect(page.locator("#presto-connect")).toBeFocused();
  await expect(page.locator("#mode-local")).toHaveAttribute("data-active", "true");
  await expect(page.locator("#presto-recovery-announcement")).toContainText("not connected");
  expect(requests).toEqual([]);
});

test("the dialog makes the page inert, Escape cancels, focus returns", async ({ page }) => {
  await mockServicesOffline(page);
  await mockPermission(page, "prompt");
  const requests = await recordPresto(page);
  await page.goto("/");
  await loaded(page);

  await page.locator("#mode-accelerated").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#presto-connect-dialog")).toBeVisible();
  const focusedBehind = await page.evaluate(() => {
    document.getElementById("mode-local")?.focus();
    return document.activeElement?.id;
  });
  expect(focusedBehind).not.toBe("mode-local");

  await page.keyboard.press("Escape");
  await expect(page.locator("#presto-connect-dialog")).toBeHidden();
  await expect(page.locator("#mode-accelerated")).toBeFocused();
  expect(requests).toEqual([]);
});

test("no answer while the browser may still be asking waits instead of 'not found'", async ({
  page,
}) => {
  await mockServicesOffline(page);
  await mockPermission(page, "prompt");
  await mockHealth(page, (route) => route.abort());
  await page.goto("/");
  await loaded(page);

  await page.click("#presto-connect");
  await page.click("#presto-connect-continue");
  await expect(page.locator("#presto-label")).toHaveText("waiting for your browser");
  await expect(page.locator("#presto-retry-help")).toContainText("choose Allow");
  await expect(page.locator("#presto-try-again")).toBeVisible();
  await expect(page.locator("#presto-secure-help")).toBeHidden();

  await mockHealth(page, healthy);
  await page.click("#presto-try-again");
  await expect(page.locator("#presto-label")).toHaveText("running");
});

test("mode buttons toggle once connected", async ({ page }) => {
  await mockServicesOffline(page);
  await mockPermission(page, "granted");
  await mockHealth(page, healthy);
  await page.goto("/");
  await expect(page.locator("#presto-label")).toHaveText("running");

  await page.click("#mode-local");
  await expect(page.locator("#mode-local")).toHaveAttribute("data-active", "true");
  await expect(page.locator("#mode-accelerated")).toHaveAttribute("data-active", "false");
  await expect(page.locator("#log")).toContainText("Proving mode → in-browser");

  await page.click("#mode-accelerated");
  await expect(page.locator("#mode-accelerated")).toHaveAttribute("data-active", "true");
  await expect(page.locator("#mode-local")).toHaveAttribute("data-active", "false");
  await expect(page.locator("#presto-connect-dialog")).toBeHidden();
});

test("service dots show online when Aztec node responds OK", async ({ page }) => {
  // Health probe answers; every other RPC 500s so wallet init fails gracefully.
  await mockServicesOnline(page);
  await page.goto("/");

  await expect(page.locator("#aztec-status")).toHaveAttribute("data-status", "online");
});

test("service dots show offline when Aztec node fails", async ({ page }) => {
  await mockServicesOffline(page);
  await page.goto("/");

  await expect(page.locator("#aztec-status")).toHaveAttribute("data-status", "offline");
});

test("log panel shows checking Aztec node message on load", async ({ page }) => {
  await mockServicesOffline(page);
  await page.goto("/");

  await expect(page.locator("#log")).toContainText("Checking Aztec node");
});

test("an unconfirmed secure connection keeps install guidance and shows recovery", async ({
  page,
}) => {
  await mockServicesOffline(page);
  await mockPermission(page, "granted");
  await mockHealth(page, (route) => route.abort());
  await page.goto("/");

  await expect(page.locator("#presto-label")).toContainText("secure connection unavailable");
  await expect(page.locator("#presto-permission-help")).toBeHidden();
  await expect(page.locator("#presto-secure-help")).toBeVisible();
  await expect(page.locator("#accel-banner")).toBeVisible();
  await expect(page.locator("#presto-cta")).toBeVisible();
});

test("an unexpected answer and a version mismatch do not offer a contradictory install", async ({
  page,
}) => {
  await mockServicesOffline(page);
  await mockPermission(page, "granted");
  await mockHealth(page, (route) => route.fulfill({ status: 500, body: "error" }));
  await page.goto("/");
  await expect(page.locator("#presto-label")).toHaveText("unexpected answer, in-browser");
  await expect(page.locator("#accel-banner")).toBeHidden();
  await expect(page.locator("#presto-cta")).toBeHidden();

  await page.unroute("http://127.0.0.1:59833/health");
  await page.unroute("https://127.0.0.1:59834/health");
  await mockHealth(page, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "ok", api_version: 1, aztec_version: "0.0.0" }),
    }),
  );
  await page.reload();
  await expect(page.locator("#presto-label")).toContainText("version mismatch");
  await expect(page.locator("#accel-banner")).toBeHidden();
  await expect(page.locator("#presto-cta")).toBeHidden();
});

test("permission-blocked guidance recovers through Retry once the site is allowed", async ({
  page,
}) => {
  await mockServicesOffline(page);
  await mockPermission(page, "denied");
  const requests: string[] = [];
  await mockHealth(page, async (route) => {
    requests.push(route.request().url());
    await new Promise((resolve) => setTimeout(resolve, 100));
    return healthy(route);
  });
  await page.goto("/");

  await expect(page.locator("#presto-label")).toHaveText("blocked by your browser");
  await expect(page.locator("#presto-permission-help")).toBeVisible();
  await expect(page.locator("#accel-banner")).toBeHidden();
  await expect(page.locator("#presto-cta")).toBeHidden();
  expect(requests).toEqual([]);

  await setMockPermission(page, "granted");
  await page.locator("#presto-permission-retry").click();
  await expect(page.locator("#presto-label")).toHaveText("running");
  await expect(page.locator("#presto-permission-help")).toBeHidden();
  await expect(page.locator("#mode-accelerated")).toHaveAttribute("data-active", "true");
});

test("HTTP recovery requires confirmation and resets on reload", async ({ page }) => {
  await mockServicesOffline(page);
  await mockPermission(page, "granted");
  const detailedHealth = JSON.stringify({
    status: "ok",
    api_version: 1,
    version: "3.0.0",
    aztec_version: "5.2.0",
    available_versions: ["5.2.0"],
    bb_available: true,
  });
  const plaintextProofRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url() === "http://127.0.0.1:59833/prove") {
      plaintextProofRequests.push(request.url());
    }
  });
  await page.route("https://127.0.0.1:59834/health", (route) => route.abort());
  await page.route("http://127.0.0.1:59833/health", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: detailedHealth }),
  );
  await page.goto("/");

  await expect(page.locator("#presto-secure-title")).toHaveText("Encrypted Connection is disabled");
  await expect(page.locator("#presto-secure-help")).toBeVisible();
  expect(plaintextProofRequests).toEqual([]);
  const storageBefore = await page.evaluate(() => ({ ...localStorage }));
  const cookieBefore = await page.evaluate(() => document.cookie);
  const urlBefore = page.url();

  await page.locator("#presto-use-http").click();
  await expect(page.locator("#http-session-confirmation")).toBeVisible();
  await expect(page.locator("#http-session-cancel")).toBeFocused();
  await expect(page.locator("#http-session-warning")).toHaveText(
    "HTTP can expose private proving data to another local user or process. Use it only if you accept this risk for the current tab.",
  );
  await page.keyboard.press("Escape");
  await expect(page.locator("#http-session-confirmation")).toBeHidden();
  await expect(page.locator("#presto-service-status")).toBeFocused();
  await expect(page.locator("#presto-label")).toContainText("secure connection unavailable");

  await page.locator("#presto-use-http").click();
  await page.locator("#http-session-confirm").click();
  await expect(page.locator("#presto-label")).toHaveText("running");
  await expect(page.locator("#presto-secure-help")).toBeHidden();
  await expect(page.locator("#presto-service-status")).toBeFocused();
  await expect(page.locator("#presto-recovery-announcement")).toContainText("this tab only");
  expect(await page.evaluate(() => ({ ...localStorage }))).toEqual(storageBefore);
  expect(await page.evaluate(() => document.cookie)).toBe(cookieBefore);
  expect(page.url()).toBe(urlBefore);

  await page.reload();
  await expect(page.locator("#presto-secure-help")).toBeVisible();
  await expect(page.locator("#presto-label")).toContainText("secure connection unavailable");
  expect(plaintextProofRequests).toEqual([]);
});

test("node error appears in log panel", async ({ page }) => {
  await mockServicesOffline(page);
  await page.goto("/");

  // The log should show an error about the Aztec node not being reachable
  await expect(page.locator("#log")).toContainText("not reachable", {
    timeout: 5000,
  });
});

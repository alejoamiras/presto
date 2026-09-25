import { type Browser, type BrowserContext, expect, type Page, test } from "@playwright/test";

const PLAYGROUND_ORIGIN = "http://127.0.0.1:5173";
const LANDING_ORIGIN = "http://127.0.0.1:5174";
const HEALTH_URL = "http://127.0.0.1:59833/health";
const HEALTH_ADMIN = "http://127.0.0.1:59833";
const PRESTO_PORTS = new Set(["59833", "59834"]);

async function resetHealthHits(): Promise<void> {
  const response = await fetch(`${HEALTH_ADMIN}/__reset`, { method: "POST" });
  expect(response.ok).toBe(true);
}

async function setHealthDelay(ms: number): Promise<void> {
  const response = await fetch(`${HEALTH_ADMIN}/__delay?ms=${ms}`, { method: "POST" });
  expect(response.ok).toBe(true);
}

async function healthHits(): Promise<number> {
  const response = await fetch(`${HEALTH_ADMIN}/__hits`);
  return ((await response.json()) as { healthHits: number }).healthHits;
}

async function denyLocalNetwork(context: BrowserContext, origin: string): Promise<void> {
  // CDP's grant operation rejects every permission omitted from the list. An empty list is an
  // explicit deny override, not the browser's headless prompt default.
  await context.grantPermissions([], { origin });
}

async function grantLocalNetwork(context: BrowserContext, origin: string): Promise<void> {
  // Playwright 1.58 maps this umbrella permission to Chromium's legacy and split local/loopback
  // protocol permission names.
  await context.grantPermissions(["local-network-access"], { origin });
}

async function permissionState(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const permissions = navigator.permissions as unknown as {
      query(descriptor: { name: string }): Promise<{ state: string }>;
    };
    try {
      return (await permissions.query({ name: "loopback-network" })).state;
    } catch {
      return (await permissions.query({ name: "local-network-access" })).state;
    }
  });
}

async function rawAnnotatedHealth(page: Page): Promise<boolean> {
  return page.evaluate(async (url) => {
    try {
      const response = await fetch(url, {
        targetAddressSpace: "loopback",
      } as RequestInit & { targetAddressSpace: "loopback" });
      const body = (await response.json()) as { status?: unknown; api_version?: unknown };
      return response.ok && body.status === "ok" && body.api_version === 1;
    } catch {
      return false;
    }
  }, HEALTH_URL);
}

async function mockPlaygroundNode(page: Page): Promise<void> {
  await page.route(`${PLAYGROUND_ORIGIN}/aztec`, (route) =>
    route.fulfill({ status: 503, body: "node intentionally absent from LNA harness" }),
  );
}

async function mockLandingExternals(page: Page): Promise<void> {
  await page.route(`${LANDING_ORIGIN}/releases/latest.json`, (route) =>
    route.fulfill({ status: 404, body: "not needed" }),
  );
  await page.route("https://api.github.com/**", (route) =>
    route.fulfill({ status: 404, body: "not needed" }),
  );
}

/** Records every page request to either Presto port, any host and path. Install before navigation. */
function recordPrestoRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", (request) => {
    if (PRESTO_PORTS.has(new URL(request.url()).port)) seen.push(request.url());
  });
  return seen;
}

async function deniedContext(browser: Browser, origin: string): Promise<BrowserContext> {
  const context = await browser.newContext();
  await denyLocalNetwork(context, origin);
  return context;
}

async function continueToPresto(page: Page): Promise<void> {
  await page.locator("#presto-connect").click();
  await page.locator("#presto-connect-continue").click();
}

/** Allow the browser's question, then the separate plaintext confirmation this HTTP-only harness needs. */
async function allowAndUseHttp(context: BrowserContext, page: Page): Promise<void> {
  await grantLocalNetwork(context, PLAYGROUND_ORIGIN);
  await expect(page.locator("#presto-secure-help")).toBeVisible();
  await page.locator("#presto-use-http").click();
  await page.locator("#http-session-confirm").click();
  await expect(page.locator("#presto-label")).toHaveText("running");
  await expect(page.locator("#presto-status")).toHaveAttribute("data-status", "online");
}

test("harness proves a real denied and granted public-to-loopback fetch", async ({ browser }) => {
  await resetHealthHits();
  const context = await deniedContext(browser, PLAYGROUND_ORIGIN);
  const page = await context.newPage();
  await mockPlaygroundNode(page);
  await page.goto(PLAYGROUND_ORIGIN);
  await expect(page.locator("#presto-permission-help")).toBeVisible();

  const capabilities = await page.evaluate(() => ({
    secure: window.isSecureContext,
    targetAddressSpace: "targetAddressSpace" in Request.prototype,
  }));
  expect(capabilities).toEqual({ secure: true, targetAddressSpace: true });
  expect(await permissionState(page)).toBe("denied");
  expect(await healthHits()).toBe(0);

  expect(await rawAnnotatedHealth(page)).toBe(false);
  expect(await healthHits()).toBe(0);

  await grantLocalNetwork(context, PLAYGROUND_ORIGIN);
  expect(await permissionState(page)).toBe("granted");
  await expect(page.locator("#presto-secure-help")).toBeVisible();
  const automaticHits = await healthHits();
  expect(automaticHits).toBeGreaterThan(0);
  expect(await rawAnnotatedHealth(page)).toBe(true);
  expect(await healthHits()).toBe(automaticHits + 1);
  await context.close();
});

test("playground sends nothing before consent, even 8 s after load", async ({ browser }) => {
  await resetHealthHits();
  const context = await browser.newContext();
  const page = await context.newPage();
  await mockPlaygroundNode(page);
  const requests = recordPrestoRequests(page);
  await page.goto(PLAYGROUND_ORIGIN);
  await expect(page.locator("#presto-connect")).toBeVisible();
  await page.waitForTimeout(8_000);

  expect(await permissionState(page)).toBe("prompt");
  expect(requests).toEqual([]);
  expect(await healthHits()).toBe(0);

  // Validity: the recorder sees the first request once the visitor continues, though the browser
  // holds it until the question is answered.
  await continueToPresto(page);
  await expect.poll(() => requests.length).toBeGreaterThan(0);
  expect(await healthHits()).toBe(0);
  await context.close();
});

test("Continue, then Allow, connects through the separate HTTP confirmation", async ({
  browser,
}) => {
  await resetHealthHits();
  const context = await browser.newContext();
  const page = await context.newPage();
  await mockPlaygroundNode(page);
  await page.goto(PLAYGROUND_ORIGIN);

  await continueToPresto(page);
  await expect(page.locator("#presto-may-ask")).toBeVisible();
  await allowAndUseHttp(context, page);
  expect(await healthHits()).toBeGreaterThan(0);
  await context.close();
});

test("a blocked site gets guidance and a same-context grant recovers", async ({ browser }) => {
  await resetHealthHits();
  const context = await deniedContext(browser, PLAYGROUND_ORIGIN);
  const page = await context.newPage();
  await mockPlaygroundNode(page);
  const requests = recordPrestoRequests(page);
  await page.goto(PLAYGROUND_ORIGIN);

  await expect(page.locator("#presto-label")).toHaveText("blocked by your browser");
  await expect(page.locator("#presto-permission-help")).toBeVisible();
  await expect(page.locator("#accel-banner")).toBeHidden();
  await expect(page.locator("#presto-cta")).toBeHidden();
  expect(requests).toEqual([]);

  await allowAndUseHttp(context, page);
  await expect(page.locator("#presto-permission-help")).toBeHidden();
  await context.close();
});

test("a grant that arrives after the check gave up still connects", async ({ browser }) => {
  await resetHealthHits();
  const context = await browser.newContext();
  const page = await context.newPage();
  await mockPlaygroundNode(page);
  await page.goto(PLAYGROUND_ORIGIN);

  // The browser holds the request longer than every bounded SDK attempt.
  await continueToPresto(page);
  await expect(page.locator("#presto-label")).toHaveText("waiting for your browser", {
    timeout: 20_000,
  });
  await expect(page.locator("#presto-try-again")).toBeVisible();
  expect(await permissionState(page)).toBe("prompt");
  expect(await healthHits()).toBe(0);

  await allowAndUseHttp(context, page);
  await context.close();
});

test("a reset to ask while a check is queued sends nothing more", async ({ browser }) => {
  await resetHealthHits();
  await setHealthDelay(3_000);
  const context = await browser.newContext();
  const page = await context.newPage();
  await mockPlaygroundNode(page);
  const requests = recordPrestoRequests(page);
  await page.goto(PLAYGROUND_ORIGIN);

  await continueToPresto(page);
  await expect.poll(() => requests.length).toBeGreaterThan(0);
  // Allow releases the held check (now slow at the server) and queues a fresh one behind it.
  await grantLocalNetwork(context, PLAYGROUND_ORIGIN);
  await expect.poll(healthHits).toBeGreaterThan(0);
  await context.clearPermissions();
  await expect(page.locator("#presto-label")).toHaveText("not connected");
  const sent = requests.length;

  await page.waitForTimeout(6_000);
  expect(requests.length).toBe(sent);
  await expect(page.locator("#presto-label")).toHaveText("not connected");
  await expect(page.locator("#mode-local")).toHaveAttribute("data-active", "true");
  await setHealthDelay(0);
  await context.close();
});

for (const permission of ["prompt", "granted"] as const) {
  test(`landing never contacts Presto (${permission})`, async ({ browser }) => {
    await resetHealthHits();
    const context = await browser.newContext();
    if (permission === "granted") await grantLocalNetwork(context, LANDING_ORIGIN);
    const page = await context.newPage();
    await mockLandingExternals(page);
    const requests = recordPrestoRequests(page);
    await page.goto(LANDING_ORIGIN, { waitUntil: "networkidle" });
    await page.waitForTimeout(3_000);

    expect(await permissionState(page)).toBe(permission);
    expect(requests).toEqual([]);
    expect(await healthHits()).toBe(0);

    if (permission === "granted") {
      // Validity: the recorder does see a request to Presto when one is made.
      expect(await rawAnnotatedHealth(page)).toBe(true);
      expect(requests).toEqual([HEALTH_URL]);
    }
    await context.close();
  });
}

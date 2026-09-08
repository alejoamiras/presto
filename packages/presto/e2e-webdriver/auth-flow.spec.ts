/**
 * Authorization flow — verifies the full pipeline:
 * HTTP /prove with unknown origin → auth popup appears → user clicks Allow → origin saved.
 *
 * This is the highest-value WebDriver test because it exercises concurrent
 * HTTP + GUI interactions that can't be tested with mocked Playwright.
 */
import {
  clickBy,
  closeExtraWindows,
  readConfig,
  removeOriginViaUI,
  waitForActivePopup,
  waitForNewWindow,
} from "./helpers.ts";

const TEST_ORIGIN = "https://test-e2e-webdriver.example.com";
const PROVE_URL = "http://127.0.0.1:59833/prove";

/**
 * Fire a /prove POST with an unknown origin. The request blocks until the
 * auth popup is resolved (Allow/Deny) or the 60s server timeout fires.
 */
function fireProveRequest(): Promise<Response> {
  return fetch(PROVE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      Origin: TEST_ORIGIN,
    },
    body: new Uint8Array([0]),
  });
}

/**
 * Click a decision button until the blocked /prove request settles: a late focus or activation can
 * leave the click inside the popup's 700 ms click-steal guard (silently ignored), so retry after it.
 */
async function decide(selector: string, pending: Promise<Response>): Promise<Response> {
  for (let attempt = 1; attempt <= 4; attempt++) {
    await clickBy(selector);
    const settled = await Promise.race([pending, browser.pause(1500).then(() => null)]);
    if (settled) return settled;
  }
  throw new Error(`${selector}: the decision never reached the server`);
}

describe("Authorization Flow", () => {
  let settingsHandle: string;
  let pendingProve: Promise<Response> | null = null;

  before(async () => {
    settingsHandle = await browser.getWindowHandle();
    await removeOriginViaUI(TEST_ORIGIN);
  });

  beforeEach(async () => {
    await closeExtraWindows(settingsHandle);
    await browser.pause(300);
  });

  afterEach(async () => {
    if (pendingProve) {
      await pendingProve.catch(() => {});
      pendingProve = null;
    }
  });

  after(async () => {
    try {
      await closeExtraWindows(settingsHandle);
      await removeOriginViaUI(TEST_ORIGIN);
    } catch (e) {
      console.error("Auth flow cleanup failed:", e);
    }
  });

  it("should show auth popup and persist the origin on Allow", async () => {
    const handlesBefore = await browser.getWindowHandles();

    pendingProve = fireProveRequest();

    const authWindowHandle = await waitForNewWindow(handlesBefore);
    expect(authWindowHandle).not.toBeNull();

    await browser.switchToWindow(authWindowHandle!);

    // C9 (D8/A): the popup now loads its origin async (get_pending_auth), so wait for the page to render
    // (server origin) + the click-guard to elapse BEFORE asserting title/content — getTitle() on the
    // not-yet-loaded page returns "" (this ordering was the CI failure).
    await waitForActivePopup(TEST_ORIGIN);
    expect(await browser.getTitle()).toBe("Authorize Site");
    expect(await browser.$("#origin").getText()).toBe(TEST_ORIGIN);

    // Allow is unconditionally persistent — no checkbox to opt in with. The popup says so instead;
    // this is the real-app proof that the disclosure is truthful (the mocked specs pin the copy).
    expect(await browser.$("#permanence").getText()).toContain("Stays approved");

    const proveResponse = await decide("#allow", pendingProve);
    pendingProve = null;
    expect(proveResponse.status).not.toBe(403);

    const config = readConfig();
    const origins = (config.approved_origins as string[]) || [];
    expect(origins).toContain(TEST_ORIGIN);

    await browser.switchToWindow(settingsHandle);

    await browser.refresh();
    await browser.pause(500);
    await removeOriginViaUI(TEST_ORIGIN);
  });

  it("Deny returns 403, does not persist the origin, and cools down re-requests (B2/F9)", async () => {
    // Consolidates the two former deny tests (both asserted 403 + not-persisted) and additionally proves
    // the B2/F9 post-deny cooldown end-to-end: after a Deny, an immediate re-request from the same origin
    // is refused (403) WITHOUT popping a new consent window, so a page can't nag the user right after a
    // No. Kept as ONE self-contained test because a second same-origin deny would itself be cooled down.
    // (Deny leaving `approved_origins` untouched is worth a real-app assertion — a bug that persisted on
    // Deny would hand a standing grant to a site the user just refused.)
    const handlesBefore = await browser.getWindowHandles();

    pendingProve = fireProveRequest();

    const authWindowHandle = await waitForNewWindow(handlesBefore);
    expect(authWindowHandle).not.toBeNull();

    await browser.switchToWindow(authWindowHandle!);

    // C9 (D8/A): wait for the server origin to render (get_pending_auth) + the click-guard to elapse.
    await waitForActivePopup(TEST_ORIGIN);
    const proveResponse = await decide("#deny", pendingProve);
    pendingProve = null;
    expect(proveResponse.status).toBe(403);

    const origins = (readConfig().approved_origins as string[]) || [];
    expect(origins).not.toContain(TEST_ORIGIN);

    await browser.switchToWindow(settingsHandle);

    // B2 (F9): re-request within the cooldown → refused fast with 403 and NO new consent window.
    const handlesBeforeRetry = await browser.getWindowHandles();
    pendingProve = fireProveRequest();
    const retryResponse = await pendingProve;
    pendingProve = null;
    expect(retryResponse.status).toBe(403);
    const handlesAfterRetry = await browser.getWindowHandles();
    expect(handlesAfterRetry.length).toBe(handlesBeforeRetry.length);
  });
});

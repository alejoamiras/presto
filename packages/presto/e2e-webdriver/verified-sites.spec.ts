/**
 * The signed verified-sites list, fetched by the real app from the loopback feed
 * (`scripts/verified-sites-e2e-feed.ts`): an accepted list badges a new origin and removes a built-in
 * one, a list with a bad signature changes nothing, and a later list takes the badge away again, each
 * time reaching both the registry and a reloaded consent popup. Only here do the fetch task, the swap
 * and the popup's IPC run together in the shipped webview.
 *
 * One popup covers the whole sequence: the server's 60 s decision deadline does not restart on a
 * refresh, so the steps stay well under it.
 */
import * as fs from "node:fs";

import {
  type ControlStatus,
  E2E_NAME,
  E2E_ORIGIN,
  FEED_STATE_ENV,
  type FeedState,
  firstBuiltIn,
  newestRecord,
  type ServedMode,
} from "../scripts/verified-sites-e2e.ts";
import {
  closeExtraWindows,
  decidePopup,
  invokeHere,
  removeOriginViaUI,
  waitForActivePopup,
  waitForNewWindow,
} from "./helpers.ts";

const PROVE_URL = "http://127.0.0.1:59833/prove";
/** The app's hook pumps the list check every second. */
const POLL_MS = 5_000;
const SEQUENCE_MS = 45_000;

function feedState(): FeedState {
  const file = process.env[FEED_STATE_ENV];
  if (!file) throw new Error(`${FEED_STATE_ENV} is not set, so the app ran without the list feed`);
  return JSON.parse(fs.readFileSync(file, "utf-8")) as FeedState;
}

async function serve(feed: FeedState, mode: ServedMode | "none"): Promise<void> {
  const response = await fetch(`${feed.control}?serve=${mode}`, { method: "POST" });
  if (!response.ok) throw new Error(`the feed refused mode ${mode}: ${response.status}`);
}

/** The registry's answer for `origin`, asked from the consent popup, the one window allowed to. */
async function verifiedName(origin: string): Promise<string | null> {
  const res = await invokeHere("get_verified_info", { origin });
  if (!res.resolved) throw new Error(`get_verified_info(${origin}) failed: ${res.error}`);
  return (res.value as { display_name: string } | null)?.display_name ?? null;
}

async function until(what: string, check: () => Promise<boolean>): Promise<void> {
  await browser.waitUntil(check, { timeout: POLL_MS, interval: 250, timeoutMsg: what });
}

/** Reload the popup and return whether it shows the recognized-site row, with which name. */
async function reloadedBadge(): Promise<string | null> {
  await browser.refresh();
  await waitForActivePopup(E2E_ORIGIN);
  // The badge is filled by its own IPC round trip after the origin renders.
  await browser.pause(500);
  const row = await browser.$("#recognized");
  if (!(await row.isDisplayed())) return null;
  return row.$(".recognized-name").getText();
}

describe("Verified sites: the signed list feed", () => {
  let settingsHandle: string;
  let pendingProve: Promise<Response> | null = null;
  let feed: FeedState;

  before(async () => {
    feed = feedState();
    settingsHandle = await browser.getWindowHandle();
    await removeOriginViaUI(E2E_ORIGIN);
    await closeExtraWindows(settingsHandle);
  });

  after(async () => {
    try {
      // Closing the popup denies the request; awaiting it first would wait out the server's 60 s
      // decision deadline, past the hook's timeout.
      await closeExtraWindows(settingsHandle);
      await pendingProve?.catch(() => {});
      pendingProve = null;
      await serve(feed, "none");
    } catch (e) {
      console.error("Verified sites cleanup failed:", e);
    }
  });

  it("badges an accepted list, ignores a tampered one, and drops a removed origin", async function () {
    this.timeout(SEQUENCE_MS);
    const builtIn = firstBuiltIn(newestRecord());
    await serve(feed, "none");

    const handlesBefore = await browser.getWindowHandles();
    pendingProve = fetch(PROVE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream", Origin: E2E_ORIGIN },
      body: new Uint8Array([0]),
    });
    const popup = await waitForNewWindow(handlesBefore);
    expect(popup).not.toBeNull();
    await browser.switchToWindow(popup as string);
    await waitForActivePopup(E2E_ORIGIN);

    // 1. Nothing served: only the built-in list answers.
    expect(await verifiedName(E2E_ORIGIN)).toBeNull();
    if (builtIn) expect(await verifiedName(builtIn.origin)).toBe(builtIn.name);
    expect(await browser.$("#recognized").isDisplayed()).toBe(false);

    // 2. A newer signed list replaces the built-in one whole.
    await serve(feed, "with");
    await until("the accepted list never named the E2E origin", async () => {
      return (await verifiedName(E2E_ORIGIN)) === E2E_NAME;
    });
    if (builtIn) expect(await verifiedName(builtIn.origin)).toBeNull();
    expect(await reloadedBadge()).toBe(E2E_NAME);

    // 3. A bad signature is refused: two serves later nothing has moved.
    await serve(feed, "tampered");
    await until("the feed did not serve the tampered list twice", async () => {
      const status = (await (await fetch(feed.control)).json()) as ControlStatus;
      return status.served.tampered >= 2;
    });
    expect(await verifiedName(E2E_ORIGIN)).toBe(E2E_NAME);
    expect(await reloadedBadge()).toBe(E2E_NAME);

    // 4. A later list without the origin takes its badge away.
    await serve(feed, "without");
    await until("the later list never removed the E2E origin", async () => {
      return (await verifiedName(E2E_ORIGIN)) === null;
    });
    expect(await reloadedBadge()).toBeNull();

    // 5. The badge never grants anything: the request is still the user's to refuse.
    await decidePopup(popup as string, "#deny");
    const response = await pendingProve;
    pendingProve = null;
    expect(response.status).toBe(403);
  });
});

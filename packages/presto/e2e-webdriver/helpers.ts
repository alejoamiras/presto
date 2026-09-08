/**
 * Shared helpers for WebDriver E2E tests.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export const CONFIG_PATH = path.join(os.homedir(), ".presto", "config.json");

/** Read the presto config. Returns default shape if file doesn't exist (fresh CI). */
export function readConfig(): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
  } catch {
    return { config_version: 1, https_enabled: false, approved_origins: [], speed: "full" };
  }
}

const SETTINGS_TITLE = "Presto Settings";

/**
 * Anchor the session on the Settings window before a spec interacts with it.
 *
 * `smoke.spec` and `settings.spec` assume the active window IS Settings — but
 * any stray window (an update prompt, a future dialog, a leftover popup) can
 * leave WebDriver's active context pointing elsewhere, making static elements
 * like `#speed-label` appear "not found". This switches to the Settings window
 * explicitly and waits for it to be ready.
 *
 * It deliberately does NOT navigate/create a Settings window if none exists —
 * the bootstrap window is supposed to be there, so its absence is a real
 * regression and we fail loudly rather than masking it.
 */
export async function ensureSettingsWindow(): Promise<void> {
  const handles = await browser.getWindowHandles();
  for (const handle of handles) {
    await browser.switchToWindow(handle);
    if ((await browser.getTitle()) === SETTINGS_TITLE) {
      await browser.$("#speed-label").waitForExist({ timeout: 5000 });
      return;
    }
  }
  throw new Error(
    `Settings window not found among ${handles.length} window(s) — expected the bootstrap "${SETTINGS_TITLE}" window to be open.`,
  );
}

const IS_LINUX = os.platform() === "linux";

/**
 * Click an element by CSS selector. On Linux (WebKitGTK), both native elementClick
 * and browser.execute() return "Unsupported result type" — but the click DOES fire.
 * The error occurs because the click handler closes the window (e.g. respond_auth),
 * and the WebDriver response is lost. We catch and ignore these errors.
 */
export async function clickBy(selector: string): Promise<void> {
  try {
    if (IS_LINUX) {
      await browser.execute((sel: string) => {
        const el = document.querySelector(sel) as HTMLElement;
        if (!el) throw new Error(`clickBy: element not found for "${sel}"`);
        el.click();
      }, selector);
    } else {
      const el = await browser.$(selector);
      await el.click();
    }
  } catch (err) {
    // On WebKitGTK, clicks that close the window return "Unsupported result type"
    // or "No window could be found" — but the click succeeded. Only swallow these
    // known errors; re-throw genuine failures (wrong selector, element not found).
    const msg = String(err);
    if (
      !msg.includes("Unsupported result") &&
      !msg.includes("No window") &&
      !msg.includes("no such window")
    ) {
      throw err;
    }
  }
  await browser.pause(300);
}

/**
 * Remove an approved origin via the Settings UI (Remove button).
 * This triggers the real IPC call which updates both in-memory config and disk.
 */
export async function removeOriginViaUI(origin: string): Promise<void> {
  const url = await browser.getUrl();
  if (!url.includes("settings.html")) {
    await browser.navigateTo("tauri://localhost/settings.html");
    await browser.pause(500);
  }

  const speedLabel = await browser.$("#speed-label");
  await speedLabel.waitForExist({ timeout: 5000 });

  await browser.refresh();
  await browser.pause(500);

  const items = await browser.$$(".origin-item");
  for (const item of items) {
    const span = await item.$("span");
    const text = await span.getText();
    if (text === origin) {
      // Use JS click to trigger IPC — native clicks return malformed response on WebKitGTK
      await browser.execute((target: string) => {
        const items = document.querySelectorAll(".origin-item");
        for (const li of items) {
          if (li.querySelector("span")?.textContent === target) {
            (li.querySelector("button") as HTMLElement)?.click();
            return;
          }
        }
      }, origin);
      await browser.pause(500);
      return;
    }
  }
}

/** Close all windows except Settings, then switch back to Settings. */
export async function closeExtraWindows(settingsHandle: string): Promise<void> {
  const handles = await browser.getWindowHandles();
  for (const h of handles) {
    if (h !== settingsHandle) {
      await browser.switchToWindow(h);
      await browser.closeWindow();
    }
  }
  if (handles.includes(settingsHandle)) {
    await browser.switchToWindow(settingsHandle);
  }
}

/** Poll getWindowHandles() until a new handle appears (up to 15s). */
export async function waitForNewWindow(existingHandles: string[]): Promise<string | null> {
  for (let i = 0; i < 30; i++) {
    await browser.pause(500);
    const handlesNow = await browser.getWindowHandles();
    const newHandle = handlesNow.find((h) => !existingHandles.includes(h));
    if (newHandle) return newHandle;
  }
  return null;
}

/**
 * After switching to the (active) auth window: wait until the SERVER origin renders — C9 (D8) sources the
 * origin from `get_pending_auth`, not the URL, so `#origin` starts as a placeholder and updates async —
 * AND let the C9 (A) click-steal guard's ~700 ms window elapse so the Allow/Deny clicks aren't ignored.
 */
export async function waitForActivePopup(origin: string): Promise<void> {
  await browser.waitUntil(async () => (await browser.$("#origin").getText()) === origin, {
    timeout: 8000,
    timeoutMsg: "auth popup did not render the server origin",
  });
  await browser.pause(900); // let the 700ms click-steal guard elapse
}

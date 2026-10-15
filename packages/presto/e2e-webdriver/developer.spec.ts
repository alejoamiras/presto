/**
 * Developer mode against the real IPC bridge: the switch must reach `config.json`, and turning it off
 * must write the default block, which is what an older build or a later launch reads.
 */
import { ensureSettingsWindow, readConfig } from "./helpers.ts";

const DEFAULT_BLOCK = { enabled: false, update_channel: "stable" };

const developerOnDisk = () => readConfig().developer as Record<string, unknown> | undefined;

/** The switch ships disabled until the stored value is known; a click before that is undone. */
async function waitForHydration(): Promise<void> {
  await browser.waitUntil(
    async () =>
      await browser.execute(() => {
        const el = document.querySelector<HTMLInputElement>("#developer");
        return el !== null && !el.disabled;
      }),
    { timeout: 5000, timeoutMsg: "the developer mode switch never became enabled" },
  );
}

async function setDeveloperMode(on: boolean): Promise<void> {
  await waitForHydration();
  await browser.execute((wanted: boolean) => {
    (document.getElementById("advanced") as HTMLDetailsElement).open = true;
    const el = document.getElementById("developer") as HTMLInputElement;
    if (el.checked !== wanted) el.click();
  }, on);
  await browser.waitUntil(
    async () =>
      developerOnDisk()?.enabled === on &&
      (await browser.execute(
        () => !(document.getElementById("developer-section") as HTMLElement).hidden,
      )) === on,
    { timeout: 5000, timeoutMsg: `developer mode never settled ${on ? "on" : "off"}` },
  );
}

describe("Developer mode", () => {
  before(async () => {
    await ensureSettingsWindow();
    await browser.refresh();
  });

  after(async () => {
    try {
      await setDeveloperMode(false);
    } catch (e) {
      console.error("Developer mode cleanup failed:", e);
    }
  });

  it("should start off with the Developer section hidden", async () => {
    await waitForHydration();
    expect(
      await browser.execute(
        () => (document.getElementById("developer") as HTMLInputElement).checked,
      ),
    ).toBe(false);
    expect(
      await browser.execute(
        () => (document.getElementById("developer-section") as HTMLElement).hidden,
      ),
    ).toBe(true);
  });

  it("should persist on, survive a reload, and write the default block when turned off", async () => {
    await setDeveloperMode(true);
    expect(developerOnDisk()).toEqual({ ...DEFAULT_BLOCK, enabled: true });

    await browser.refresh();
    await waitForHydration();
    expect(
      await browser.execute(() => ({
        checked: (document.getElementById("developer") as HTMLInputElement).checked,
        open: (document.getElementById("advanced") as HTMLDetailsElement).open,
      })),
    ).toEqual({ checked: true, open: true });

    await setDeveloperMode(false);
    expect(developerOnDisk()).toEqual(DEFAULT_BLOCK);
  });
});

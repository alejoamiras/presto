/**
 * Developer mode against the real IPC bridge: the switch must reach `config.json`, and turning it off
 * must write the default block, which is what an older build or a later launch reads. Joining the
 * candidate channel runs one check, answered by this build's stub update task.
 */
import { ensureSettingsWindow, invokeHere, readConfig } from "./helpers.ts";

const DEFAULT_BLOCK = { enabled: false, update_channel: "stable" };

const developerOnDisk = () => readConfig().developer as Record<string, unknown> | undefined;

/** The switch ships disabled until the stored value is known, so wait for it before a click. */
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

/** `refresh` can return while the old document still answers, so wait for a fresh one to hydrate. */
async function reloadSettings(): Promise<void> {
  await browser.execute(() => {
    (window as unknown as { __beforeReload?: boolean }).__beforeReload = true;
  });
  await browser.refresh();
  await browser.waitUntil(
    async () =>
      await browser.execute(
        () =>
          !(window as unknown as { __beforeReload?: boolean }).__beforeReload &&
          document.querySelector<HTMLInputElement>("#developer")?.disabled === false,
      ),
    { timeout: 5000, timeoutMsg: "Settings never hydrated after a reload" },
  );
}

async function setDeveloperMode(on: boolean): Promise<void> {
  await waitForHydration();
  await browser.execute((wanted: boolean) => {
    (document.getElementById("advanced") as HTMLDetailsElement).open = true;
    const el = document.getElementById("developer") as HTMLInputElement;
    if (el.checked !== wanted) el.click();
    // Turning it off while a release candidate runs on that channel asks first.
    if (!(document.getElementById("developer-off-check") as HTMLElement).hidden) {
      (document.getElementById("developer-off-confirm") as HTMLElement).click();
    }
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
    await reloadSettings();
  });

  after(async () => {
    try {
      await setDeveloperMode(false);
    } catch (e) {
      console.error("Developer mode cleanup failed:", e);
    }
  });

  it("should start off with the Developer section hidden", async () => {
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

    await reloadSettings();
    expect(
      await browser.execute(() => ({
        checked: (document.getElementById("developer") as HTMLInputElement).checked,
        open: (document.getElementById("advanced") as HTMLDetailsElement).open,
      })),
    ).toEqual({ checked: true, open: true });

    await setDeveloperMode(false);
    expect(developerOnDisk()).toEqual(DEFAULT_BLOCK);
  });

  it("should join from Settings, show the check's result, and reset the channel when turned off", async () => {
    await setDeveloperMode(true);
    await browser.execute(() =>
      (document.querySelector('#channel input[value="rc"]') as HTMLInputElement).click(),
    );
    await browser.waitUntil(
      async () =>
        (await browser.execute(() => document.getElementById("channel-result")?.textContent)) ===
          "Up to date" && developerOnDisk()?.update_channel === "rc",
      { timeout: 10000, timeoutMsg: "the join never showed the check's result with rc on disk" },
    );
    expect(developerOnDisk()).toEqual({ enabled: true, update_channel: "rc" });

    await setDeveloperMode(false);
    expect(developerOnDisk()).toEqual(DEFAULT_BLOCK);
  });

  it("should refuse the channel while developer mode is off", async () => {
    const before = readConfig().developer;
    const refused = await invokeHere("set_update_channel", { channel: "rc" });
    expect(refused.resolved).toBe(false);
    expect(refused.error ?? "").toContain("developer mode is off");
    expect(readConfig().developer).toEqual(before);
  });
});

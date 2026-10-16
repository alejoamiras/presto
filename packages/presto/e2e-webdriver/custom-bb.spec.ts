/**
 * The custom bb end to end: Settings reviews, test-runs and pins a real file for one label, the
 * consent popup says so, and a request naming that label is proved by that exact file. The file is
 * a copy of the shipped sidecar, staged by the launcher and handed to the picker through
 * `PRESTO_E2E_CUSTOM_BB_PATH`, so its proof must equal the fixture byte for byte.
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  buildJob,
  checkOutputs,
  loadFixture,
  type ProveResponse,
} from "../scripts/ultra-honk-smoke-checks.ts";
import {
  closeExtraWindows,
  decidePopup,
  ensureSettingsWindow,
  readConfig,
  reloadSettings,
  removeOriginViaUI,
  setDeveloperMode,
  waitForActivePopup,
  waitForNewWindow,
} from "./helpers.ts";

const ORIGIN = "https://custom-bb.example.com";
const PROVE_URL = "http://127.0.0.1:59833/prove/ultra-honk";
const REPO_ROOT = path.join(import.meta.dirname, "..", "..", "..");

function post(job: Record<string, string>, label: string): Promise<Response> {
  return fetch(PROVE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, "x-aztec-version": label },
    body: JSON.stringify(job),
  });
}

const pinOnDisk = () =>
  (readConfig().developer as { custom_bb?: { label: string; sha256: string } } | undefined)
    ?.custom_bb;

/** Clicks through the page itself: native clicks lose their response on WebKitGTK. */
const click = (id: string) =>
  browser.execute((target: string) => (document.getElementById(target) as HTMLElement).click(), id);

async function waitForText(id: string, wanted: (text: string) => boolean, what: string) {
  await browser.waitUntil(
    async () =>
      wanted(
        await browser.execute(
          (target: string) => document.getElementById(target)?.textContent ?? "",
          id,
        ),
      ),
    { timeout: 20_000, timeoutMsg: what },
  );
}

/** The review either shows the file's hash or refuses it; a refusal fails at once, with its reason. */
async function waitForReview(sha256: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const [facts, refusal] = await browser.execute((): [string, string] => [
      document.getElementById("custom-bb-review-facts")?.textContent ?? "",
      document.getElementById("custom-bb-refused")?.hidden === false
        ? (document.getElementById("custom-bb-refused-message")?.textContent ?? "")
        : "",
    ]);
    if (refusal) throw new Error(`the review refused the staged file: ${refusal}`);
    if (facts.includes(sha256)) return;
    if (Date.now() > deadline) throw new Error("the review never showed the staged file's hash");
    await browser.pause(250);
  }
}

async function enabled(id: string): Promise<void> {
  await browser.waitUntil(
    async () =>
      await browser.execute(
        (target: string) =>
          (document.getElementById(target) as HTMLButtonElement).disabled === false,
        id,
      ),
    { timeout: 10_000, timeoutMsg: `#${id} never became enabled` },
  );
}

describe("Custom bb", () => {
  const fixture = loadFixture(REPO_ROOT, "square");
  const staged = process.env.PRESTO_E2E_CUSTOM_BB_PATH;
  let settingsHandle: string;

  before(async () => {
    if (!staged) throw new Error("PRESTO_E2E_CUSTOM_BB_PATH is not set; the launcher stages it");
    await ensureSettingsWindow();
    settingsHandle = await browser.getWindowHandle();
    await removeOriginViaUI(ORIGIN);
    await reloadSettings();
  });

  after(async () => {
    try {
      await closeExtraWindows(settingsHandle);
      await setDeveloperMode(false);
      await removeOriginViaUI(ORIGIN);
    } catch (e) {
      console.error("Custom bb cleanup failed:", e);
    }
  });

  it("pins the reviewed file for one label, proves with it, and stops", async function () {
    this.timeout(180_000);
    await setDeveloperMode(true);

    // The hash, not the path: canonical paths differ in spelling across OSes (`/private/var`, case).
    const sha256 = createHash("sha256")
      .update(fs.readFileSync(staged as string))
      .digest("hex");
    await enabled("custom-bb-choose");
    await click("custom-bb-choose");
    await waitForReview(sha256);

    await click("custom-bb-tick");
    await enabled("custom-bb-test");
    await click("custom-bb-test");
    await waitForText(
      "custom-bb-test-result",
      (text) => text.startsWith("✓ Test run passed"),
      "the test run never passed",
    );
    // The suggestion is the bundled version (the file is the sidecar): the custom route must beat
    // the bundled shortcut while pinned, and the stop must hand the same request back to it.
    const label: string = await browser.execute(
      () => (document.getElementById("custom-bb-label") as HTMLInputElement).value,
    );
    expect(label).toMatch(/^\d+\.\d+\.\d+/);
    await enabled("custom-bb-use");
    await click("custom-bb-use");
    await browser.waitUntil(async () => pinOnDisk()?.label === label, {
      timeout: 10_000,
      timeoutMsg: "the pin never reached config.json",
    });
    expect(pinOnDisk()?.sha256).toBe(sha256);
    await waitForText(
      "custom-bb-banner-title",
      (text) => text === "Custom bb is on",
      "the banner never said the custom bb is on",
    );

    const handlesBefore = await browser.getWindowHandles();
    const pending = post(buildJob(fixture, true), label);
    const popup = await waitForNewWindow(handlesBefore);
    expect(popup).not.toBeNull();
    await browser.switchToWindow(popup!);
    await waitForActivePopup(ORIGIN);
    expect(
      await browser.execute(() => document.getElementById("custom-bb-line")?.textContent),
    ).toBe(
      `This site asks for bb ${label}. While your custom bb answers that version, it runs these proofs, not the official one.`,
    );
    await decidePopup(popup!, "#allow");

    const response = await pending;
    const text = await response.text();
    if (response.status !== 200) throw new Error(`prove returned ${response.status}: ${text}`);
    expect(response.headers.get("x-presto-bb")).toBe("custom");
    expect(checkOutputs(JSON.parse(text) as ProveResponse, fixture, false)).toEqual([]);

    await browser.switchToWindow(settingsHandle);
    await click("custom-bb-banner-stop");
    await browser.waitUntil(async () => pinOnDisk() === undefined, {
      timeout: 10_000,
      timeoutMsg: "the pin was never removed from config.json",
    });

    // With no pin the same request is an official proof: the bundled bb answers, with no header.
    const repeat = await post(buildJob(fixture, true), label);
    const repeated = await repeat.text();
    if (repeat.status !== 200) throw new Error(`prove returned ${repeat.status}: ${repeated}`);
    expect(repeat.headers.get("x-presto-bb")).toBeNull();
    expect(checkOutputs(JSON.parse(repeated) as ProveResponse, fixture, false)).toEqual([]);
  });
});

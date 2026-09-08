/**
 * `/prove/ultra-honk` through the real app: consent popup, then a native proof of the committed Noir
 * fixture that must equal the bb.js WASM reference byte for byte AND pass the shipped sidecar's own
 * `bb verify`. The two assertions are separate on purpose — a proof that verifies but differs from
 * the reference on some platform is a finding to surface, never a pass.
 */
import * as path from "node:path";

import { getTargetTriple } from "../scripts/copy-bb.ts";
import {
  buildJob,
  checkOutputs,
  loadFixture,
  type ProveResponse,
  verifyNatively,
} from "../scripts/ultra-honk-smoke.ts";
import {
  clickBy,
  closeExtraWindows,
  readConfig,
  removeOriginViaUI,
  waitForActivePopup,
  waitForNewWindow,
} from "./helpers.ts";

const ALLOW_ORIGIN = "https://ultra-honk-allow.example.com";
const DENY_ORIGIN = "https://ultra-honk-deny.example.com";
const PROVE_URL = "http://127.0.0.1:59833/prove/ultra-honk";
const REPO_ROOT = path.join(import.meta.dirname, "..", "..", "..");
/** The bb the app itself runs — the same binary that produced the proof verifies it. */
const SIDECAR_BB = path.join(
  import.meta.dirname,
  "..",
  "src-tauri",
  "binaries",
  `bb-${getTargetTriple()}${process.platform === "win32" ? ".exe" : ""}`,
);

function post(origin: string, job: Record<string, string>): Promise<Response> {
  return fetch(PROVE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(job),
  });
}

/** Fire a job from an unapproved origin, answer the consent popup, and return the response. */
async function proveThroughPopup(
  origin: string,
  job: Record<string, string>,
  button: "#allow" | "#deny",
): Promise<Response> {
  const handlesBefore = await browser.getWindowHandles();
  const pending = post(origin, job);
  const popup = await waitForNewWindow(handlesBefore);
  expect(popup).not.toBeNull();
  await browser.switchToWindow(popup!);
  await waitForActivePopup(origin);
  await clickBy(button);
  return pending;
}

const approvedOrigins = () => (readConfig().approved_origins as string[]) || [];
const unb64 = (text: string) => new Uint8Array(Buffer.from(text, "base64"));

describe("UltraHonk proving", () => {
  const fixture = loadFixture(REPO_ROOT, "square");
  let settingsHandle: string;

  before(async () => {
    settingsHandle = await browser.getWindowHandle();
    await removeOriginViaUI(ALLOW_ORIGIN);
  });

  beforeEach(async () => {
    await closeExtraWindows(settingsHandle);
    await browser.pause(300);
  });

  after(async () => {
    try {
      await closeExtraWindows(settingsHandle);
      await removeOriginViaUI(ALLOW_ORIGIN);
    } catch (e) {
      console.error("UltraHonk cleanup failed:", e);
    }
  });

  it("Allow proves the fixture natively: byte-equal to the WASM reference and sidecar-verified", async function () {
    // The first native proof also fetches the CRS, which the 30 s suite default does not cover.
    this.timeout(180_000);
    const response = await proveThroughPopup(ALLOW_ORIGIN, buildJob(fixture, true), "#allow");
    expect(response.status).toBe(200);
    expect(approvedOrigins()).toContain(ALLOW_ORIGIN);

    const body = (await response.json()) as ProveResponse;
    expect(checkOutputs(body, fixture, false)).toEqual([]);
    expect(
      verifyNatively(
        SIDECAR_BB,
        unb64(body.proof),
        unb64(body.public_inputs),
        fixture.vk,
        fixture.verifierTarget,
      ),
    ).toBe(true);
  });

  it("an unknown verifier_target from the approved origin is a 400 with no consent prompt", async () => {
    const handlesBefore = await browser.getWindowHandles();
    const response = await post(ALLOW_ORIGIN, {
      ...buildJob(fixture, true),
      verifier_target: "bogus",
    });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("verifier_target");
    expect((await browser.getWindowHandles()).length).toBe(handlesBefore.length);
  });

  it("Deny is a 403 before anything runs and persists nothing", async () => {
    const response = await proveThroughPopup(DENY_ORIGIN, buildJob(fixture, true), "#deny");
    expect(response.status).toBe(403);
    expect(response.headers.get("x-prove-duration-ms")).toBeNull();
    expect(approvedOrigins()).not.toContain(DENY_ORIGIN);
  });
});

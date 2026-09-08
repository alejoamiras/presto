import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type Page, type Route, test } from "@playwright/test";

// The Noir panel over a mocked presto. The in-browser path uses `?noirStub=true` (the fixture
// bytes instead of WASM), and every request that only real WASM proving would make — CRS points,
// bb.js workers, `.wasm` — is blocked AND recorded, so a silent WASM run fails this suite instead
// of downloading its way to a pass. Network-free, like the rest of the mocked project.

const fixtureDir = resolve(import.meta.dirname, "../../../fixtures/noir/square");
const fixture = {
  bytecode: JSON.parse(readFileSync(resolve(fixtureDir, "circuit.json"), "utf8"))
    .bytecode as string,
  witness: readFileSync(resolve(fixtureDir, "witness.gz")).toString("base64"),
  vk: readFileSync(resolve(fixtureDir, "vk")).toString("base64"),
  proof: readFileSync(resolve(fixtureDir, "proof")).toString("base64"),
  publicInputs: readFileSync(resolve(fixtureDir, "public_inputs")).toString("base64"),
};

const ORIGINS = ["http://127.0.0.1:59833", "https://127.0.0.1:59834"];
const HTTPS_PROVE_URL = "https://127.0.0.1:59834/prove/ultra-honk";

const HEALTHY = JSON.stringify({
  status: "ok",
  api_version: 1,
  available_versions: ["5.2.0"],
  schemes: ["chonk", "ultra_honk"],
});

async function mockServicesOffline(page: Page) {
  await page.route("**/aztec", (route) =>
    route.fulfill({ status: 503, body: "Service Unavailable" }),
  );
}

/** Block and record what only a real WASM prover would fetch. */
async function forbidWasmTraffic(page: Page): Promise<string[]> {
  const seen: string[] = [];
  const block = (route: Route) => {
    seen.push(route.request().url());
    return route.abort();
  };
  await page.route(/crs\.aztec\.network|\.dat(\?|$)/, block);
  await page.route(/\.wasm(\?|$)/, block);
  await page.route(/worker\.js(\?|$)/, block);
  return seen;
}

/** A healthy presto on both loopback origins; `prove` answers every `/prove/ultra-honk` request. */
async function mockPresto(page: Page, prove: (route: Route) => Promise<void>) {
  for (const origin of ORIGINS) {
    await page.route(`${origin}/health`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: HEALTHY }),
    );
    await page.route(`${origin}/prove/ultra-honk`, prove);
  }
}

/** Records `{ url, job }` per proof request and answers with `body`. */
function proveWith(
  jobs: { url: string; job: Record<string, unknown> }[],
  body: { proof: string; public_inputs: string },
) {
  return (route: Route) => {
    jobs.push({ url: route.request().url(), job: route.request().postDataJSON() });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "x-prove-duration-ms": "42" },
      body: JSON.stringify(body),
    });
  };
}

async function clickProve(page: Page) {
  await expect(page.locator("#noir-btn")).toBeEnabled({ timeout: 10_000 });
  await page.click("#noir-btn");
  await expect(page.locator("#noir-btn")).toHaveText("Proving...");
  await expect(page.locator("#noir-btn")).toHaveText("Prove Noir Circuit", { timeout: 20_000 });
}

async function proveAndWait(page: Page) {
  await clickProve(page);
  await expect(page.locator("#noir-results")).not.toHaveClass(/hidden/);
}

const jsErrors: string[] = [];
test.beforeEach(async ({ page }) => {
  jsErrors.length = 0;
  page.on("pageerror", (err) => jsErrors.push(err.message));
});
test.afterEach(() => {
  expect(jsErrors, "Unexpected JS runtime errors").toEqual([]);
});

test("Presto mode sends the fixture job with its seeded key over HTTPS and renders the native result", async ({
  page,
}) => {
  await mockServicesOffline(page);
  const wasmTraffic = await forbidWasmTraffic(page);
  const jobs: { url: string; job: Record<string, unknown> }[] = [];
  await mockPresto(
    page,
    proveWith(jobs, { proof: fixture.proof, public_inputs: fixture.publicInputs }),
  );
  await page.goto("/");

  await proveAndWait(page);

  expect(jobs).toEqual([
    {
      url: HTTPS_PROVE_URL,
      job: {
        bytecode: fixture.bytecode,
        witness: fixture.witness,
        verifier_target: "noir-recursive-no-zk",
        vk: fixture.vk,
      },
    },
  ]);
  await expect(page.locator("#noir-time-accelerated")).toHaveText(/^\d+\.\d+s$/);
  await expect(page.locator("#noir-tag-accelerated")).toHaveText("identical to fixture");
  await expect(page.locator("#noir-result-accelerated")).toHaveClass(/result-filled/);
  await expect(page.locator("#noir-time-local")).toHaveText("—");
  await expect(page.locator("#log")).toContainText("byte-identical to the bb.js WASM reference");
  await expect(page.locator("#log")).not.toContainText("proving in-browser for now");
  expect(wasmTraffic).toEqual([]);
});

test("a native answer that differs from the fixture is reported, not celebrated", async ({
  page,
}) => {
  await mockServicesOffline(page);
  const wasmTraffic = await forbidWasmTraffic(page);
  const tampered = Buffer.from(fixture.proof, "base64");
  tampered[0] ^= 1;
  await mockPresto(
    page,
    proveWith([], { proof: tampered.toString("base64"), public_inputs: fixture.publicInputs }),
  );
  await page.goto("/");

  await proveAndWait(page);

  await expect(page.locator("#noir-tag-accelerated")).toHaveText("differs from fixture");
  await expect(page.locator("#noir-tag-accelerated")).toHaveClass(/text-brand-danger/);
  await expect(page.locator("#log")).toContainText("Proof differs from the bb.js WASM reference");
  await expect(page.locator("#log")).not.toContainText("byte-identical");
  expect(wasmTraffic).toEqual([]);
});

test("a failing Presto request surfaces the error and restores the button", async ({ page }) => {
  await mockServicesOffline(page);
  const wasmTraffic = await forbidWasmTraffic(page);
  // An unrecognised 500 is a caller-facing error in the SDK's table, not a fallback.
  await mockPresto(page, (route) =>
    route.fulfill({ status: 500, contentType: "text/plain", body: "not_in_the_table" }),
  );
  await page.goto("/");

  await clickProve(page);

  await expect(page.locator("#log")).toContainText("Noir proof failed:");
  await expect(page.locator("#noir-results")).toHaveClass(/hidden/);
  await expect(page.locator("#noir-btn")).toBeEnabled();
  await expect(page.locator("#progress")).toHaveClass(/hidden/);
  expect(wasmTraffic).toEqual([]);
});

test("an offline Presto falls back to the browser and the UI says so", async ({ page }) => {
  await mockServicesOffline(page);
  const wasmTraffic = await forbidWasmTraffic(page);
  const proveAttempts: string[] = [];
  for (const origin of ORIGINS) {
    await page.route(`${origin}/prove/**`, (route) => {
      proveAttempts.push(route.request().url());
      return route.abort();
    });
    await page.route(`${origin}/health`, (route) => route.abort());
  }
  await page.goto("/?noirStub=true");

  await proveAndWait(page);

  await expect(page.locator("#log")).toContainText("Presto's offline, proving in-browser for now");
  await expect(page.locator("#noir-tag-local")).toHaveText("identical to fixture");
  await expect(page.locator("#noir-time-local")).toHaveText(/^\d+\.\d+s$/);
  await expect(page.locator("#noir-time-accelerated")).toHaveText("—");
  expect(proveAttempts).toEqual([]);
  expect(wasmTraffic).toEqual([]);
});

test("in-browser mode never talks to a healthy Presto", async ({ page }) => {
  await mockServicesOffline(page);
  const wasmTraffic = await forbidWasmTraffic(page);
  const jobs: { url: string; job: Record<string, unknown> }[] = [];
  await mockPresto(
    page,
    proveWith(jobs, { proof: fixture.proof, public_inputs: fixture.publicInputs }),
  );
  await page.goto("/?noirStub=true");
  await page.click("#mode-local");

  await proveAndWait(page);

  await expect(page.locator("#noir-tag-local")).toHaveText("identical to fixture");
  await expect(page.locator("#log")).not.toContainText("proving in-browser for now");
  expect(jobs).toEqual([]);
  expect(wasmTraffic).toEqual([]);
});

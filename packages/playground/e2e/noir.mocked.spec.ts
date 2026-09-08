import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";

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
  const block = (route: import("@playwright/test").Route) => {
    seen.push(route.request().url());
    return route.abort();
  };
  await page.route(/crs\.aztec\.network|\.dat(\?|$)/, block);
  await page.route(/\.wasm(\?|$)/, block);
  await page.route(/worker\.js(\?|$)/, block);
  return seen;
}

async function mockPresto(page: Page, jobs: Record<string, unknown>[]) {
  for (const origin of ["http://127.0.0.1:59833", "https://127.0.0.1:59834"]) {
    await page.route(`${origin}/health`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: HEALTHY }),
    );
    await page.route(`${origin}/prove/ultra-honk`, (route) => {
      jobs.push(route.request().postDataJSON());
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "x-prove-duration-ms": "42" },
        body: JSON.stringify({ proof: fixture.proof, public_inputs: fixture.publicInputs }),
      });
    });
  }
}

async function proveAndWait(page: Page) {
  await expect(page.locator("#noir-btn")).toBeEnabled({ timeout: 10_000 });
  await page.click("#noir-btn");
  await expect(page.locator("#noir-btn")).toHaveText("Proving...");
  await expect(page.locator("#noir-btn")).toHaveText("Prove Noir Circuit", { timeout: 20_000 });
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

test("Presto mode sends the fixture job with its seeded key and renders the native result", async ({
  page,
}) => {
  await mockServicesOffline(page);
  const wasmTraffic = await forbidWasmTraffic(page);
  const jobs: Record<string, unknown>[] = [];
  await mockPresto(page, jobs);
  await page.goto("/");

  await proveAndWait(page);

  expect(jobs).toHaveLength(1);
  expect(jobs[0]).toEqual({
    bytecode: fixture.bytecode,
    witness: fixture.witness,
    verifier_target: "noir-recursive-no-zk",
    vk: fixture.vk,
  });
  await expect(page.locator("#noir-time-accelerated")).toHaveText(/^\d+\.\d+s$/);
  await expect(page.locator("#noir-tag-accelerated")).toHaveText("identical to fixture");
  await expect(page.locator("#noir-result-accelerated")).toHaveClass(/result-filled/);
  await expect(page.locator("#noir-time-local")).toHaveText("—");
  await expect(page.locator("#log")).toContainText("byte-identical to the bb.js WASM reference");
  await expect(page.locator("#log")).not.toContainText("proving in-browser for now");
  expect(wasmTraffic).toEqual([]);
});

test("an offline Presto falls back to the browser and the UI says so", async ({ page }) => {
  await mockServicesOffline(page);
  const wasmTraffic = await forbidWasmTraffic(page);
  for (const origin of ["http://127.0.0.1:59833", "https://127.0.0.1:59834"]) {
    await page.route(`${origin}/**`, (route) => route.abort());
  }
  await page.goto("/?noirStub=true");

  await proveAndWait(page);

  await expect(page.locator("#log")).toContainText("Presto's offline, proving in-browser for now");
  await expect(page.locator("#noir-tag-local")).toHaveText("identical to fixture");
  await expect(page.locator("#noir-time-local")).toHaveText(/^\d+\.\d+s$/);
  await expect(page.locator("#noir-time-accelerated")).toHaveText("—");
  expect(wasmTraffic).toEqual([]);
});

test("in-browser mode never talks to Presto", async ({ page }) => {
  await mockServicesOffline(page);
  const wasmTraffic = await forbidWasmTraffic(page);
  const prestoRequests: string[] = [];
  for (const origin of ["http://127.0.0.1:59833", "https://127.0.0.1:59834"]) {
    await page.route(`${origin}/prove/**`, (route) => {
      prestoRequests.push(route.request().url());
      return route.abort();
    });
  }
  await page.goto("/?noirStub=true");
  await page.click("#mode-local");

  await proveAndWait(page);

  await expect(page.locator("#noir-tag-local")).toHaveText("identical to fixture");
  await expect(page.locator("#log")).not.toContainText("proving in-browser for now");
  expect(prestoRequests).toEqual([]);
  expect(wasmTraffic).toEqual([]);
});

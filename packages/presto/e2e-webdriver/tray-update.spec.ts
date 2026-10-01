/**
 * The tray's "Check for Updates…" item in the real app. WebDriver cannot reach a native menu, so the
 * app's WebDriver-only driver clicks it through the production dispatch, reads the native item back,
 * and writes what it saw to `PRESTO_E2E_TRAY_REPORT`; this spec asserts that report.
 */
import * as fs from "node:fs";

interface TrayReport {
  steps: [string, boolean][];
  stub_calls: number;
  launch_calls: number;
  menu_has_item: boolean;
  complete: boolean;
}

const REPORT_WAIT_MS = 60_000;

async function readReport(file: string): Promise<TrayReport> {
  const deadline = Date.now() + REPORT_WAIT_MS;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf-8")) as TrayReport;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`no tray report at ${file} within ${REPORT_WAIT_MS / 1000}s`);
}

describe("Tray: Check for Updates…", () => {
  it("shows each state on the native item and checks once per click", async function () {
    this.timeout(REPORT_WAIT_MS + 10_000);
    const file = process.env.PRESTO_E2E_TRAY_REPORT;
    if (!file)
      throw new Error("PRESTO_E2E_TRAY_REPORT is not set, so the app ran without its tray driver");
    const report = await readReport(file);

    expect(report.menu_has_item).toBe(true);
    expect(report.steps).toEqual([
      ["Check for Updates…", true],
      ["Checking…", false],
      ["Up to date", true],
      ["Check for Updates…", true],
      ["Checking…", false],
      ["Couldn't check — try again", true],
    ]);
    expect(report.complete).toBe(true);
    // The click made while "Checking…" reached no check.
    expect(report.stub_calls).toBe(2);
    expect(report.launch_calls).toBe(1);
  });
});

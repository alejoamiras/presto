import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { VIEWPORT_SIZES } from "./window-sizes.js";

const MOCK_PATH = path.join(import.meta.dirname, "tauri-mock.js");

// ── Helpers ──

async function getCalls(page: Page) {
  return page.evaluate(() => (window as any).__TAURI_MOCK__.calls);
}

async function callsFor(page: Page, cmd: string) {
  const calls = await getCalls(page);
  return calls.filter((c: any) => c.cmd === cmd);
}

// ── Error safety net ──

const jsErrors: string[] = [];

test.beforeEach(async ({ page }) => {
  jsErrors.length = 0;
  page.on("pageerror", (err) => jsErrors.push(err.message));
  await page.addInitScript({ path: MOCK_PATH });
});

test.afterEach(() => {
  expect(jsErrors, "Unexpected JS runtime errors").toEqual([]);
});

// ── Tests ──

test("loads with correct initial state", async ({ page }) => {
  await page.goto("/settings.html");

  // Speed label should show "Full" (default config.speed = "full")
  await expect(page.locator("#speed-label")).toHaveText("Full");

  // Speed description should include CPU count from mock (10)
  await expect(page.locator("#speed-desc")).toContainText("10 cores");

  // Autostart should be unchecked (mock returns false)
  const autostart = page.getByRole("switch", { name: "Start on Login" });
  await expect(autostart).not.toBeChecked();

  // Auto-update should be unchecked (auto_update omitted = falsy)
  const autoUpdate = page.getByRole("switch", { name: "Auto-Update" });
  await expect(autoUpdate).not.toBeChecked();
});

test("shows approved origins list", async ({ page }) => {
  await page.goto("/settings.html");

  // "https://example.com" should be visible from mock get_config
  await expect(page.getByText("https://example.com")).toBeVisible();

  // Empty state should be hidden
  await expect(page.getByText("No approved sites yet")).not.toBeVisible();
});

test("approved origins render with the popup's anti-spoof treatment", async ({ page }) => {
  // Allow is permanent now, so this list is the only way to end a grant — a stored origin must be no
  // more spoofable here than in the popup. Pins the F-014-style hardening (bidi isolation, dir=ltr,
  // selectable text) that shipped for this list without a regression assertion (post-impl codex).
  await page.goto("/settings.html");
  const span = page.locator("#origins .origin-text").first();
  await expect(span).toHaveText("https://example.com");
  await expect(span).toHaveAttribute("dir", "ltr");
  const style = await span.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { bidi: cs.unicodeBidi, select: cs.userSelect };
  });
  expect(style.bidi).toBe("isolate");
  expect(style.select).toBe("text");
});

test("a verified site leads with its name and tick over a muted origin; others stay bare", async ({
  page,
}) => {
  const verified = "https://playground.presto.build";
  const failing = "https://lookup-fails.example";
  await page.addInitScript(
    ([v, f]) => {
      const mock = (window as any).__TAURI_MOCK__;
      mock.setHandler("get_config", () => ({
        config_version: 1,
        https_enabled: false,
        approved_origins: [v, "https://example.com", f],
        speed: "full",
        theme: "system",
        onboarding_version: 1,
      }));
      mock.setHandler("get_verified_info", ({ origin }: { origin: string }) => {
        if (origin === f) throw new Error("ipc down");
        return origin === v ? { display_name: "Presto Playground" } : null;
      });
    },
    [verified, failing],
  );
  await page.goto("/settings.html");

  const rows = page.locator("#origins .origin-item");
  await expect(rows).toHaveCount(3);
  const first = rows.nth(0);
  await expect(first.locator(".site-name")).toHaveText("Presto Playground");
  await expect(first.getByRole("img", { name: "Verified by Presto maintainers" })).toBeVisible();
  // The origin is still the whole, selectable, bidi-isolated text Remove acts on, only quieter.
  const origin = first.locator(".origin-text");
  await expect(origin).toHaveText(verified);
  await expect(origin).toHaveClass(/\bquiet\b/);
  await expect(origin).toHaveAttribute("dir", "ltr");
  expect(await origin.evaluate((el) => getComputedStyle(el).unicodeBidi)).toBe("isolate");

  // An unlisted origin, and one whose lookup failed, render exactly as before.
  for (const i of [1, 2]) {
    await expect(rows.nth(i).locator(".site-name")).toHaveCount(0);
    await expect(rows.nth(i).locator(".origin-text")).not.toHaveClass(/\bquiet\b/);
  }
  const asked = (await callsFor(page, "get_verified_info")).map((c: any) => c.args.origin);
  expect(asked.sort()).toEqual([verified, "https://example.com", failing].sort());
});

test("shows empty state when no origins", async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__TAURI_MOCK__.setHandler("get_config", () => ({
      config_version: 1,
      https_enabled: false,
      approved_origins: [],
      speed: "full",
    }));
  });
  await page.goto("/settings.html");

  await expect(page.getByText("No approved sites yet")).toBeVisible();
  // Regression guard: the message must sit INSIDE the bordered well. It used to render below an
  // unbordered fixed-height list, which read as a black void with a stranded caption.
  await expect(page.locator(".well #origins-empty")).toHaveCount(1);
});

test("remove origin calls invoke and re-renders", async ({ page }) => {
  // After remove, return empty origins on the second get_config call
  await page.addInitScript(() => {
    let callCount = 0;
    (window as any).__TAURI_MOCK__.setHandler("get_config", () => {
      callCount++;
      return {
        config_version: 1,
        https_enabled: false,
        approved_origins: callCount === 1 ? ["https://example.com"] : [],
        speed: "full",
      };
    });
  });
  await page.goto("/settings.html");

  // Origin should be visible initially
  await expect(page.getByText("https://example.com")).toBeVisible();

  // Click Remove
  // Scoped to the list: the certificate action is also named "Remove" (inside a closed disclosure),
  // so an unscoped role query would be ambiguous under Playwright strict mode.
  await page.locator("#origins").getByRole("button", { name: "Remove" }).click();

  // Should call remove_approved_origin then reload settings
  const removeCalls = await callsFor(page, "remove_approved_origin");
  expect(removeCalls.length).toBe(1);
  expect(removeCalls[0].args).toEqual({ origin: "https://example.com" });

  // After re-render, empty state should show
  await expect(page.getByText("No approved sites yet")).toBeVisible();
});

test("a reload that stalls after reading the config cannot repaint a removed site", async ({
  page,
}) => {
  // Remove A, and hold that reload after its config read (it saw [B]); remove B, whose reload
  // paints the empty list; then release the first. It must not bring B back.
  await page.addInitScript(() => {
    const w = window as any;
    const approved = ["https://a.example", "https://b.example"];
    w.__hold = false;
    w.__release = null;
    w.__TAURI_MOCK__.setHandler("get_config", () => ({
      config_version: 1,
      https_enabled: false,
      approved_origins: [...approved],
      speed: "full",
    }));
    w.__TAURI_MOCK__.setHandler("remove_approved_origin", ({ origin }: { origin: string }) => {
      approved.splice(approved.indexOf(origin), 1);
      return null;
    });
    const healthy = {
      intentEnabled: false,
      healthy: true,
      unreadable: false,
      pointsElsewhere: false,
      canRepairNow: true,
      storedPath: null,
    };
    w.__TAURI_MOCK__.setHandler("get_autostart_enabled", () => {
      if (!w.__hold) return healthy;
      w.__hold = false;
      return new Promise((resolve) => {
        w.__release = () => resolve(healthy);
      });
    });
  });
  await page.goto("/settings.html");
  const rows = page.locator("#origins .origin-item");
  await expect(rows).toHaveCount(2);
  const remove = (origin: string) =>
    rows.filter({ hasText: origin }).getByRole("button", { name: "Remove" }).click();

  await page.evaluate(() => {
    (window as any).__hold = true;
  });
  await remove("https://a.example");
  await page.waitForFunction(() => typeof (window as any).__release === "function");
  await remove("https://b.example");
  await expect(page.getByText("No approved sites yet")).toBeVisible();

  const lookups = (await callsFor(page, "get_verified_info")).length;
  await page.evaluate(() => (window as any).__release());
  // The released reload looks B up before it may paint; wait for that, then for its paint turn.
  await page.waitForFunction(
    (n) =>
      (window as any).__TAURI_MOCK__.calls.filter((c: any) => c.cmd === "get_verified_info")
        .length > n,
    lookups,
  );
  await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
  await expect(rows).toHaveCount(0);
  await expect(page.getByText("No approved sites yet")).toBeVisible();
});

test("speed slider input event updates label without IPC", async ({ page }) => {
  await page.goto("/settings.html");

  // Dispatch input event (drag) — should update label but NOT call set_speed
  await page.locator("#speed").evaluate((el: HTMLInputElement) => {
    el.value = "2";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });

  await expect(page.locator("#speed-label")).toHaveText("Balanced");
  await expect(page.locator("#speed-desc")).toContainText("5 of 10 cores");

  // No set_speed call — input event is UI-only
  const speedCalls = await callsFor(page, "set_speed");
  expect(speedCalls.length).toBe(0);
});

test("speed slider change event calls set_speed", async ({ page }) => {
  await page.goto("/settings.html");

  await page.locator("#speed").evaluate((el: HTMLInputElement) => {
    el.value = "2";
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });

  const speedCalls = await callsFor(page, "set_speed");
  expect(speedCalls.length).toBe(1);
  expect(speedCalls[0].args).toEqual({ speed: "balanced" });
});

test("autostart toggle calls set_autostart", async ({ page }) => {
  await page.goto("/settings.html");

  // Checkbox is visually hidden (0x0 CSS) — toggle via JS to trigger change event
  await page.locator("#autostart").evaluate((el: HTMLInputElement) => {
    el.checked = true;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });

  const calls = await callsFor(page, "set_autostart");
  expect(calls.length).toBe(1);
  expect(calls[0].args).toEqual({ enabled: true });
});

test("toggle error reverts checkbox and shows hint", async ({ page }) => {
  // Make set_autostart fail
  await page.addInitScript(() => {
    (window as any).__TAURI_MOCK__.setHandler("set_autostart", () => {
      throw new Error("Autostart failed");
    });
  });
  await page.goto("/settings.html");

  const toggle = page.locator("#autostart");
  await expect(toggle).not.toBeChecked();

  await toggle.evaluate((el: HTMLInputElement) => {
    el.checked = true;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });

  // Should revert to unchecked and show error hint
  await expect(toggle).not.toBeChecked();
  await expect(page.locator(".error-hint")).toBeVisible();
  await expect(page.locator(".error-hint")).toHaveText("Failed. Try again");
});

// ── Autostart health row (plan D17: the switch shows INTENT, the row shows HEALTH) ──

function autostartStatus(overrides: Record<string, unknown>) {
  return {
    intentEnabled: false,
    healthy: true,
    unreadable: false,
    pointsElsewhere: false,
    canRepairNow: true,
    storedPath: null,
    ...overrides,
  };
}

test("health row is hidden for a healthy entry", async ({ page }) => {
  await page.addInitScript(
    (st) => {
      (window as any).__TAURI_MOCK__.setHandler("get_autostart_enabled", () => st);
    },
    autostartStatus({ intentEnabled: true }),
  );
  await page.goto("/settings.html");
  await expect(page.locator("#autostart")).toBeChecked();
  await expect(page.locator("#autostart-health")).toBeHidden();
});

test("broken + repairable: switch stays ON, warning row + Fix button shown, Fix repairs", async ({
  page,
}) => {
  await page.addInitScript(
    (st) => {
      (window as any).__TAURI_MOCK__.setHandler("get_autostart_enabled", () => st);
    },
    autostartStatus({ intentEnabled: true, healthy: false, canRepairNow: true }),
  );
  await page.goto("/settings.html");

  // D17: intent is still ON — an unchecked switch would take away the user's only OFF control.
  await expect(page.locator("#autostart")).toBeChecked();
  await expect(page.locator("#autostart-health")).toBeVisible();
  await expect(page.locator("#autostart-health-text")).toHaveText(
    "Start on Login points to a file that no longer exists.",
  );
  const fix = page.locator("#autostart-fix");
  await expect(fix).toBeVisible();

  // Fix goes through the DEDICATED repair command (plan D16 — set_autostart(true) is structurally
  // a no-op on a broken entry), and the row re-renders from the returned status.
  await fix.click();
  const repairs = await callsFor(page, "repair_autostart");
  expect(repairs.length).toBe(1);
  await expect(page.locator("#autostart-health")).toBeHidden();
  await expect(page.locator("#autostart")).toBeChecked();
});

test("broken + not repairable now: reopen copy, no Fix button", async ({ page }) => {
  // D14: the app itself was moved while running — a Fix would silently no-op, so it isn't offered.
  await page.addInitScript(
    (st) => {
      (window as any).__TAURI_MOCK__.setHandler("get_autostart_enabled", () => st);
    },
    autostartStatus({ intentEnabled: true, healthy: false, canRepairNow: false }),
  );
  await page.goto("/settings.html");

  await expect(page.locator("#autostart")).toBeChecked();
  await expect(page.locator("#autostart-health-text")).toHaveText(
    "Start on Login needs repair. Reopen Presto from its new location.",
  );
  await expect(page.locator("#autostart-fix")).toBeHidden();
});

test("points-elsewhere: informational copy, no Fix (a healthy entry is never stolen)", async ({
  page,
}) => {
  await page.addInitScript(
    (st) => {
      (window as any).__TAURI_MOCK__.setHandler("get_autostart_enabled", () => st);
    },
    autostartStatus({ intentEnabled: true, pointsElsewhere: true }),
  );
  await page.goto("/settings.html");

  await expect(page.locator("#autostart")).toBeChecked();
  await expect(page.locator("#autostart-health-text")).toContainText("another copy");
  await expect(page.locator("#autostart-fix")).toBeHidden();
});

test("turning OFF from a broken state still works (D17)", async ({ page }) => {
  await page.addInitScript(
    (st) => {
      (window as any).__TAURI_MOCK__.setHandler("get_autostart_enabled", () => st);
    },
    autostartStatus({ intentEnabled: true, healthy: false, canRepairNow: true }),
  );
  await page.goto("/settings.html");

  await page.locator("#autostart").evaluate((el: HTMLInputElement) => {
    el.checked = false;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });

  const calls = await callsFor(page, "set_autostart");
  expect(calls.length).toBe(1);
  expect(calls[0].args).toEqual({ enabled: false });
});

test("unreadable entry keeps the switch usable and says how to reset it", async ({ page }) => {
  // An artifact we can't parse is NOT unknown state: the user must keep both controls. An earlier
  // draft surfaced this as a command error, which left the switch permanently disabled with no
  // way back — worse than the plugin it replaced.
  await page.addInitScript(
    (st) => {
      (window as any).__TAURI_MOCK__.setHandler("get_autostart_enabled", () => st);
    },
    autostartStatus({ intentEnabled: true, healthy: false, unreadable: true, canRepairNow: true }),
  );
  await page.goto("/settings.html");

  const toggle = page.locator("#autostart");
  await expect(toggle).toBeEnabled();
  await expect(toggle).toBeChecked();
  await expect(page.locator("#autostart-health-text")).toContainText("couldn't be read");
  // No Fix: the heal deliberately never rewrites an artifact it cannot parse.
  await expect(page.locator("#autostart-fix")).toBeHidden();

  // The reset path is the switch itself.
  await toggle.evaluate((el: HTMLInputElement) => {
    el.checked = false;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const calls = await callsFor(page, "set_autostart");
  expect(calls[0].args).toEqual({ enabled: false });
});

test("repair failure shows a hint and keeps the row", async ({ page }) => {
  await page.addInitScript(
    (st) => {
      (window as any).__TAURI_MOCK__.setHandler("get_autostart_enabled", () => st);
      (window as any).__TAURI_MOCK__.setHandler("repair_autostart", () => {
        throw "repair skipped: updater active";
      });
    },
    autostartStatus({ intentEnabled: true, healthy: false, canRepairNow: true }),
  );
  await page.goto("/settings.html");

  await page.locator("#autostart-fix").click();
  // Backend messages are actionable — surfaced verbatim, not flattened to a generic failure.
  await expect(page.locator(".error-hint")).toHaveText("repair skipped: updater active");
  await expect(page.locator("#autostart-health")).toBeVisible();
  await expect(page.locator("#autostart-fix")).toBeEnabled();
});

test("Encrypted Connection section visible on macOS", async ({ page }) => {
  await page.goto("/settings.html");
  await expect(page.locator("#https-section")).toBeVisible();
});

test("Encrypted Connection section visible on Linux (NSS trust backend)", async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__TAURI_MOCK__.setHandler("get_system_info", () => ({
      platform: "linux",
      cpu_count: 8,
    }));
  });
  await page.goto("/settings.html");

  await expect(page.locator("#https-section")).toBeVisible();
});

test("Encrypted Connection section visible on Windows (CurrentUser Root trust backend)", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).__TAURI_MOCK__.setHandler("get_system_info", () => ({
      platform: "windows",
      cpu_count: 8,
    }));
  });
  await page.goto("/settings.html");

  await expect(page.locator("#https-section")).toBeVisible();
});

test("the certificate action is collapsed behind a disclosure, not sitting in the open", async ({
  page,
}) => {
  // It IS a real action (the documented recovery path for a partially-trusted install), but it must
  // not compete with the toggles for attention or invite a stray click.
  await page.goto("/settings.html");
  const details = page.locator("#cert-details");
  await expect(details).toBeVisible();
  await expect(details).not.toHaveAttribute("open", "");
  await expect(page.locator("#remove-trust")).toBeHidden();

  await details.locator("summary").click();
  await expect(page.locator("#remove-trust")).toBeVisible();
});

test("https toggle calls enable/disable commands", async ({ page }) => {
  await page.goto("/settings.html");

  // Enable HTTPS — should call enable_https
  await page.locator("#https").evaluate((el: HTMLInputElement) => {
    el.checked = true;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const enableCalls = await callsFor(page, "enable_https");
  expect(enableCalls.length).toBe(1);

  // Disable HTTPS — should call disable_https
  await page.locator("#https").evaluate((el: HTMLInputElement) => {
    el.checked = false;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const disableCalls = await callsFor(page, "disable_https");
  expect(disableCalls.length).toBe(1);
});

test("a failed enable_https shows the persisted state, not the failure", async ({ page }) => {
  // The restart-required path: `enable_https` persists `https_enabled = true` and STILL returns Err
  // ("restart to finish enabling"). An optimistic revert showed the switch OFF while the config — and
  // the next launch — said ON, and re-toggling only reproduced the error. The panel must re-read.
  await page.addInitScript(() => {
    let enabled = false;
    (window as any).__TAURI_MOCK__.setHandler("get_config", () => ({
      config_version: 1,
      https_enabled: enabled,
      approved_origins: [],
      speed: "full",
    }));
    (window as any).__TAURI_MOCK__.setHandler("enable_https", () => {
      enabled = true; // committed...
      throw "HTTPS is set up, but the running server is still using a previous certificate."; // ...then failed
    });
  });
  await page.goto("/settings.html");
  await expect(page.locator("#https")).not.toBeChecked();

  await page.locator("#https").evaluate((el: HTMLInputElement) => {
    el.checked = true;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });

  // Reflects what the backend actually stored...
  await expect(page.locator("#https")).toBeChecked();
  // ...and says why, in the backend's own words — "Failed. Try again" would hide the restart.
  await expect(page.getByText("still using a previous certificate")).toBeVisible();
});

test("the certificate action and the https toggle disable each other while one runs", async ({
  page,
}) => {
  // Both routes into the same Rust lifecycle mutex. It serializes them correctly, but leaving the
  // other control live let the user queue an operation against state they could no longer see.
  await page.addInitScript(() => {
    (window as any).__TAURI_MOCK__.setHandler(
      "enable_https",
      () => new Promise((resolve) => setTimeout(() => resolve(null), 300)),
    );
  });
  await page.goto("/settings.html");
  await page.locator("#cert-details summary").click();

  await page.locator("#https").evaluate((el: HTMLInputElement) => {
    el.checked = true;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });

  await expect(page.locator("#remove-trust")).toBeDisabled();
  await expect(page.locator("#https")).toBeDisabled();
  // Both come back once the operation settles.
  await expect(page.locator("#remove-trust")).toBeEnabled();
  await expect(page.locator("#https")).toBeEnabled();
});

test("auto-update toggle calls set_auto_update", async ({ page }) => {
  await page.goto("/settings.html");

  await page.locator("#auto-update").evaluate((el: HTMLInputElement) => {
    el.checked = true;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });

  const calls = await callsFor(page, "set_auto_update");
  expect(calls.length).toBe(1);
  expect(calls[0].args).toEqual({ enabled: true });
});

test("bootstrap failure renders page without origins or speed", async ({ page }) => {
  // Make get_config reject — loadSettings() catches and logs
  await page.addInitScript(() => {
    (window as any).__TAURI_MOCK__.setHandler("get_config", () => {
      throw new Error("Config unavailable");
    });
  });
  await page.goto("/settings.html");

  // Page should render but with default/empty state — no origins loaded
  await expect(page.locator("body")).toBeVisible();
  // Speed label stays at its HTML default "Full" (loadSettings never ran updateSpeedUI)
  await expect(page.locator("#speed-label")).toHaveText("Full");
  // Origins list should be empty (renderOrigins never called)
  await expect(page.locator(".origin-item")).toHaveCount(0);
});

test("speed error shows hint and reloads settings", async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__TAURI_MOCK__.setHandler("set_speed", () => {
      throw new Error("Speed save failed");
    });
  });
  await page.goto("/settings.html");

  await page.locator("#speed").evaluate((el: HTMLInputElement) => {
    el.value = "1";
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });

  await expect(page.locator(".error-hint")).toBeVisible();
  await expect(page.locator(".error-hint")).toHaveText("Failed to save");
});

// ── Layout at the REAL window size ──
//
// These specs exist because two clipping bugs shipped to the owner: the speed slider cut off by the
// Settings window's bottom edge, and the onboarding wizard sized wrong twice in a row. Neither could
// fail here, because Playwright sets no viewport and so ran at 1280x720 while these windows are
// 500x600 and 520x560 — the overflow simply wasn't there to find. Sizing the page to the real window
// is what turns "looks fine in a browser" into a test of the thing the user actually sees.
//
// The assertion is deliberately "nothing is unreachable", not "everything fits": `body.scrollable`
// makes overflow legitimate. What is NOT acceptable is content past the fold with no way to reach it.
async function expectReachable(page: Page, selector: string) {
  const target = page.locator(selector);
  await expect(target).toBeAttached();
  await target.scrollIntoViewIfNeeded();
  const verdict = await target.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return {
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      viewportHeight: document.documentElement.clientHeight,
      // Overflow is fine; overflow the page refuses to scroll is not.
      scrollable:
        document.documentElement.scrollHeight <= document.documentElement.clientHeight ||
        getComputedStyle(document.body).overflowY !== "hidden",
    };
  });
  expect(verdict.scrollable, `${selector}: page overflows but cannot be scrolled`).toBe(true);
  expect(
    verdict.bottom,
    `${selector}: bottom edge (${verdict.bottom}) is past the ${verdict.viewportHeight}px window even after scrolling`,
  ).toBeLessThanOrEqual(verdict.viewportHeight);
  expect(verdict.top, `${selector}: top edge is above the window`).toBeGreaterThanOrEqual(0);
}

test("at the real window size the speed control is reachable with the certificate section open", async ({
  page,
}) => {
  // The exact regression the owner hit: opening "Manage certificate" pushes the speed section down,
  // and at the old 520px height it was clipped with no scroll.
  await page.setViewportSize(VIEWPORT_SIZES.settings);
  await page.goto("/settings.html");
  await page.locator("#cert-details summary").click();

  await expectReachable(page, ".speed-section");
  await expectReachable(page, "#speed-desc");
});

for (const verified of [false, true]) {
  test(`at the real window size the default Settings view fits all but the folded Advanced row${verified ? " (a verified site approved)" : ""}`, async ({
    page,
  }) => {
    // The verified row is a line taller, and an approved playground is the common first state.
    if (verified) {
      await page.addInitScript(() => {
        (window as any).__TAURI_MOCK__.setHandler("get_verified_info", () => ({
          display_name: "Presto Playground",
        }));
      });
    }
    // Stricter than `expectReachable` on purpose. The collapsed view is the DEFAULT state, and "the
    // proving speed gets cut, like the setting has a fixed height" is exactly what happened when it
    // didn't fit — `body.scrollable` makes that merely scrollable, not correct. A reachability-only
    // assertion passes on the old 520px height, so it would not have caught the bug it exists for.
    // (Scrolling IS the accepted answer once the certificate disclosure is open — see the test above.)
    // The folded Advanced row is the one exception: growing the window for it would worsen #116, and
    // developer settings are not an everyday control.
    await page.setViewportSize(VIEWPORT_SIZES.settings);
    await page.goto("/settings.html");

    const fit = await page.evaluate(() => {
      const advanced = document.getElementById("advanced")?.parentElement as HTMLElement;
      const full = document.documentElement.scrollHeight;
      advanced.hidden = true;
      const content = document.documentElement.scrollHeight;
      advanced.hidden = false;
      const row =
        (document.querySelector("#advanced > summary") as HTMLElement).offsetHeight +
        Number.parseFloat(getComputedStyle(advanced).marginBottom);
      return { content, extra: full - content, row, window: document.documentElement.clientHeight };
    });
    expect(
      fit.content,
      `the default Settings view above Advanced is ${fit.content}px in a ${fit.window}px window — raise the height in windows.rs or drop a row`,
    ).toBeLessThanOrEqual(fit.window);
    expect(fit.extra, "Advanced adds more than its folded row and gap").toBeLessThanOrEqual(
      fit.row,
    );
    await expect(page.locator(".speed-section")).toBeInViewport({ ratio: 1 });
    await expectReachable(page, "#advanced > summary");
  });
}

// ── Developer mode ──

const NEWER_CONFIG =
  "This config was written by a newer version of the app; changes can't be saved. Update the app to change settings.";

test("developer mode sits folded under Advanced, off, and saves each change", async ({ page }) => {
  await page.goto("/settings.html");
  const developer = page.getByRole("switch", { name: "Developer mode" });
  const section = page.locator("#developer-section");
  await expect(developer).toBeHidden();
  await expect(section).toBeHidden();

  await page.locator("#advanced > summary").click();
  await expect(developer).toBeEnabled();
  await expect(developer).not.toBeChecked();

  await page.locator("#advanced .toggle").click();
  await expect(section).toBeVisible();
  await expect(developer).toBeEnabled();
  await page.locator("#advanced .toggle").click();
  await expect(section).toBeHidden();
  expect((await callsFor(page, "set_developer_mode")).map((c: any) => c.args)).toEqual([
    { enabled: true },
    { enabled: false },
  ]);
});

test("a refused developer-mode save reverts the switch and says why", async ({ page }) => {
  await page.addInitScript((message) => {
    (window as any).__TAURI_MOCK__.setHandler("set_developer_mode", () => {
      throw message;
    });
  }, NEWER_CONFIG);
  await page.goto("/settings.html");
  await page.locator("#advanced > summary").click();
  await page.locator("#advanced .toggle").click();

  const developer = page.getByRole("switch", { name: "Developer mode" });
  await expect(page.locator("#advanced .error-hint")).toHaveText(NEWER_CONFIG);
  await expect(developer).not.toBeChecked();
  await expect(developer).toBeEnabled();
  await expect(page.locator("#developer-section")).toBeHidden();
});

test("a reload that started before a developer-mode save does not repaint the switch", async ({
  page,
}) => {
  // The first load stalls after reading developer mode off. A second load (a failed speed save
  // reloads) hydrates, the switch is turned on, then the first load resumes with its stale read.
  await page.addInitScript(() => {
    const mock = (window as any).__TAURI_MOCK__;
    mock.setHandler("get_system_info", (_args: unknown, call: number) =>
      call === 1
        ? new Promise((resolve) => {
            (window as any).__resumeFirstLoad = () => resolve({ platform: "macos", cpu_count: 10 });
          })
        : { platform: "macos", cpu_count: 10 },
    );
    mock.setHandler("set_speed", () => {
      throw new Error("speed down");
    });
  });
  await page.goto("/settings.html");
  await page.locator("#speed").evaluate((el: HTMLInputElement) => {
    el.value = "1";
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const developer = page.getByRole("switch", { name: "Developer mode" });
  await page.locator("#advanced > summary").click();
  await expect(developer).toBeEnabled();
  await page.locator("#advanced .toggle").click();
  await expect(page.locator("#developer-section")).toBeVisible();
  await expect(developer).toBeEnabled();

  await page.evaluate(() => (window as any).__resumeFirstLoad());
  // The resumed load reads autostart right after it would have painted the switch.
  await expect.poll(async () => (await callsFor(page, "get_autostart_enabled")).length).toBe(2);
  await expect(developer).toBeChecked();
  await expect(page.locator("#developer-section")).toBeVisible();
});

test("a reload that started during a developer-mode save does not repaint the switch", async ({
  page,
}) => {
  // The save is held; a reload starts, reads developer mode still off and stalls; the save lands,
  // then the reload resumes with its stale read.
  await page.addInitScript(() => {
    const w = window as any;
    w.__TAURI_MOCK__.setHandler(
      "set_developer_mode",
      () =>
        new Promise((resolve) => {
          w.__finishSave = () => resolve(null);
        }),
    );
    w.__TAURI_MOCK__.setHandler("get_system_info", (_args: unknown, call: number) =>
      call === 2
        ? new Promise((resolve) => {
            w.__resumeReload = () => resolve({ platform: "macos", cpu_count: 10 });
          })
        : { platform: "macos", cpu_count: 10 },
    );
    w.__TAURI_MOCK__.setHandler("set_speed", () => {
      throw new Error("speed down");
    });
  });
  await page.goto("/settings.html");
  const developer = page.getByRole("switch", { name: "Developer mode" });
  await page.locator("#advanced > summary").click();
  await expect(developer).toBeEnabled();
  await page.locator("#advanced .toggle").click();
  await page.locator("#speed").evaluate((el: HTMLInputElement) => {
    el.value = "1";
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect.poll(async () => (await callsFor(page, "get_system_info")).length).toBe(2);

  await page.evaluate(() => (window as any).__finishSave());
  await expect(page.locator("#developer-section")).toBeVisible();
  await page.evaluate(() => (window as any).__resumeReload());
  await expect.poll(async () => (await callsFor(page, "get_autostart_enabled")).length).toBe(2);
  await expect(developer).toBeChecked();
  await expect(developer).toBeEnabled();
  await expect(page.locator("#developer-section")).toBeVisible();
});

test("a stored developer mode opens Advanced with the Developer section showing", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).__TAURI_MOCK__.setHandler("get_config", () => ({
      config_version: 2,
      https_enabled: false,
      approved_origins: [],
      speed: "full",
      theme: "system",
      onboarding_version: 1,
      developer: { enabled: true, update_channel: "stable" },
    }));
  });
  await page.goto("/settings.html");

  await expect(page.locator("#advanced")).toHaveAttribute("open", "");
  await expect(page.getByRole("switch", { name: "Developer mode" })).toBeChecked();
  await expect(page.locator("#developer-section")).toBeVisible();
});

test("appearance reflects the stored theme and saves the picked one", async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__TAURI_MOCK__.setHandler("get_config", () => ({
      config_version: 1,
      https_enabled: false,
      approved_origins: [],
      speed: "full",
      theme: "dark",
      onboarding_version: 1,
    }));
  });
  await page.goto("/settings.html");

  await expect(page.locator('#theme input[value="dark"]')).toBeChecked();

  await page.locator("#theme label", { hasText: "Light" }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__TAURI_MOCK__.calls.filter((c: any) => c.cmd === "set_theme"),
      ),
    )
    .toEqual([expect.objectContaining({ args: { theme: "light" } })]);
});

test("a failed set_theme reverts to the persisted choice instead of the clicked one", async ({
  page,
}) => {
  // The radio flips on click before the command resolves. Rust is what repaints, so leaving a
  // rejected choice selected would show a theme the app is not actually in.
  await page.addInitScript(() => {
    (window as any).__TAURI_MOCK__.setHandler("set_theme", () => {
      throw new Error("config written by a newer build");
    });
  });
  await page.goto("/settings.html");

  await page.locator("#theme label", { hasText: "Dark" }).click();
  await expect(page.locator('#theme input[value="system"]')).toBeChecked();
});

test("the appearance control is not actionable until the stored value is known", async ({
  page,
}) => {
  // Hydration sits downstream of the initial config+system-info pair, so a slow request in it is a
  // window in which a click would be silently reverted. Stalling get_system_info on purpose:
  // an earlier version hydrated after the autostart await and passed a test that stalled only that,
  // while this sequence still lost the click.
  await page.addInitScript(() => {
    (window as any).__TAURI_MOCK__.setHandler("get_config", () => ({
      config_version: 1,
      https_enabled: false,
      approved_origins: [],
      speed: "full",
      theme: "dark",
      onboarding_version: 1,
    }));
    (window as any).__TAURI_MOCK__.setHandler(
      "get_system_info",
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ platform: "macos", cpu_count: 10 }), 400),
        ),
    );
  });
  await page.goto("/settings.html");

  await expect(page.locator('#theme input[value="light"]')).toBeDisabled();

  await expect(page.locator('#theme input[value="light"]')).toBeEnabled({ timeout: 5000 });
  await expect(page.locator('#theme input[value="dark"]')).toBeChecked();
  expect(
    await page.evaluate(
      () => (window as any).__TAURI_MOCK__.calls.filter((c: any) => c.cmd === "set_theme").length,
    ),
  ).toBe(0);
});

test("the recovery reload disables the appearance control again while it re-hydrates", async ({
  page,
}) => {
  // A failed set_theme re-runs loadSettings, and by then the fieldset is enabled. Without disabling
  // per call, that second pass has the same click-then-overwrite window as the first.
  await page.addInitScript(() => {
    (window as any).__TAURI_MOCK__.setHandler("set_theme", () => {
      throw new Error("config written by a newer build");
    });
    (window as any).__TAURI_MOCK__.setHandler("get_config", (_args: unknown, callIndex: number) => {
      const config = {
        config_version: 1,
        https_enabled: false,
        approved_origins: [],
        speed: "full",
        theme: "system",
        onboarding_version: 1,
      };
      // Stall only the recovery pass, so the assertion lands inside its awaits.
      return callIndex === 1
        ? config
        : new Promise((resolve) => setTimeout(() => resolve(config), 400));
    });
  });
  await page.goto("/settings.html");
  // Asserted on a child input, not the fieldset: Playwright resolves disabled through an ancestor
  // fieldset but does not report the fieldset element itself as disabled.
  const option = page.locator('#theme input[value="light"]');
  await expect(option).toBeEnabled();

  await page.locator("#theme label", { hasText: "Dark" }).click();
  await expect(option).toBeDisabled();

  await expect(option).toBeEnabled({ timeout: 5000 });
  await expect(page.locator('#theme input[value="system"]')).toBeChecked();
});

// ── Update channel ──

type Channel = "stable" | "rc";

/** Opens Settings on a stored developer block, running `version`. */
async function openChannel(
  page: Page,
  {
    enabled = true,
    channel = "stable",
    version = "1.2.0",
    effective = enabled ? channel : "stable",
  }: { enabled?: boolean; channel?: Channel; version?: string; effective?: Channel } = {},
) {
  await page.addInitScript(
    ({ enabled, channel, version, effective }) => {
      const mock = (window as any).__TAURI_MOCK__;
      mock.setHandler("get_config", () => ({
        config_version: 2,
        https_enabled: false,
        approved_origins: [],
        speed: "full",
        theme: "system",
        onboarding_version: 1,
        developer: { enabled, update_channel: channel },
      }));
      mock.setHandler("get_system_info", () => ({
        platform: "macos",
        cpu_count: 10,
        app_version: version,
        effective_channel: effective,
      }));
    },
    { enabled, channel, version, effective },
  );
  await page.goto("/settings.html");
}

/** Holds every call of `cmd` until `answer` or `refuse` settles the oldest one. */
function holdNow(cmd: string) {
  const w = window as any;
  w.__held = [];
  w.__TAURI_MOCK__.setHandler(
    cmd,
    () => new Promise((resolve, reject) => w.__held.push({ resolve, reject })),
  );
}

async function hold(page: Page, cmd: string) {
  await page.addInitScript(holdNow, cmd);
}

async function settleHeld(page: Page, outcome: "resolve" | "reject", value: unknown, call: string) {
  await expect.poll(() => page.evaluate(() => (window as any).__held.length)).toBeGreaterThan(0);
  await page.evaluate(
    ({ outcome, value, call }) => {
      const held = (window as any).__held;
      (call === "oldest" ? held.shift() : held.pop())[outcome](value);
    },
    { outcome, value, call },
  );
}

async function answer(page: Page, result: unknown, call: "oldest" | "newest" = "oldest") {
  await settleHeld(page, "resolve", result, call);
}

async function refuse(page: Page, message: string, call: "oldest" | "newest" = "oldest") {
  await settleHeld(page, "reject", message, call);
}

const channelRadio = (page: Page, value: Channel) =>
  page.locator(`#channel input[value="${value}"]`);
const pick = (page: Page, label: string) =>
  page.locator("#channel label", { hasText: label }).click();
const STAYS =
  "Presto stays on 1.3.0-rc.2 until a newer stable release exists. It does not go back to an older version.";

test("joining shows checking, then the result", async ({ page }) => {
  await hold(page, "set_update_channel");
  await openChannel(page);
  await expect(page.locator("#channel-status")).toHaveText("Stable releases only.");

  await pick(page, "Release candidates");
  await expect(page.locator("#channel-result")).toHaveText("Checking…");
  await expect(page.locator("#channel-status")).toHaveText(
    "The newer of the next release candidate and the next stable release. You run 1.2.0.",
  );
  await answer(page, "up-to-date");
  await expect(page.locator("#channel-result")).toHaveText("Up to date");
  await expect(channelRadio(page, "rc")).toBeChecked();
  expect((await callsFor(page, "set_update_channel")).map((c: any) => c.args)).toEqual([
    { channel: "rc" },
  ]);
});

test("join during an install shows installing", async ({ page }) => {
  await hold(page, "set_update_channel");
  await openChannel(page);
  await pick(page, "Release candidates");
  await answer(page, "installing");
  await expect(page.locator("#channel-result")).toHaveText("Installing an update…");
});

test("a join that opens the prompt adds no line, and one that fails keeps the choice", async ({
  page,
}) => {
  await hold(page, "set_update_channel");
  await openChannel(page);
  await pick(page, "Release candidates");
  await answer(page, "presented");
  await expect(page.locator("#channel-result")).toBeHidden();

  await pick(page, "Stable");
  await answer(page, null);
  await pick(page, "Release candidates");
  await answer(page, "failed");
  await expect(page.locator("#channel-result")).toHaveText("Couldn't check — try again");
  await expect(channelRadio(page, "rc")).toBeChecked();
});

test("a superseded join result is dropped", async ({ page }) => {
  await hold(page, "set_update_channel");
  await openChannel(page);
  await pick(page, "Release candidates");
  await pick(page, "Stable");
  // The leave lands first; the join's answer arrives after it and must not overwrite it.
  await answer(page, null, "newest");
  await answer(page, "up-to-date");
  await expect.poll(() => page.evaluate(() => (window as any).__held.length)).toBe(0);
  await expect(page.locator("#channel-result")).toBeHidden();
  await expect(channelRadio(page, "stable")).toBeChecked();
  await expect(page.locator("#channel-status")).toHaveText("Stable releases only.");
});

test("leaving on a release candidate asks first", async ({ page }) => {
  await openChannel(page, { channel: "rc", version: "1.3.0-rc.2" });
  await expect(page.locator("#channel-status")).toHaveText("You run 1.3.0-rc.2.");

  await pick(page, "Stable");
  const check = page.locator("#leave-check");
  await expect(check).toBeVisible();
  await expect(check).toContainText(STAYS);
  await expect(channelRadio(page, "rc")).toBeChecked();
  await page.getByRole("button", { name: "Keep Release Candidates" }).click();
  await expect(check).toBeHidden();
  expect(await callsFor(page, "set_update_channel")).toEqual([]);

  await pick(page, "Stable");
  await page.getByRole("button", { name: "Switch to Stable" }).click();
  await expect(check).toBeHidden();
  await expect(channelRadio(page, "stable")).toBeChecked();
  await expect(page.locator("#channel-status")).toHaveText(
    "Stable releases only. You stay on 1.3.0-rc.2 until a newer stable release is out.",
  );
  expect((await callsFor(page, "set_update_channel")).map((c: any) => c.args)).toEqual([
    { channel: "stable" },
  ]);
});

test("leaving while running a stable release needs no check", async ({ page }) => {
  await openChannel(page, { channel: "rc" });
  await pick(page, "Stable");
  await expect(page.locator("#leave-check")).toBeHidden();
  await expect.poll(async () => (await callsFor(page, "set_update_channel")).length).toBe(1);
});

test("developer mode off on a release candidate uses the leave check", async ({ page }) => {
  await openChannel(page, { channel: "rc", version: "1.3.0-rc.2" });
  const developer = page.getByRole("switch", { name: "Developer mode" });
  const check = page.locator("#developer-off-check");

  await page.locator("#advanced .toggle").click();
  await expect(check).toBeVisible();
  await expect(check).toContainText(STAYS);
  await expect(developer).toBeChecked();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(check).toBeHidden();
  expect(await callsFor(page, "set_developer_mode")).toEqual([]);

  await page.locator("#advanced .toggle").click();
  await page.getByRole("button", { name: "Turn Off" }).click();
  await expect(developer).not.toBeChecked();
  await expect(page.locator("#developer-section")).toBeHidden();
  expect((await callsFor(page, "set_developer_mode")).map((c: any) => c.args)).toEqual([
    { enabled: false },
  ]);
});

test("turning developer mode on over a stored candidate choice joins and keeps the switch on", async ({
  page,
}) => {
  // A hand-edited config: the candidate channel stored while developer mode is off. The join can
  // fail, but the save stands, so the switch and the choice stay.
  await hold(page, "set_developer_mode");
  await openChannel(page, { enabled: false, channel: "rc" });
  await page.locator("#advanced > summary").click();
  await page.locator("#advanced .toggle").click();

  await expect(page.locator("#channel-result")).toHaveText("Checking…");
  await answer(page, "failed");
  await expect(page.locator("#channel-result")).toHaveText("Couldn't check — try again");
  await expect(page.getByRole("switch", { name: "Developer mode" })).toBeChecked();
  await expect(channelRadio(page, "rc")).toBeChecked();
});

test("a refused channel save goes back and says why", async ({ page }) => {
  await page.addInitScript((message) => {
    (window as any).__TAURI_MOCK__.setHandler("set_update_channel", () => {
      throw message;
    });
  }, NEWER_CONFIG);
  await openChannel(page);
  await pick(page, "Release candidates");
  await expect(page.locator("#developer-section .error-hint")).toHaveText(NEWER_CONFIG);
  await expect(channelRadio(page, "stable")).toBeChecked();
  await expect(page.locator("#channel-result")).toBeHidden();
});

test("failed overlapping saves show what is saved", async ({ page }) => {
  // The newest failure would restore the older save's view, which was never stored either.
  await hold(page, "set_update_channel");
  await openChannel(page, { channel: "rc" });
  await pick(page, "Stable");
  await pick(page, "Release candidates");
  await refuse(page, "disk full");
  await refuse(page, "disk full");
  await expect(channelRadio(page, "rc")).toBeChecked();
  await expect(page.locator("#channel-status")).toHaveText(
    "The newer of the next release candidate and the next stable release. You run 1.2.0.",
  );
  await expect(channelRadio(page, "rc")).toBeEnabled();
});

test("a save confirmed during a reload leaves the controls usable", async ({ page }) => {
  await openChannel(page, { channel: "rc", version: "1.3.0-rc.2" });
  await pick(page, "Stable");
  await expect(page.locator("#leave-check")).toBeVisible();

  // A failed theme save reloads every setting; the reload's config read stays pending.
  await page.evaluate(holdNow, "get_config");
  await page.evaluate(() =>
    (window as any).__TAURI_MOCK__.setHandler("set_theme", () => {
      throw "disk full";
    }),
  );
  await page.locator("#theme label", { hasText: "Dark" }).click();
  await expect(page.getByRole("switch", { name: "Developer mode" })).toBeDisabled();

  await page.locator("#leave-confirm").click();
  await expect(channelRadio(page, "stable")).toBeChecked();
  // The reload read the config from before the save; it must not repaint over it.
  await answer(page, {
    config_version: 2,
    https_enabled: false,
    approved_origins: [],
    speed: "full",
    theme: "system",
    onboarding_version: 1,
    developer: { enabled: true, update_channel: "rc" },
  });
  await expect(page.getByRole("switch", { name: "Developer mode" })).toBeEnabled();
  await expect(channelRadio(page, "rc")).toBeEnabled();
  await expect(channelRadio(page, "stable")).toBeChecked();
});

test("read-only config shows the effective channel", async ({ page }) => {
  await openChannel(page, { channel: "rc", effective: "stable" });
  await expect(channelRadio(page, "stable")).toBeChecked();
  await expect(page.locator("#channel-status")).toHaveText("Stable releases only.");
});

test("at the real window size the Developer section and the leave check are reachable", async ({
  page,
}) => {
  await page.setViewportSize(VIEWPORT_SIZES.settings);
  await openChannel(page, { channel: "rc", version: "1.3.0-rc.2" });
  await pick(page, "Stable");
  await expectReachable(page, "#channel");
  await expectReachable(page, "#leave-confirm");
  const width = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth,
    window: document.documentElement.clientWidth,
  }));
  expect(width.page, "the channel row overflows sideways").toBeLessThanOrEqual(width.window);
});

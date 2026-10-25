/**
 * Settings against the native window: built inside a screen shorter than it, unchanged where it fits.
 *
 * Each assertion stays in one coordinate space. On the Xvfb the Linux lanes own (no window manager),
 * `getWindowRect()` (physical, outer) and `screen.*` (CSS px) coincide once DPR 1 and a zero origin are
 * checked. macOS compares the frame with the screen. Windows only reports: its rect includes
 * invisible resize borders, so a containment check there would not mean what it says.
 */
import * as os from "node:os";
import { WINDOW_SIZES } from "../e2e/window-sizes.ts";
import { ensureSettingsWindow } from "./helpers.ts";

const SETTINGS = WINDOW_SIZES.settings;
const PLATFORM = os.platform();

interface PageGeometry {
  dpr: number;
  screen: {
    width: number;
    height: number;
    availLeft: number;
    availTop: number;
    availWidth: number;
    availHeight: number;
  };
  viewport: { width: number; height: number };
  content: number;
}

/**
 * The Xvfb geometry the harness gave this Linux run (`WIDTHxHEIGHTx24`), or `null` on a display it did
 * not start, whose size and window manager are unknown. CI must always name one.
 */
function linuxScreen(): { width: number; height: number } | null {
  const named = process.env.WDIO_SCREEN;
  if (!named && !process.env.CI) return null;
  const match = /^(\d+)x(\d+)x24$/.exec(named ?? "");
  if (!match) throw new Error(`WDIO_SCREEN must name the Xvfb geometry, got "${named}"`);
  return { width: Number(match[1]), height: Number(match[2]) };
}

describe("Window fit", () => {
  let rect: Awaited<ReturnType<typeof browser.getWindowRect>>;
  let page: PageGeometry;

  before(async () => {
    await ensureSettingsWindow();
    rect = await browser.getWindowRect();
    page = await browser.execute(() => {
      // availLeft/availTop are WebKit and Chromium extensions the DOM typings omit.
      const s = screen as Screen & { availLeft: number; availTop: number };
      return {
        dpr: window.devicePixelRatio,
        screen: {
          width: s.width,
          height: s.height,
          availLeft: s.availLeft,
          availTop: s.availTop,
          availWidth: s.availWidth,
          availHeight: s.availHeight,
        },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        content: (document.scrollingElement as HTMLElement).scrollHeight,
      };
    });
    // Logged on every lane: the only record of each OS's real window geometry.
    console.log(`screen-fit ${PLATFORM}: ${JSON.stringify({ rect, ...page })}`);
  });

  it("keeps Settings at its configured width", () => {
    expect(page.viewport.width).toBe(SETTINGS.width);
  });

  if (PLATFORM === "darwin") {
    it("opens Settings at its configured height, inside the screen", () => {
      // Tauri's default title bar draws inside the window, so where it fits the frame is the
      // configured size; on a shorter screen only containment is exact enough to assert.
      const frame = rect.height / page.dpr;
      if (page.screen.availHeight >= SETTINGS.height) expect(frame).toBe(SETTINGS.height);
      else expect(frame).toBeLessThanOrEqual(page.screen.availHeight);
    });
  }

  const expected = PLATFORM === "linux" ? linuxScreen() : null;
  if (expected) {
    it("runs on the display the lane configured", () => {
      expect(page.dpr).toBe(1);
      expect([page.screen.availLeft, page.screen.availTop]).toEqual([0, 0]);
      expect([page.screen.width, page.screen.height]).toEqual([expected.width, expected.height]);
    });

    if (expected.height < SETTINGS.height) {
      it("builds Settings inside a screen shorter than it", () => {
        // The frame, not only the viewport: `rect` is the outer window.
        expect(rect.y).toBeGreaterThanOrEqual(0);
        expect(rect.y + rect.height).toBeLessThanOrEqual(expected.height);
        expect(page.viewport.height).toBeLessThan(SETTINGS.height);
      });

      it("scrolls Settings to its end with every section open", async () => {
        // Advanced open is the page's tallest state, so its end is the one that must be reachable.
        const verdict = await browser.execute(() => {
          const root = document.scrollingElement as HTMLElement;
          const advanced = document.getElementById("advanced") as HTMLDetailsElement;
          advanced.open = true;
          root.scrollTo(0, root.scrollHeight);
          const box = advanced.getBoundingClientRect();
          const result = {
            overflows: root.scrollHeight > root.clientHeight,
            atEnd: Math.ceil(root.scrollTop + root.clientHeight) >= root.scrollHeight,
            bottom: Math.round(box.bottom),
            viewportHeight: root.clientHeight,
          };
          // The specs after this one expect Settings collapsed and scrolled to the top.
          advanced.open = false;
          root.scrollTo(0, 0);
          return result;
        });
        expect(verdict.overflows).toBe(true);
        expect(verdict.atEnd).toBe(true);
        expect(verdict.bottom).toBeLessThanOrEqual(verdict.viewportHeight);
      });
    } else {
      it("opens Settings at its configured height where it fits", () => {
        expect(page.viewport.height).toBe(SETTINGS.height);
      });
    }
  }
});

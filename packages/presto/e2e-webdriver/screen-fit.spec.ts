/**
 * Settings on a screen shorter than it, against the real window manager path.
 *
 * Every window is built at a fixed size and cannot be resized, so on a short screen the only remedy
 * is to build it smaller and let `body.scrollable` take the rest. Where it fits, nothing may change.
 * The desktop-ui suite sizes static pages by hand and so cannot see either; only the native window
 * knows where its frame landed.
 *
 * Assertions compare one coordinate space each. Linux runs on Xvfb with no window manager, where
 * `getWindowRect()` (physical, outer) and `screen.*` (CSS px) coincide once DPR 1 and a zero origin
 * are checked. macOS compares the window with its own configured size. Windows only reports: its
 * rect includes invisible resize borders, so a containment check there would not mean what it says.
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

/** The Xvfb geometry `_e2e-webdriver.yml` gave this Linux run, as `WIDTHxHEIGHTx24`. */
function linuxScreen(): { width: number; height: number } {
  const match = /^(\d+)x(\d+)x24$/.exec(process.env.WDIO_SCREEN ?? "");
  if (!match) {
    throw new Error(`WDIO_SCREEN must name the Xvfb geometry, got "${process.env.WDIO_SCREEN}"`);
  }
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
    // The per-platform measurement the PR reports; nothing else records what each OS really does.
    console.log(`screen-fit ${PLATFORM}: ${JSON.stringify({ rect, ...page })}`);
  });

  it("keeps Settings at its configured width", () => {
    expect(page.viewport.width).toBe(SETTINGS.width);
  });

  if (PLATFORM === "darwin") {
    it("opens Settings with a frame of its configured height", () => {
      // Tauri's default title bar draws inside the window, so the frame is the configured size.
      expect(rect.height / page.dpr).toBe(SETTINGS.height);
    });
  }

  if (PLATFORM === "linux") {
    const expected = linuxScreen();

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
        // Collapsed, Settings fits the shrunk window, so open Advanced, its tallest section, to make
        // the page overflow and prove the end is reachable by scrolling rather than cut off.
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

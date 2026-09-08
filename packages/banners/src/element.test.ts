import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { definePrestoBanner, PrestoBanner } from "./element.js";
import { DAY_MS } from "./persistence.js";
import { STRINGS } from "./strings.js";
import { BANNER_EVENTS, BANNER_STATES, BANNER_VARIANTS, type BannerVariant } from "./types.js";

definePrestoBanner();

function mount(attrs: Record<string, string> = {}): PrestoBanner {
  const el = document.createElement("presto-banner") as PrestoBanner;
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  document.body.appendChild(el);
  return el;
}

const shadow = (el: PrestoBanner) => el.shadowRoot as ShadowRoot;
const text = (el: PrestoBanner) => shadow(el).textContent ?? "";
const query = <T extends Element>(el: PrestoBanner, selector: string) =>
  shadow(el).querySelector<T>(selector);
const click = (el: PrestoBanner, selector: string) =>
  query<HTMLElement>(el, selector)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

function nextEvent(el: PrestoBanner, type: string): Promise<CustomEvent> {
  return new Promise((resolve) =>
    el.addEventListener(type, (event) => resolve(event as CustomEvent), { once: true }),
  );
}

const timings = { ...PrestoBanner.timings };

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = "";
  document.getElementById("presto-banner-fonts")?.remove();
  PrestoBanner.timings = { morph: 5, hold: 5, collapse: 5 };
});
afterEach(() => {
  setSystemTime();
  PrestoBanner.timings = timings;
});

describe("<presto-banner> rendering", () => {
  test("stays hidden until a state is set, then every surface paints the install pitch", () => {
    for (const variant of BANNER_VARIANTS) {
      const el = mount({ variant });
      // Tile is static placement: it never waits for a status.
      expect(el.hidden).toBe(variant !== "tile");
      el.state = "offline";
      expect(el.hidden).toBe(false);
      expect(text(el)).toContain("Get Presto");
      expect(query(el, '[data-action="cta"]')?.getAttribute("href")).toBe("https://presto.build");
      expect(query(el, '[data-action="dismiss"]') !== null).toBe(variant !== "tile");
    }
  });

  test("the ribbon carries every state's copy and tone; other surfaces hide the ones they don't", () => {
    const ribbon = mount({ variant: "ribbon" });
    for (const state of BANNER_STATES.filter((s) => s !== "available")) {
      ribbon.state = state;
      const strings = STRINGS[state];
      expect(query(ribbon, ".ribbon")?.getAttribute("data-tone")).toBe(strings.tone);
      expect(query(ribbon, "strong")?.textContent).toBe(strings.title);
      expect(text(ribbon)).toContain(strings.support);
      expect(query(ribbon, '[data-action="retry"]') !== null).toBe(strings.primary === "retry");
    }
    const card = mount({ variant: "card", state: "permission-blocked" });
    expect(card.hidden).toBe(true);
    const tile = mount({ variant: "tile", state: "permission-blocked" });
    expect(tile.hidden).toBe(false);
  });

  test("cta, retry and dismiss dispatch composed events; a cancelled cta blocks navigation", async () => {
    const el = mount({ variant: "ribbon", state: "permission-blocked" });
    const retry = nextEvent(el, BANNER_EVENTS.retry);
    click(el, '[data-action="retry"]');
    expect((await retry).detail).toMatchObject({ variant: "ribbon", state: "permission-blocked" });

    el.state = "offline";
    el.addEventListener(BANNER_EVENTS.cta, (event) => event.preventDefault(), { once: true });
    const clickEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
    query(el, '[data-action="cta"]')?.dispatchEvent(clickEvent);
    expect(clickEvent.defaultPrevented).toBe(true);

    const dismissed = nextEvent(el, BANNER_EVENTS.dismiss);
    click(el, '[data-action="dismiss"]');
    expect((await dismissed).detail.forever).toBe(false);
    expect(el.hidden).toBe(true);
  });
});

describe("<presto-banner> lifecycle", () => {
  test("a dismissal hides that variant+state for dismiss-days, and nothing else", () => {
    setSystemTime(new Date("2026-09-08T12:00:00Z"));
    click(mount({ variant: "ribbon", state: "offline" }), '[data-action="dismiss"]');
    expect(mount({ variant: "ribbon", state: "offline" }).hidden).toBe(true);
    // A post-install problem must still be able to speak.
    expect(mount({ variant: "ribbon", state: "permission-blocked" }).hidden).toBe(false);
    expect(mount({ variant: "card", state: "offline" }).hidden).toBe(false);
    expect(mount({ variant: "ribbon", state: "offline", "persist-key": "other" }).hidden).toBe(
      false,
    );
    setSystemTime(new Date(Date.now() + 8 * DAY_MS));
    expect(mount({ variant: "ribbon", state: "offline" }).hidden).toBe(false);
  });

  test("sheet: a native modal that names the platform; cancel/Escape dismiss; checkbox is forever", () => {
    const el = mount({ variant: "sheet", state: "offline", os: "Windows" });
    const dialog = query<HTMLDialogElement>(el, "dialog");
    expect(dialog?.open).toBe(true);
    expect(query(el, '[data-action="cta"]')?.textContent).toBe("Get Presto for Windows");
    // href/os changes patch the CTA in place: the checkbox and focus survive.
    const never = query<HTMLInputElement>(el, '[data-role="never"]');
    if (!never) throw new Error("checkbox missing");
    never.checked = true;
    el.setAttribute("os", "Linux");
    expect(query(el, '[data-action="cta"]')?.textContent).toBe("Get Presto for Linux");
    expect(query<HTMLInputElement>(el, '[data-role="never"]')?.checked).toBe(true);
    dialog?.dispatchEvent(new Event("cancel", { bubbles: true, cancelable: true }));
    expect(el.hidden).toBe(true);
    setSystemTime(new Date("2099-01-01T00:00:00Z"));
    expect(mount({ variant: "sheet", state: "offline" }).hidden).toBe(true);
    localStorage.clear();
    const again = mount({ variant: "sheet", state: "offline", os: "nope" });
    again.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(again.hidden).toBe(true);
  });

  test("a torn-down dialog's queued close never dismisses a newer sheet; dismiss-days keeps choices", () => {
    const el = mount({ variant: "sheet", state: "offline" });
    const stale = query<HTMLDialogElement>(el, "dialog");
    el.state = "error"; // not a Sheet state → hidden
    expect(el.hidden).toBe(true);
    el.state = "offline";
    expect(el.hidden).toBe(false);
    stale?.dispatchEvent(new Event("close"));
    expect(el.hidden).toBe(false);
    expect(localStorage.length).toBe(0);
    const never = query<HTMLInputElement>(el, '[data-role="never"]');
    if (!never) throw new Error("checkbox missing");
    never.checked = true;
    el.setAttribute("dismiss-days", "3");
    el.setAttribute("persist-key", "another");
    expect(query<HTMLInputElement>(el, '[data-role="never"]')?.checked).toBe(true);
  });

  test("a dismiss listener that sets a new state is not undone by the teardown", () => {
    const el = mount({ variant: "ribbon", state: "offline" });
    el.addEventListener(BANNER_EVENTS.dismiss, () => {
      el.state = "permission-blocked";
    });
    click(el, '[data-action="dismiss"]');
    expect(el.hidden).toBe(false);
    expect(query(el, ".ribbon")?.getAttribute("data-tone")).toBe("warn");
  });
});

describe("<presto-banner> detected morph", () => {
  test("available morphs only a showing banner, collapses, and re-arms on a later offline", async () => {
    const fresh = mount({ variant: "billboard", state: "available" });
    expect(fresh.hidden).toBe(true);
    expect(shadow(fresh).innerHTML).toBe("");

    const el = mount({ variant: "billboard", state: "offline" });
    // The live region stays empty until the morph fills it.
    expect(query(el, ".detected")?.textContent).toBe("");
    const collapsed = nextEvent(el, BANNER_EVENTS.collapsed);
    el.status = { available: true, needsDownload: false };
    expect(el.getAttribute("state")).toBe("available");
    expect(query(el, ".root")?.getAttribute("data-phase")).toBe("detected");
    expect(query(el, ".detected")?.textContent).toContain("Presto connected");
    expect(query(el, ".billboard")?.hasAttribute("inert")).toBe(true);
    expect(query(el, ".billboard")?.classList.contains("is-enter")).toBe(false);
    // Attribute churn mid-morph must not restart the timers.
    el.setAttribute("href", "https://example.com/x");
    el.setAttribute("dismiss-days", "3");
    expect(query(el, ".root")?.getAttribute("data-phase")).toBe("detected");
    await collapsed;
    expect(el.hidden).toBe(true);
    el.state = "available";
    expect(el.hidden).toBe(true);
    el.state = "offline";
    expect(el.hidden).toBe(false);
  });

  test("the sheet's morph inerts its body, not the dialog that holds the live region", async () => {
    const el = mount({ variant: "sheet", state: "offline" });
    const collapsed = nextEvent(el, BANNER_EVENTS.collapsed);
    el.state = "available";
    expect(query(el, ".sheet-body")?.hasAttribute("inert")).toBe(true);
    expect(query(el, "dialog")?.hasAttribute("inert")).toBe(false);
    expect(query(el, "dialog .detected")?.textContent).toContain("Presto connected");
    await collapsed;
    expect(el.hidden).toBe(true);
    expect(localStorage.length).toBe(0);
  });

  test("fonts link is added once by default and skipped with fonts=none", () => {
    mount({ variant: "card", state: "offline", fonts: "none" });
    expect(document.getElementById("presto-banner-fonts")).toBeNull();
    mount({ variant: "card", state: "offline" });
    mount({ variant: "ribbon", state: "offline" });
    expect(document.querySelectorAll("#presto-banner-fonts")).toHaveLength(1);
  });

  test("href is escaped, http(s)-only, and unknown variants fall back to ribbon", () => {
    const href = 'https://example.com/?a=1&b="2"';
    const el = mount({ variant: "nope" as BannerVariant, state: "offline", href });
    expect(el.variant).toBe("ribbon");
    expect(query(el, '[data-action="cta"]')?.getAttribute("href")).toBe(
      "https://example.com/?a=1&b=%222%22",
    );
    expect(shadow(el).innerHTML).not.toContain('b="2"');
    for (const bad of ["javascript:alert(1)", "java\nscript:alert(1)", "data:text/html,x", "%%"]) {
      el.setAttribute("href", bad);
      expect(el.href).toBe("https://presto.build");
      expect(query(el, '[data-action="cta"]')?.getAttribute("href")).toBe("https://presto.build");
    }
  });
});

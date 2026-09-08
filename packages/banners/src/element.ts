import { ensureFonts } from "./fonts.js";
import { dismiss, isDismissed } from "./persistence.js";
import { detectPlatform } from "./platform.js";
import { detectedContent, render } from "./render.js";
import { stateFromStatus } from "./status.js";
import { VARIANT_COPY, VARIANT_STATES } from "./strings.js";
import { STYLES } from "./styles.js";
import {
  BANNER_EVENTS,
  BANNER_STATES,
  BANNER_VARIANTS,
  type BannerEventDetail,
  type BannerPlatform,
  type BannerState,
  type BannerVariant,
  type PrestoStatusLike,
} from "./types.js";

export const DEFAULT_HREF = "https://presto.build";
export const DEFAULT_PERSIST_KEY = "presto:banner";
const PLATFORMS: readonly BannerPlatform[] = ["macOS", "Windows", "Linux"];
/** Attributes that only touch the CTA; patched in place so a re-render can't reset the Sheet. */
const CTA_ATTRIBUTES = new Set(["href", "os"]);

// Importing this module must be safe where there is no DOM (SSR, Node scripts): the class is only
// ever constructed by `customElements`, which those runtimes don't have either.
const Base = (typeof HTMLElement === "undefined" ? class {} : HTMLElement) as typeof HTMLElement;

/** Only http(s) install links; anything else (javascript:, data:, garbage) falls back to the default. */
function safeHref(raw: string | null, base: string | undefined): string {
  if (!raw) return DEFAULT_HREF;
  try {
    const url = new URL(raw, base);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : DEFAULT_HREF;
  } catch {
    return DEFAULT_HREF;
  }
}

/**
 * `<presto-banner variant state theme href persist-key fonts os dismiss-days>`.
 *
 * Renders nothing until `state` is set (Tile excepted: it is static placement), so an installed user
 * never sees a flash of the install pitch. `available` never paints: if the banner was showing, it
 * plays the detected morph (crossfade → hold → collapse) and hides; otherwise it stays hidden.
 * Dismissals persist per variant and state under `persist-key` for `dismiss-days` (default 7), or
 * forever from the Sheet's checkbox.
 */
export class PrestoBanner extends Base {
  static readonly tagName = "presto-banner";
  static readonly observedAttributes = [
    "variant",
    "state",
    "href",
    "persist-key",
    "fonts",
    "os",
    "dismiss-days",
  ];
  /** Detected-morph phase durations in ms. Overridable (tests shorten them). */
  static timings = { morph: 400, hold: 1600, collapse: 350 };

  readonly #shadow: ShadowRoot;
  #timers: ReturnType<typeof setTimeout>[] = [];
  /** Set by `connectedCallback`; upgrades of already-connected markup queue attribute callbacks first. */
  #connected = false;
  /** Currently painted. Drives the entrance animation and whether `available` morphs or just hides. */
  #shown = false;
  /** Hid itself after a morph; a later non-`available` state re-arms it. */
  #collapsed = false;
  #morphing = false;

  constructor() {
    super();
    this.#shadow = this.attachShadow({ mode: "open" });
    this.#shadow.addEventListener("click", (event) => this.#onClick(event));
    this.addEventListener("keydown", (event) => this.#onKeydown(event));
  }

  get variant(): BannerVariant {
    const raw = this.getAttribute("variant") as BannerVariant | null;
    return raw && BANNER_VARIANTS.includes(raw) ? raw : "ribbon";
  }

  get state(): BannerState | null {
    const raw = this.getAttribute("state") as BannerState | null;
    return raw && BANNER_STATES.includes(raw) ? raw : null;
  }

  set state(value: BannerState | null) {
    if (value === null) this.removeAttribute("state");
    else this.setAttribute("state", value);
  }

  /** Convenience: `banner.status = await prover.checkPrestoStatus()`. */
  set status(status: PrestoStatusLike) {
    this.state = stateFromStatus(status);
  }

  get href(): string {
    return safeHref(this.getAttribute("href"), this.ownerDocument?.baseURI);
  }

  get platform(): BannerPlatform | null {
    const forced = this.getAttribute("os") as BannerPlatform | null;
    if (forced && PLATFORMS.includes(forced)) return forced;
    return typeof navigator === "undefined" ? null : detectPlatform(navigator.userAgent);
  }

  get dismissDays(): number {
    const parsed = Number(this.getAttribute("dismiss-days"));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 7;
  }

  /** Storage key for the current variant + state; the pitch and each warn state dismiss separately. */
  get persistKey(): string {
    const base = this.getAttribute("persist-key") || DEFAULT_PERSIST_KEY;
    return `${base}:${this.variant}:${this.state ?? "none"}`;
  }

  connectedCallback(): void {
    this.#connected = true;
    ensureFonts(this.getAttribute("fonts"));
    this.#update();
  }

  disconnectedCallback(): void {
    this.#connected = false;
    this.#clearTimers();
    this.#morphing = false;
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (!this.#connected || oldValue === newValue) return;
    if (name === "fonts") ensureFonts(newValue);
    else if (CTA_ATTRIBUTES.has(name) && this.#shown) this.#patchCta();
    else this.#update();
  }

  #update(): void {
    const { variant, state } = this;
    if (state !== "available") this.#collapsed = false;
    if (variant === "tile") {
      this.#paint(variant, state ?? "offline");
      return;
    }
    if (state === "available") {
      if (this.#shown && !this.#collapsed) this.#morph();
      else this.#hide();
      return;
    }
    const handled = state !== null && VARIANT_STATES[variant].includes(state);
    if (!handled || this.#collapsed || isDismissed(this.persistKey)) {
      this.#hide();
      return;
    }
    this.#paint(variant, state);
  }

  #paint(variant: BannerVariant, state: BannerState): void {
    this.#clearTimers();
    this.#morphing = false;
    const enter = !this.#shown;
    const { href, platform } = this;
    this.#shadow.innerHTML = `<style>${STYLES}</style>${render({ variant, state, href, platform, enter })}`;
    this.hidden = false;
    this.#shown = true;
    if (variant === "sheet") this.#openSheet(enter);
  }

  /**
   * Native modal: focus containment, inert background, focus restore on close. `cancel` (Escape) and
   * `close` don't bubble, so they are wired on the dialog itself; the dialog is recreated per paint.
   */
  #openSheet(enter: boolean): void {
    const dialog = this.#shadow.querySelector<HTMLDialogElement>("dialog");
    if (!dialog || dialog.open) return;
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      if (this.#shown) this.#dismiss();
    });
    // Anything else that closes it (a form method=dialog, devtools) is a dismissal too.
    dialog.addEventListener("close", () => {
      if (this.#shown) this.#dismiss();
    });
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    if (enter) this.#shadow.querySelector<HTMLElement>('[data-action="cta"]')?.focus();
  }

  #patchCta(): void {
    const cta = this.#shadow.querySelector<HTMLAnchorElement>('[data-action="cta"]');
    if (!cta) return;
    cta.setAttribute("href", this.href);
    if (this.variant !== "sheet") return;
    const { cta: plain, ctaFor } = VARIANT_COPY.sheet;
    const { platform } = this;
    cta.textContent = platform ? `${ctaFor} ${platform}` : plain;
  }

  #hide(): void {
    this.#clearTimers();
    this.#morphing = false;
    // Flags first: the dialog's `close` listener treats a close while shown as a user dismissal.
    this.#shown = false;
    this.hidden = true;
    const dialog = this.#shadow.querySelector<HTMLDialogElement>("dialog");
    if (dialog?.open) dialog.close();
    this.#shadow.innerHTML = "";
  }

  #morph(): void {
    if (this.#morphing) return;
    const root = this.#shadow.querySelector(".root");
    const overlay = root?.querySelector(".detected");
    if (!root || !overlay) {
      this.#hide();
      return;
    }
    this.#morphing = true;
    const { morph, hold, collapse } = PrestoBanner.timings;
    overlay.innerHTML = detectedContent();
    root.firstElementChild?.setAttribute("inert", "");
    root.setAttribute("data-phase", "detected");
    this.#after(morph + hold, () => root.setAttribute("data-phase", "gone"));
    this.#after(morph + hold + collapse, () => {
      this.#collapsed = true;
      this.#hide();
      this.#emit(BANNER_EVENTS.collapsed);
    });
  }

  #after(ms: number, fn: () => void): void {
    this.#timers.push(setTimeout(fn, ms));
  }

  #clearTimers(): void {
    for (const timer of this.#timers) clearTimeout(timer);
    this.#timers = [];
  }

  #onClick(event: Event): void {
    const control = (event.target as Element | null)?.closest?.("[data-action]");
    if (!control) return;
    switch (control.getAttribute("data-action")) {
      case "cta":
        if (!this.#emit(BANNER_EVENTS.cta, {}, true)) event.preventDefault();
        break;
      case "retry":
        this.#emit(BANNER_EVENTS.retry);
        break;
      case "dismiss":
        this.#dismiss();
        break;
    }
  }

  #onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && this.variant === "sheet" && this.#shown) this.#dismiss();
  }

  /** Hide before emitting: a listener that sets a new state must not be undone by the teardown. */
  #dismiss(): void {
    const never = this.#shadow.querySelector<HTMLInputElement>('[data-role="never"]');
    const forever = never?.checked === true;
    dismiss(this.persistKey, { days: this.dismissDays, forever });
    this.#hide();
    this.#emit(BANNER_EVENTS.dismiss, { forever });
  }

  /** Dispatch a bubbling, composed event; returns `false` when a listener called `preventDefault()`. */
  #emit(type: string, extra: Partial<BannerEventDetail> = {}, cancelable = false): boolean {
    const detail: BannerEventDetail = {
      variant: this.variant,
      state: this.state,
      href: this.href,
      ...extra,
    };
    return this.dispatchEvent(
      new CustomEvent(type, { detail, bubbles: true, composed: true, cancelable }),
    );
  }
}

/** Register the element (idempotent, no-op without `customElements`). Returns whether it is defined. */
export function definePrestoBanner(tagName = PrestoBanner.tagName): boolean {
  if (typeof customElements === "undefined") return false;
  if (!customElements.get(tagName)) customElements.define(tagName, PrestoBanner);
  return true;
}

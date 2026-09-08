import { ensureFonts } from "./fonts.js";
import { dismiss, isDismissed } from "./persistence.js";
import { detectPlatform } from "./platform.js";
import { render } from "./render.js";
import { stateFromStatus } from "./status.js";
import { VARIANT_STATES } from "./strings.js";
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

// Importing this module must be safe where there is no DOM (SSR, Node scripts): the class is only
// ever constructed by `customElements`, which those runtimes don't have either.
const Base = (typeof HTMLElement === "undefined" ? class {} : HTMLElement) as typeof HTMLElement;

/**
 * `<presto-banner variant state theme href persist-key fonts os dismiss-days>`.
 *
 * Renders nothing until `state` is set, so an installed user never sees a flash of the install
 * pitch. `available` never paints: if the banner was showing, it plays the detected morph
 * (crossfade → hold → collapse) and hides; otherwise it stays hidden. Dismissals persist per
 * variant and state under `persist-key` for `dismiss-days` (default 7), or forever from the Sheet's
 * checkbox.
 */
export class PrestoBanner extends Base {
  static readonly tagName = "presto-banner";
  static readonly observedAttributes = [
    "variant",
    "state",
    "theme",
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
  /** Currently painted. Drives the entrance animation and whether `available` morphs or just hides. */
  #shown = false;
  /** Hid itself after a morph; a later non-`available` state re-arms it. */
  #collapsed = false;

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
    return this.getAttribute("href") || DEFAULT_HREF;
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
    ensureFonts(this.getAttribute("fonts"));
    this.#update();
  }

  disconnectedCallback(): void {
    this.#clearTimers();
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (!this.isConnected || oldValue === newValue) return;
    if (name === "fonts") ensureFonts(newValue);
    if (name !== "theme") this.#update();
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
    const enter = !this.#shown;
    const { href, platform } = this;
    this.#shadow.innerHTML = `<style>${STYLES}</style>${render({ variant, state, href, platform, enter })}`;
    this.hidden = false;
    this.#shown = true;
    if (variant === "sheet") {
      this.classList.toggle("is-enter", enter);
      this.#shadow.querySelector<HTMLElement>('[data-action="cta"]')?.focus();
    }
  }

  #hide(): void {
    this.#clearTimers();
    this.hidden = true;
    this.#shown = false;
    this.classList.remove("is-enter");
    this.#shadow.innerHTML = "";
  }

  #morph(): void {
    this.#clearTimers();
    const root = this.#shadow.querySelector(".root");
    if (!root) {
      this.#hide();
      return;
    }
    const { morph, hold, collapse } = PrestoBanner.timings;
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

  #dismiss(): void {
    const never = this.#shadow.querySelector<HTMLInputElement>('[data-role="never"]');
    const forever = never?.checked === true;
    dismiss(this.persistKey, { days: this.dismissDays, forever });
    this.#emit(BANNER_EVENTS.dismiss, { forever });
    this.#hide();
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

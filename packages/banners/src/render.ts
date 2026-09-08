import { BOLT, CHECK, CLOSE, HERO, SPARK_GLYPH, SPARK_SVG } from "./icons.js";
import {
  CONNECTED_SUPPORT,
  CONNECTED_TITLE,
  DISMISS,
  STRINGS,
  type StateStrings,
  VARIANT_COPY,
} from "./strings.js";
import type { BannerPlatform, BannerState, BannerVariant } from "./types.js";

export interface RenderContext {
  variant: BannerVariant;
  state: BannerState;
  /** Install link; host-provided, escaped at render. */
  href: string;
  platform: BannerPlatform | null;
  /** Play the entrance keyframes (first paint after being hidden). */
  enter: boolean;
}

const RELEASES = "https://github.com/alejoamiras/presto/releases";
const HOW = "https://presto.build/#how";

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function ctaLink(href: string, label: string, cls: string): string {
  return `<a class="btn ${cls}" data-action="cta" href="${escapeHtml(href)}" target="_blank" rel="noopener">${label}</a>`;
}

function closeButton(): string {
  return `<button type="button" class="x" data-action="dismiss" aria-label="${DISMISS}">${CLOSE}</button>`;
}

/** Empty until the morph fills it, so assistive tech never reads "connected" while offline. */
function detectedOverlay(): string {
  return `<div class="detected" aria-live="polite"></div>`;
}

/** Markup the element writes into the overlay when a showing banner flips to `available`. */
export function detectedContent(): string {
  return `${CHECK}<span>${CONNECTED_TITLE} ${SPARK_GLYPH} ${CONNECTED_SUPPORT}</span>`;
}

function wordmark(): string {
  return `<span class="wordmark">presto${SPARK_GLYPH}</span>`;
}

/** The Ribbon's primary control, by the state's primary kind. */
function ribbonPrimary(strings: StateStrings, href: string): string {
  switch (strings.primary) {
    case "cta":
      return ctaLink(href, strings.primaryLabel, "btn-primary btn-sm");
    case "retry":
      return `<button type="button" class="btn btn-outline btn-sm" data-action="retry">${strings.primaryLabel}</button>`;
    case "status":
      return `<span class="status"><span class="dot${strings.tone === "go" ? " go" : ""}"></span>${strings.primaryLabel}</span>`;
  }
}

function ribbon(ctx: RenderContext, enter: string): string {
  const s = STRINGS[ctx.state];
  const spark = ctx.state === "available" ? SPARK_GLYPH : "";
  return `<div class="ribbon${enter}" data-tone="${s.tone}" role="status">
    ${BOLT}
    <p><strong>${s.title}${spark}</strong><span class="sep" aria-hidden="true">·</span><span class="sub">${s.support}</span></p>
    ${ribbonPrimary(s, ctx.href)}
    ${closeButton()}
  </div>${detectedOverlay()}`;
}

function billboard(ctx: RenderContext, enter: string): string {
  const c = VARIANT_COPY.billboard;
  return `<div class="billboard${enter}" role="complementary">
    <div class="badge">${BOLT}</div>
    <div class="text"><h2 class="title">${c.title}${SPARK_GLYPH}</h2><p class="support">${c.support}</p></div>
    <div class="actions">${ctaLink(ctx.href, c.cta, "btn-light")}${closeButton()}</div>
  </div>${detectedOverlay()}`;
}

function dock(ctx: RenderContext, enter: string): string {
  const c = VARIANT_COPY.dock;
  return `<div class="dock${enter}" role="status">
    <div class="text">${BOLT}<strong>${c.title}</strong><span>${c.support}</span></div>
    ${ctaLink(ctx.href, c.cta, "btn-primary btn-sm")}
    ${closeButton()}
    <div class="race" aria-hidden="true">
      <span class="race-name">${c.raceBrowser}</span><span class="race-track"><span class="race-bar race-slow"></span></span>
      <span class="race-name strong">${c.racePresto}</span><span class="race-track accent"><span class="race-bar race-fast"></span></span>
    </div>
  </div>${detectedOverlay()}`;
}

function card(ctx: RenderContext, enter: string): string {
  const c = VARIANT_COPY.card;
  return `<div class="card${enter}" role="complementary">
    ${closeButton()}
    <div class="art">${HERO}</div>
    <p class="eyebrow">${c.eyebrow}</p>
    <h2 class="title">${c.title}</h2>
    <p class="support">${c.support}</p>
    ${ctaLink(ctx.href, c.cta, "btn-primary")}
    <p class="note">${c.note}</p>
  </div>${detectedOverlay()}`;
}

function tile(ctx: RenderContext, enter: string): string {
  const c = VARIANT_COPY.tile;
  return `<div class="tile${enter}" role="complementary">
    <svg class="big-bolt" viewBox="0 0 48 48" aria-hidden="true"><path d="M26 5 L12 27 H21 L19 43 L36 19 H25 Z" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/></svg>
    <span class="tw">${SPARK_SVG}</span>
    ${wordmark()}
    <div class="copy"><h2 class="title">${c.title}</h2><p class="support">${c.support}</p></div>
    <div class="actions">${ctaLink(ctx.href, c.cta, "btn-light")}<a class="link" href="${HOW}" target="_blank" rel="noopener">${c.link}</a></div>
  </div>`;
}

function sheet(ctx: RenderContext, enter: string): string {
  const c = VARIANT_COPY.sheet;
  const cta = ctx.platform ? `${c.ctaFor} ${ctx.platform}` : c.cta;
  return `<dialog class="sheet${enter}" aria-labelledby="sheet-title">
    <div class="brand">${BOLT}${wordmark()}</div>
    <h2 class="title" id="sheet-title">${c.title}</h2>
    <p class="support">${c.support}</p>
    <div class="actions">
      ${ctaLink(ctx.href, cta, "btn-primary")}
      <button type="button" class="btn btn-outline" data-action="dismiss">${c.decline}</button>
    </div>
    <div class="foot">
      <label><input type="checkbox" data-role="never"> ${c.never}</label>
      <span>${c.foot} <a href="${RELEASES}" target="_blank" rel="noopener">${c.otherPlatforms}</a></span>
    </div>
    ${detectedOverlay()}
  </dialog>`;
}

const TEMPLATES: Record<BannerVariant, (ctx: RenderContext, enter: string) => string> = {
  ribbon,
  billboard,
  dock,
  card,
  tile,
  sheet,
};

/** Markup for the `.root` wrapper's contents. */
export function render(ctx: RenderContext): string {
  const enter = ctx.enter ? " is-enter" : "";
  return `<div class="root root-${ctx.variant}">${TEMPLATES[ctx.variant](ctx, enter)}</div>`;
}

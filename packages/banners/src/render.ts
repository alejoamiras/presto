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

/** Every install link, primary or secondary, is a `cta`: same event, same `href` patching. */
function ctaLink(href: string, label: string, cls: string): string {
  return `<a class="${cls}" data-action="cta" href="${escapeHtml(href)}" target="_blank" rel="noopener">${label}</a>`;
}

/** A button, never a link: connecting asks the host to act, it opens nothing. */
function connectButton(label: string, cls: string): string {
  return `<button type="button" class="btn ${cls}" data-action="connect">${label}</button>`;
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

export function sheetCtaLabel(state: BannerState, platform: BannerPlatform | null): string {
  const c = VARIANT_COPY.sheet;
  if (state === "connect") return platform ? `${c.connect.getFor} ${platform}` : c.connect.get;
  return platform ? `${c.ctaFor} ${platform}` : c.cta;
}

function wordmark(): string {
  return `<span class="wordmark">presto${SPARK_GLYPH}</span>`;
}

/** The Ribbon's primary control, by the state's primary kind. */
function ribbonPrimary(strings: StateStrings, href: string): string {
  switch (strings.primary) {
    case "cta":
      return ctaLink(href, strings.primaryLabel, "btn btn-primary btn-sm");
    case "connect":
      return connectButton(strings.primaryLabel, "btn-primary btn-sm");
    case "retry":
      return `<button type="button" class="btn btn-outline btn-sm" data-action="retry">${strings.primaryLabel}</button>`;
    case "status":
      return `<span class="status"><span class="dot${strings.tone === "go" ? " go" : ""}"></span>${strings.primaryLabel}</span>`;
  }
}

function ribbon(ctx: RenderContext, enter: string): string {
  const s = STRINGS[ctx.state];
  const spark = ctx.state === "available" ? SPARK_GLYPH : "";
  return `<div class="ribbon${enter}" data-tone="${s.tone}" data-surface role="status">
    ${BOLT}
    <p><strong>${s.title}${spark}</strong><span class="sep" aria-hidden="true">·</span><span class="sub">${s.support}</span></p>
    ${ribbonPrimary(s, ctx.href)}
    ${closeButton()}
  </div>${detectedOverlay()}`;
}

function billboard(ctx: RenderContext, enter: string): string {
  const c = VARIANT_COPY.billboard;
  const connect = ctx.state === "connect";
  const actions = connect
    ? `<div class="actions">${connectButton(c.connect.action, "btn-light")}${ctaLink(ctx.href, c.connect.link, "link")}${closeButton()}</div>`
    : `<div class="actions">${ctaLink(ctx.href, c.cta, "btn btn-light")}${closeButton()}</div>`;
  return `<div class="billboard${enter}" data-surface role="complementary">
    <div class="badge">${BOLT}</div>
    <div class="text"><h2 class="title">${c.title}${SPARK_GLYPH}</h2><p class="support">${connect ? c.connect.support : c.support}</p></div>
    ${actions}
  </div>${detectedOverlay()}`;
}

function dock(ctx: RenderContext, enter: string): string {
  const c = VARIANT_COPY.dock;
  const connect = ctx.state === "connect";
  return `<div class="dock${enter}" data-surface role="status">
    <div class="text">${BOLT}<strong>${c.title}</strong><span>${connect ? c.connect.support : c.support}</span></div>
    ${connect ? connectButton(c.connect.action, "btn-primary btn-sm") : ctaLink(ctx.href, c.cta, "btn btn-primary btn-sm")}
    ${closeButton()}
    <div class="race" aria-hidden="true">
      <span class="race-name">${c.raceBrowser}</span><span class="race-track"><span class="race-bar race-slow"></span></span>
      <span class="race-name strong">${c.racePresto}</span><span class="race-track accent"><span class="race-bar race-fast"></span></span>
    </div>
  </div>${detectedOverlay()}`;
}

function card(ctx: RenderContext, enter: string): string {
  const c = VARIANT_COPY.card;
  const connect = ctx.state === "connect";
  const body = connect
    ? `<h2 class="title">${c.connect.title}</h2>
    <p class="support">${c.connect.support}</p>
    ${connectButton(c.connect.action, "btn-primary")}
    <p class="note">${c.connect.note} ${ctaLink(ctx.href, c.connect.link, "get")}</p>`
    : `<h2 class="title">${c.title}</h2>
    <p class="support">${c.support}</p>
    ${ctaLink(ctx.href, c.cta, "btn btn-primary")}
    <p class="note">${c.note}</p>`;
  return `<div class="card${enter}" data-surface role="complementary">
    ${closeButton()}
    <div class="art">${HERO}</div>
    <p class="eyebrow">${c.eyebrow}</p>
    ${body}
  </div>${detectedOverlay()}`;
}

function tile(ctx: RenderContext, enter: string): string {
  const c = VARIANT_COPY.tile;
  const connect = ctx.state === "connect";
  const support = connect
    ? `<p class="support wide">${c.connect.support}</p>`
    : `<p class="support">${c.support}</p>`;
  const actions = connect
    ? `${connectButton(c.connect.action, "btn-light")}${ctaLink(ctx.href, c.connect.link, "link")}`
    : `${ctaLink(ctx.href, c.cta, "btn btn-light")}<a class="link" href="${HOW}" target="_blank" rel="noopener">${c.link}</a>`;
  return `<div class="tile${enter}" data-surface role="complementary">
    <svg class="big-bolt" viewBox="0 0 48 48" aria-hidden="true"><path d="M26 5 L12 27 H21 L19 43 L36 19 H25 Z" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/></svg>
    <span class="tw">${SPARK_SVG}</span>
    ${wordmark()}
    <div class="copy"><h2 class="title">${c.title}</h2>${support}</div>
    <div class="actions">${actions}</div>
  </div>`;
}

function sheet(ctx: RenderContext, enter: string): string {
  const c = VARIANT_COPY.sheet;
  const connect = ctx.state === "connect";
  const cta = sheetCtaLabel(ctx.state, ctx.platform);
  const primary = connect
    ? connectButton(c.connect.action, "btn-primary")
    : ctaLink(ctx.href, cta, "btn btn-primary");
  const foot = connect
    ? `${c.connect.foot} ${ctaLink(ctx.href, cta, "get")}`
    : `${c.foot} <a href="${RELEASES}" target="_blank" rel="noopener">${c.otherPlatforms}</a>`;
  return `<dialog class="sheet${enter}" aria-labelledby="sheet-title">
    <div class="sheet-body" data-surface>
    <div class="brand">${BOLT}${wordmark()}</div>
    <h2 class="title" id="sheet-title">${connect ? c.connect.title : c.title}</h2>
    <p class="support">${connect ? c.connect.support : c.support}</p>
    <div class="actions">
      ${primary}
      <button type="button" class="btn btn-outline" data-action="dismiss">${c.decline}</button>
    </div>
    <div class="foot">
      <label><input type="checkbox" data-role="never"> ${c.never}</label>
      <span>${foot}</span>
    </div>
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

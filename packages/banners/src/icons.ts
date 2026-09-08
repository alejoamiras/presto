/** Inline SVG markup. `currentColor` everywhere so the tone tokens colour them. */

export const BOLT =
  '<svg class="ico-bolt" viewBox="0 0 48 48" aria-hidden="true"><path d="M26 5 L12 27 H21 L19 43 L36 19 H25 Z" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/></svg>';

export const SPARK_GLYPH = '<i class="spark" aria-hidden="true">✦</i>';

export const SPARK_SVG =
  '<svg class="ico-spark" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0l1.9 6.1L16 8l-6.1 1.9L8 16l-1.9-6.1L0 8l6.1-1.9Z" fill="currentColor"/></svg>';

export const CHECK =
  '<svg class="ico-check" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 12.5l2.5 2.5 5.5-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export const CLOSE =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

/** The landing's hero drawing: dotted cloud, bolt, twinkling spark and mote. */
export const HERO =
  '<svg class="illo" viewBox="0 0 120 120" fill="none" aria-hidden="true">' +
  '<path class="illo-cloud" d="M34 78 a16 16 0 0 1 -2 -31 a20 20 0 0 1 38 -8 a15 15 0 0 1 18 22 a14 14 0 0 1 -6 17" stroke-linecap="round" stroke-dasharray="1 7"/>' +
  '<path class="illo-bolt" d="M64 34 L46 62 H58 L55 84 L77 52 H63 Z" stroke-linejoin="round"/>' +
  '<path class="illo-spark tw" d="M88 30 l2.6 5.5 5.5 2.6 -5.5 2.6 -2.6 5.5 -2.6-5.5 -5.5-2.6 5.5-2.6 Z"/>' +
  '<path class="illo-mote tw tw2" d="M28 40 l1.8 3.8 3.8 1.8 -3.8 1.8 -1.8 3.8 -1.8-3.8 -3.8-1.8 3.8-1.8 Z"/>' +
  '<circle class="illo-dot1" cx="90" cy="78" r="2.6"/><circle class="illo-dot2" cx="30" cy="86" r="2"/>' +
  "</svg>";

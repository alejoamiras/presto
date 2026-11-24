// Timeline for og-landing.html. Every frame is a pure function of t (no timers, no CSS animation),
// and t = DURATION lands on the same frame as t = 0, so the video loops without a seam.

// The landing's race numbers (packages/landing/src/race.ts); update both together.
const WASM_S = 38.4;
const PRESTO_S = 4.1;
const RACE_START = 2.95;
const WASM_ANIM = 5.0;
// The bars keep the measured ratio exactly, unlike the landing's rounded 7000/750 ms.
const PRESTO_ANIM = (WASM_ANIM * PRESTO_S) / WASM_S;
const PRESTO_DONE = RACE_START + PRESTO_ANIM;

const DURATION = 10;

// Mark travels from the card's 300 px slot (96, 165) to an 84 px lockup at (40, 22).
const MARK_FROM = { x: 96, y: 165, s: 1 };
const MARK_TO = { x: 40, y: 22, s: 84 / 300 };

const clamp = (x) => Math.min(1, Math.max(0, x));
const remap = (t, t0, t1) => clamp((t - t0) / (t1 - t0));
const lerp = (a, b, k) => a + (b - a) * k;
const E = {
  cubicIn: (x) => x ** 3,
  cubicOut: (x) => 1 - (1 - x) ** 3,
  cubicInOut: (x) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2),
  quartOut: (x) => 1 - (1 - x) ** 4,
  backOut: (x) => 1 + 2.2 * (x - 1) ** 3 + 1.2 * (x - 1) ** 2,
};
/** 0 → 1 → 0 across [t0, t0 + len]. */
const bump = (t, t0, len) => Math.sin(Math.PI * remap(t, t0, t0 + len));
/** Rises over [a0, a1], falls back over [b0, b1]. */
const span = (t, a0, a1, b0, b1, ease = E.cubicInOut) =>
  ease(remap(t, a0, a1)) * (1 - ease(remap(t, b0, b1)));

const $ = (id) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`og-landing: missing #${id}`);
  return el;
};
const el = {
  mark: $("mark"),
  markSpark: $("mark-spark"),
  wordmark: $("wordmark"),
  lines: [...$("copy").children],
  copyStar: $("copy-star"),
  race: $("race"),
  chip: $("chip"),
  wBar: $("w-bar"),
  pBar: $("p-bar"),
  wNum: $("w-num"),
  pNum: $("p-num"),
  pStar: $("p-star"),
};

function drawMark(t) {
  const k = span(t, 1.6, 2.4, 8.9, 9.7);
  const x = lerp(MARK_FROM.x, MARK_TO.x, k) - MARK_FROM.x;
  const y = lerp(MARK_FROM.y, MARK_TO.y, k) - MARK_FROM.y;
  el.mark.style.transform = `translate(${x}px, ${y}px) scale(${lerp(MARK_FROM.s, MARK_TO.s, k)})`;
  // Twinkles once on the card and once when Presto finishes.
  const s = 1 + 0.2 * bump(t, 0.35, 0.7) + 0.35 * bump(t, PRESTO_DONE, 0.5);
  el.markSpark.setAttribute("transform", `translate(88 34.4) scale(${s}) translate(-88 -34.4)`);
  const w = span(t, 2.0, 2.5, 8.7, 9.1);
  el.wordmark.style.opacity = String(w);
  el.wordmark.style.transform = `translateX(${(1 - w) * 14}px)`;
}

function drawCopy(t) {
  el.lines.forEach((line, i) => {
    const d = 0.07 * i;
    const out = E.cubicIn(remap(t, 1.5 + d, 2.05 + d));
    const back = E.cubicOut(remap(t, 9.0 + d, 9.6 + d));
    // Leaves upward and comes back up from below, so the motion never reverses.
    const y = t < DURATION / 2 ? -26 * out : 26 * (1 - back);
    line.style.opacity = String(1 - out + back);
    line.style.transform = `translateY(${y}px)`;
  });
  el.copyStar.style.transform = `scale(${1 + 0.22 * bump(t, 0.75, 0.7)})`;
}

function drawRace(t) {
  const enter = E.quartOut(remap(t, 2.05, 2.75));
  const exit = E.cubicIn(remap(t, 8.55, 9.1));
  el.race.style.opacity = String(enter * (1 - exit));
  el.race.style.transform = `translateY(${44 * (1 - enter) + 28 * exit}px)`;

  const wp = remap(t, RACE_START, RACE_START + WASM_ANIM);
  const pp = remap(t, RACE_START, PRESTO_DONE);
  el.wBar.style.width = `${wp * 100}%`;
  el.pBar.style.width = `${pp * 100}%`;
  el.wNum.textContent = `${(wp * WASM_S).toFixed(1)}s`;
  el.pNum.textContent = `${(pp * PRESTO_S).toFixed(1)}s`;
  el.pNum.style.color = pp >= 1 ? "var(--accent)" : "";

  const pop = E.backOut(remap(t, PRESTO_DONE, PRESTO_DONE + 0.35));
  el.pStar.style.opacity = String(remap(t, PRESTO_DONE, PRESTO_DONE + 0.1));
  el.pStar.style.transform = `scale(${pop * (1 + 0.15 * bump(t, PRESTO_DONE + 2.2, 0.8))})`;

  const chip = E.backOut(remap(t, PRESTO_DONE + 0.08, PRESTO_DONE + 0.48));
  el.chip.style.opacity = String(remap(t, PRESTO_DONE + 0.08, PRESTO_DONE + 0.2));
  el.chip.style.transform = `scale(${0.6 + 0.4 * chip})`;
}

function seek(t) {
  drawMark(t);
  drawCopy(t);
  drawRace(t);
}

const FACES = ["800 96px Bricolage", "600 46px Figtree", "700 46px Figtree", "400 60px Fragment"];
await Promise.all(FACES.map((f) => document.fonts.load(f)));
for (const f of FACES)
  if (!document.fonts.check(f)) throw new Error(`og-landing: font ${f} not loaded`);

Object.assign(window, { DURATION, seek });
seek(0);
window.ready = true;

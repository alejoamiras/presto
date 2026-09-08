/**
 * Shadow stylesheet. Tokens are `--pb-*` custom properties on `:host`; a host page overrides them
 * by styling the element itself (`presto-banner { --pb-accent: … }`), which beats `:host` by the
 * cascade rules for shadow trees. Everything else is unreachable from outside.
 */

const LIGHT = `
  --pb-bg: #fffaf1; --pb-surface: #ffffff; --pb-wash: #fff3dd; --pb-border: #ece3d4;
  --pb-text: #241b33; --pb-muted: #6e6580;
  --pb-accent: #3b4fe0; --pb-accent-dim: #2f40c4; --pb-accent-on: #ffffff;
  --pb-gold: #ffc53d; --pb-gold-text: #7a5a00; --pb-go: #189e62; --pb-go-text: #147a4c;
  --pb-shadow: 0 10px 30px -14px rgba(36,27,51,.18); --pb-shadow-big: 0 24px 60px -28px rgba(36,27,51,.32);
  --pb-solid: #3b4fe0; --pb-solid-deep: #2f40c4;
  --pb-backdrop: rgba(36,27,51,.42);
`;

const DARK = `
  --pb-bg: #191226; --pb-surface: #221a33; --pb-wash: #2a2140; --pb-border: #372c4e;
  --pb-text: #f1ebe0; --pb-muted: #9d93b0;
  --pb-accent: #8b99ff; --pb-accent-dim: #a5b0ff; --pb-accent-on: #141026;
  --pb-gold: #ffd066; --pb-gold-text: #ffd87e; --pb-go: #3fce8c; --pb-go-text: #3fce8c;
  --pb-shadow: 0 10px 30px -14px rgba(0,0,0,.5); --pb-shadow-big: 0 24px 60px -28px rgba(0,0,0,.65);
  --pb-solid: #3446cf; --pb-solid-deep: #2b3ab0;
  --pb-backdrop: rgba(0,0,0,.58);
`;

export const STYLES = `
:host { ${LIGHT}
  --pb-font-body: "Figtree", system-ui, -apple-system, "Segoe UI", sans-serif;
  --pb-font-display: "Bricolage Grotesque", system-ui, -apple-system, "Segoe UI", sans-serif;
  --pb-z: 2147483000;
  display: block; box-sizing: border-box; font-family: var(--pb-font-body); color: var(--pb-text);
  line-height: 1.45; -webkit-font-smoothing: antialiased; text-align: left;
}
@media (prefers-color-scheme: dark) { :host(:not([theme="light"])) { ${DARK} } }
:host([theme="dark"]) { ${DARK} }
:host([hidden]) { display: none !important; }
:host([variant="card"]), :host([variant="tile"]) { display: inline-block; width: 300px; max-width: 100%; }
:host([variant="dock"]) { position: fixed; right: 16px; bottom: 16px; z-index: var(--pb-z); width: min(440px, calc(100vw - 32px)); }
:host([variant="sheet"]) { position: fixed; inset: 0; z-index: var(--pb-z); display: flex; align-items: center; justify-content: center; padding: 20px; background: var(--pb-backdrop); }
:host([variant="sheet"].is-enter) { animation: backdrop .25s ease both; }
*, *::before, *::after { box-sizing: border-box; }
p, h2 { margin: 0; }
a { color: inherit; }

.root { position: relative; transition: opacity .35s ease, transform .35s ease; }
/* The detected overlay inherits its radius from the wrapper, so each wrapper carries its surface's. */
.root-billboard { border-radius: 16px; } .root-dock { border-radius: 14px; } .root-card, .root-tile { border-radius: 20px; } .root-sheet { border-radius: 24px; }
.root[data-phase="gone"] { opacity: 0; transform: translateY(-6px) scale(.985); pointer-events: none; }
.title { font-family: var(--pb-font-display); font-weight: 800; letter-spacing: -0.015em; line-height: 1.12; text-wrap: balance; }
.wordmark { font-family: var(--pb-font-display); font-weight: 800; letter-spacing: -0.015em; }
.spark { color: var(--pb-gold); font-style: normal; }
.tw { display: inline-block; animation: twinkle 2.6s ease-in-out infinite; transform-origin: center; transform-box: fill-box; }
.tw2 { animation-delay: 1.2s; }
.ico-bolt { display: block; }

.btn { display: inline-flex; align-items: center; justify-content: center; gap: 7px; border-radius: 999px; font-weight: 700; text-decoration: none; cursor: pointer; border: 1.5px solid transparent; font-family: inherit; font-size: 14px; line-height: 1; white-space: nowrap; padding: 12px 22px; transition: transform .15s cubic-bezier(.34,1.56,.64,1), background .15s, border-color .15s, color .15s; }
.btn:active { transform: scale(.96); }
.btn:focus-visible, .x:focus-visible, input:focus-visible, .link:focus-visible { outline: 2.5px solid var(--pb-accent); outline-offset: 2px; }
.btn-primary { background: var(--pb-accent); color: var(--pb-accent-on); box-shadow: 0 6px 16px -6px color-mix(in srgb, var(--pb-accent) 45%, transparent); }
.btn-primary:hover { background: var(--pb-accent-dim); transform: translateY(-1px); }
.btn-sm { padding: 7px 14px; font-size: 12.5px; }
.btn-outline { background: transparent; border-color: var(--pb-border); color: var(--pb-text); }
.btn-outline:hover { border-color: var(--pb-accent); color: var(--pb-accent-dim); }
.btn-outline.btn-sm { padding: 6px 13px; }
.btn-light { background: #ffffff; color: var(--pb-solid-deep); }
.btn-light:hover { transform: translateY(-1px); background: #fff8e6; }
.x { width: 28px; height: 28px; border-radius: 8px; border: 0; background: transparent; color: var(--pb-muted); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; flex: none; padding: 0; transition: background .15s, color .15s; }
.x svg { width: 15px; height: 15px; }
.x:hover { background: color-mix(in srgb, var(--pb-text) 8%, transparent); color: var(--pb-text); }
.status { display: inline-flex; align-items: center; gap: 7px; font-weight: 700; font-size: 12px; color: var(--pb-muted); white-space: nowrap; }
.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--pb-gold); animation: breathe 2.4s ease-in-out infinite; }
.detected { position: absolute; inset: 0; z-index: 2; border-radius: inherit; display: flex; align-items: center; justify-content: center; gap: 9px; padding: 12px; text-align: center; background: color-mix(in srgb, var(--pb-go) 15%, var(--pb-surface)); color: var(--pb-go-text); border: 1px solid color-mix(in srgb, var(--pb-go) 45%, transparent); font-weight: 700; font-size: 13.5px; opacity: 0; pointer-events: none; transition: opacity .4s ease; }
.detected .ico-check { width: 18px; height: 18px; flex: none; }
.root[data-phase="detected"] .detected, .root[data-phase="gone"] .detected { opacity: 1; }

/* Ribbon */
.ribbon { display: flex; align-items: center; justify-content: center; gap: 12px; min-height: 44px; padding: 7px 12px 7px 16px; background: color-mix(in srgb, var(--pb-accent) 11%, var(--pb-bg)); border-bottom: 1px solid var(--pb-border); font-size: 12.5px; }
.ribbon[data-tone="warn"] { background: color-mix(in srgb, var(--pb-gold) 18%, var(--pb-bg)); }
.ribbon[data-tone="go"] { background: color-mix(in srgb, var(--pb-go) 14%, var(--pb-bg)); }
.ribbon.is-enter { animation: drop .4s cubic-bezier(.22,.61,.36,1) both; }
.ribbon .ico-bolt { width: 16px; height: 16px; color: var(--pb-accent); flex: none; }
.ribbon[data-tone="warn"] .ico-bolt, .ribbon[data-tone="warn"] strong { color: var(--pb-gold-text); }
.ribbon[data-tone="go"] .ico-bolt, .ribbon[data-tone="go"] strong { color: var(--pb-go-text); }
.ribbon p { font-weight: 500; min-width: 0; }
.ribbon strong { font-weight: 800; }
.ribbon .sep { margin: 0 6px; color: var(--pb-muted); }
.ribbon .sub { color: var(--pb-muted); }
.ribbon .x { margin-left: 4px; }

/* Billboard */
.billboard { display: flex; align-items: center; gap: 18px; padding: 18px 22px; border-radius: 16px; background: var(--pb-solid); color: #ffffff; box-shadow: 0 14px 34px -18px color-mix(in srgb, var(--pb-solid) 70%, transparent); }
.billboard.is-enter { animation: fade-up .6s cubic-bezier(.22,.61,.36,1) both; }
.billboard .badge { width: 46px; height: 46px; border-radius: 50%; background: rgba(255,255,255,.16); display: flex; align-items: center; justify-content: center; flex: none; animation: floaty 5.5s ease-in-out infinite; }
.billboard .badge .ico-bolt { width: 26px; height: 26px; color: #ffffff; }
.billboard .text { flex: 1 1 320px; min-width: 0; }
.billboard .title { font-size: 19px; }
.billboard .support { font-size: 13.5px; font-weight: 500; opacity: .86; margin-top: 3px; max-width: 58ch; }
.billboard .actions { display: flex; align-items: center; gap: 8px; flex: none; margin-left: auto; }
.billboard .x { color: rgba(255,255,255,.7); }
.billboard .x:hover { background: rgba(255,255,255,.14); color: #fff; }
@container (max-width: 640px) { .billboard { flex-wrap: wrap; } .billboard .actions { width: 100%; margin-left: 0; padding-left: 64px; } }
.root-billboard { container-type: inline-size; }

/* Dock */
.dock { display: grid; grid-template-columns: 1fr auto auto; grid-template-areas: "text cta x" "race race race"; align-items: center; gap: 12px; padding: 13px 12px 13px 16px; border-radius: 14px; background: var(--pb-surface); border: 1px solid var(--pb-border); box-shadow: var(--pb-shadow-big); }
.dock.is-enter { animation: slide .5s cubic-bezier(.22,.61,.36,1) both; }
.dock .text { grid-area: text; display: grid; grid-template-columns: 16px 1fr; gap: 1px 9px; align-items: center; min-width: 0; }
.dock .text .ico-bolt { width: 16px; height: 16px; color: var(--pb-accent); grid-row: span 2; align-self: start; margin-top: 2px; }
.dock .text strong { font-size: 13.5px; font-weight: 800; line-height: 1.2; }
.dock .text span { font-size: 12px; color: var(--pb-muted); font-weight: 500; line-height: 1.3; }
.dock .btn { grid-area: cta; }
.dock .x { grid-area: x; }
.race { grid-area: race; display: grid; grid-template-columns: auto 1fr; gap: 6px 10px; align-items: center; padding-right: 4px; }
.race-name { font-size: 9px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--pb-muted); white-space: nowrap; line-height: 1; }
.race-name.strong { color: var(--pb-text); }
.race-track { height: 6px; border-radius: 3px; background: color-mix(in srgb, var(--pb-text) 8%, transparent); overflow: hidden; }
.race-track.accent { background: color-mix(in srgb, var(--pb-accent) 12%, transparent); }
.race-bar { display: block; height: 100%; border-radius: 3px; }
.race-slow { background: var(--pb-muted); animation: crawl 7s linear infinite; }
.race-fast { width: 11%; background: var(--pb-accent); }

/* Card */
.card { position: relative; background: var(--pb-surface); border: 1px solid var(--pb-border); border-radius: 20px; box-shadow: var(--pb-shadow); padding: 14px 18px 18px; }
.card.is-enter { animation: fade-up .6s cubic-bezier(.22,.61,.36,1) both; }
.card .x { position: absolute; top: 20px; right: 24px; background: color-mix(in srgb, var(--pb-surface) 70%, transparent); }
.card .art { background: var(--pb-wash); border-radius: 14px; height: 132px; display: flex; align-items: center; justify-content: center; margin-bottom: 14px; }
.illo { width: 118px; height: 118px; animation: floaty 5.5s ease-in-out infinite; }
.illo-cloud { stroke: var(--pb-accent); stroke-width: 2.4; }
.illo-bolt { fill: var(--pb-accent); stroke: var(--pb-accent); stroke-width: 4; }
.illo-spark { fill: var(--pb-gold); }
.illo-mote { fill: #f04e42; opacity: .85; }
.illo-dot1 { fill: #f04e42; } .illo-dot2 { fill: var(--pb-gold); }
.card .eyebrow { font-size: 10.5px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: var(--pb-muted); }
.card .title { font-size: 21px; margin: 5px 0 6px; }
.card .support { font-size: 13px; font-weight: 500; color: var(--pb-muted); line-height: 1.5; }
.card .btn { width: 100%; margin-top: 14px; }
.card .note { margin-top: 10px; font-size: 11.5px; font-weight: 600; color: var(--pb-muted); text-align: center; }

/* Tile */
.tile { position: relative; aspect-ratio: 1; border-radius: 20px; background: var(--pb-solid); color: #fff; padding: 22px; display: flex; flex-direction: column; justify-content: space-between; overflow: hidden; box-shadow: 0 18px 40px -20px color-mix(in srgb, var(--pb-solid) 75%, transparent); }
.tile.is-enter { animation: pop .5s cubic-bezier(.22,.61,.36,1) both; }
.tile .wordmark { font-size: 18px; position: relative; }
.tile .big-bolt { position: absolute; right: -18px; top: 46px; width: 150px; height: 150px; color: rgba(255,255,255,.14); animation: floaty 5.5s ease-in-out infinite; }
.tile .ico-spark { position: absolute; right: 30px; top: 58px; width: 22px; height: 22px; color: var(--pb-gold); }
.tile .copy { position: relative; }
.tile .title { font-size: 31px; }
.tile .support { font-size: 13px; font-weight: 500; opacity: .86; margin-top: 8px; max-width: 24ch; }
.tile .actions { position: relative; display: flex; align-items: center; gap: 12px; }
.tile .link { color: rgba(255,255,255,.85); font-size: 12.5px; font-weight: 600; text-decoration: none; }
.tile .link:hover { text-decoration: underline; }

/* Sheet */
.root-sheet { width: min(460px, 100%); }
.sheet { width: 100%; background: var(--pb-surface); border: 1px solid var(--pb-border); border-radius: 24px; box-shadow: var(--pb-shadow-big); padding: 24px 26px 22px; }
.sheet.is-enter { animation: pop .35s cubic-bezier(.22,.61,.36,1) both; }
.sheet .brand { display: flex; align-items: center; gap: 7px; font-size: 15px; }
.sheet .brand .ico-bolt { width: 20px; height: 20px; color: var(--pb-accent); }
.sheet .title { font-size: 25px; margin: 14px 0 8px; }
.sheet .support { font-size: 14px; font-weight: 500; color: var(--pb-muted); line-height: 1.55; }
.sheet .support strong { color: var(--pb-text); }
.sheet .actions { display: flex; align-items: center; gap: 10px; margin-top: 18px; flex-wrap: wrap; }
.sheet .foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 16px; font-size: 12px; font-weight: 600; color: var(--pb-muted); flex-wrap: wrap; }
.sheet label { display: inline-flex; align-items: center; gap: 7px; cursor: pointer; }
.sheet input { accent-color: var(--pb-accent); margin: 0; }

@keyframes twinkle { 0%,100% { transform: scale(1) rotate(0); } 50% { transform: scale(.72) rotate(18deg); opacity: .75; } }
@keyframes breathe { 0%,100% { opacity: 1; } 50% { opacity: .5; } }
@keyframes floaty { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
@keyframes fade-up { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: translateY(0); } }
@keyframes drop { from { opacity: 0; transform: translateY(-100%); } to { opacity: 1; transform: translateY(0); } }
@keyframes slide { from { opacity: 0; transform: translateX(28px); } to { opacity: 1; transform: translateX(0); } }
@keyframes pop { from { opacity: 0; transform: scale(.96); } to { opacity: 1; transform: scale(1); } }
@keyframes backdrop { from { opacity: 0; } to { opacity: 1; } }
@keyframes crawl { from { width: 4%; } to { width: 86%; } }

/* Ambient loops off, entrances become a 150ms fade; the detected crossfade stays (it carries meaning). */
@media (prefers-reduced-motion: reduce) {
  .tw, .dot, .badge, .illo, .big-bolt, .race-slow { animation: none !important; }
  .race-slow { width: 60%; }
  .is-enter, :host([variant="sheet"].is-enter) { animation: backdrop .15s ease both !important; }
  .btn { transition: none; }
}
`;

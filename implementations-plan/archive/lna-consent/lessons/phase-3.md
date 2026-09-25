# Phase 3 — banner `connect` state

## What shipped

- `BannerState` gains `connect` (host-set, never from `stateFromStatus`); `BANNER_EVENTS.connect`;
  `PrimaryKind` `connect`; `STRINGS.connect` and `VARIANT_COPY.<variant>.connect` with the approved
  copy; `VARIANT_STATES` lists it on every surface (Tile is `any`).
- Each template renders a `<button data-action="connect">`. Secondary install links (Billboard, Card,
  Tile, Sheet foot) stay `data-action="cta"`, so they emit `presto-banner:cta` and follow `href`/`os`
  patches. `#patchCta` now patches every install link, and `sheetCtaLabel()` is the single source
  for the Sheet's platform label in both states.
- Pending: set before the event, patched in place (spinner + "Connecting…", `aria-disabled` +
  `aria-busy`), cleared by any repaint or by an equal-value `state` assignment (the
  `attributeChangedCallback` exception). Sheet focus lands on Connect.
- `permission-blocked` retail copy; demo `connect` option with a simulated answer; README tables,
  events and the `BANNER_STATES` note; the banners consumer fixture checks the state and the event
  in the packed dist; `1.2.0`.

## Gate

- `bun run test`: exit 0 (banners 33, others unchanged).
- Tarball consumer `presto-banners`: `TARBALL_CHECK_OK presto-banners` (rerun after the last style
  change).
- Screenshots (`$SCRATCH/banner-shots.ts` against `bun run --cwd packages/banners dev`): all six
  variants in `connect`, light and dark, desktop (1100px) and phone (400px), plus the pending Ribbon
  and the Sheet's morph. No page errors, no horizontal overflow, Sheet focus on Connect every time.
  Copy, controls and layout match the approved mockups. Differences by design: the Sheet names the
  detected OS (Linux in headless Chromium); the demo's Billboard is wider than the mockup's stage, so
  its three controls wrap one control later under the same rule.

## Notes

- Emit-order mutation check: moving the pending patch after the event fails "a host that answers
  inside its listener has the last word". The failure only shows when the host answers with the
  *same* state, which is why that test does exactly that.
- `aria-disabled`, not `disabled`: a disabled button drops focus, which in the modal Sheet would
  strand keyboard users. Clicks are ignored while pending instead.
- Mockup cascade quirk: the ELI5's `padding-left: 0` override for the narrow Billboard lost to the
  banner's own later rule, so the *approved* render kept the 64px indent. The component matches
  what was approved (indent kept, `flex-wrap` added), which is also how the `offline` Billboard
  looks at that width.
- Pre-existing Sheet bug found by the phone screenshots: `dialog.sheet { position: relative }` puts
  a top-layer dialog in absolute mode at the document origin, so opening the Sheet on a scrolled page
  jumped the page to the top (measured: scrollY 2500 → 21). Fixed with `position: fixed`, the UA
  default for modals (scrollY stays 2500, dialog in view; the detected overlay still covers it). It
  affected the `offline` Sheet too.
- Tooling: the Dock is `position: fixed`, so element screenshots of inline banners under it capture
  the Dock; shoot the Dock first, then clear its state.

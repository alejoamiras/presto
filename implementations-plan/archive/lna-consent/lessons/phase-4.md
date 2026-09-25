# Phase 4: landing detection removal

## What changed

- Deleted `packages/landing/src/presto-detection.ts` and its test; `main.ts` keeps only reveals, nav,
  the race and the download button.
- Removed both recovery panels, the `download-actions` id (only the detection toggled it), and the CSS
  used only by them: `.hero-sub.detected`, `.accel-dot`, the `.notice` block, `.btn-outline`,
  `.hidden`. `@keyframes breathe` stays (the prerelease dot uses it).
- Hero link: "Already installed? See it prove in the playground →". README states the no-contact rule.
- `lna.real.spec.ts`: the two landing tests became one test run with `prompt` and with `granted`.
  A page recorder (`page.on("request")`, installed before `goto`, ports 59833 and 59834, any host and
  path) must stay empty through `networkidle` plus 3 s, and the health server must count zero. The
  granted run then makes one annotated fetch and requires the recorder to hold exactly that URL, which
  proves the recorder can see a request to Presto at all.

## Gate

- `bun run --cwd packages/landing test && bun run --cwd packages/landing build`: exit 0 (4 tests).
- `bun run test`: exit 0. Tarball check: presto-core, presto, presto-noir, presto-banners all
  `TARBALL_CHECK_OK`.
- `bun run --cwd packages/playground test:e2e:lna -g landing`: 2 passed (prompt, granted).
- `rg -n "127.0.0.1|permissions.query|presto-detection" packages/landing/src packages/landing/index.html`:
  no matches.

## Notes

- Ports 5173, 5174 and 59833 are `strictPort` in the LNA config; checked `~/.agents/ports.md` and
  `ss -ltn` first. None were claimed.

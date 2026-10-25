# deps-1 phase 3: re-resolve the caret undici copies (#172)

- `bun update undici` (bun 1.4.2) on `main` at b85134c changed only `bun.lock`, in 8 lines, exactly
  the F7 trial: root and `npm/undici` 6.29.0 → 6.29.1, `webdriver/undici` 6.28.1 dropped, and
  `cheerio/undici` 7.29.1 → 7.30.1. `package.json` is untouched. Its summary line reads
  `undici 6.28.1 -> 7.30.1`, which is misleading; the diff is the record.
- The frozen install and a plain `bun install` afterwards both leave the lock unchanged.
- Gate, 2026-10-25: lint and `bun run test` exited 0. `bun audit` now lists GHSA-xjj6-f33q-929c only
  with its 7.x range, which is miniflare's exact 7.29.1. The bundle source still reports
  `undici` 6.29.0. The audit's BLOCKED keys equal `main`'s (happy-dom, undici, zod).

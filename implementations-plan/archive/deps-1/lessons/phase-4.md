# deps-1 phase 4: bump happy-dom (#172)

- Run 2026-10-27 at 18:28Z on `main` at c1d1f6f, past the age gate (F8). The same-day baseline audit
  on `main` showed `npm/high GHSA-834v-8h66-3h79 happy-dom` as its only BLOCKED key.
- Setting `@happy-dom/global-registrator` to `^21.0.4` in the playground and banners, then running
  `bun install`, changed `bun.lock` in 8 lines: the two workspace ranges, plus the registrator and
  `happy-dom` entries (20.12.0 → 21.0.4). Both entries keep the same dependency sets. No other
  package moved.
- Bun leaves the old `node_modules/.bun/*@20.12.0` directories in place, but both packages now link
  21.0.4. The audit reads the lock, so the stale directories do not affect it.
- Gate, 2026-10-27:
  - the frozen install left the lock unchanged;
  - playground `test:unit` passed (108 plus 3 skipped, then 10 script tests);
  - banners `test:unit` passed (33);
  - `bun run lint` and `bun run test` exited 0;
  - `bun run audit:dependencies` exited 0: 0 blocked, 12 accepted.
- The audit still prints the `braces` exception as STALE. The close-out drops it.

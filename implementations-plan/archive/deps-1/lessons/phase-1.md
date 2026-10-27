# deps-1 phase 1: wrangler 4.151.1, no sharp override (#106)

- `bun install` (bun 1.4.2) after the `package.json` edit installed 7 packages. The lock diff stayed
  inside wrangler's closure: `wrangler`, `miniflare`, `miniflare/undici`, `workerd` and
  `@cloudflare/workerd-*`, `@cloudflare/unenv-preset`, `esbuild` and `@esbuild/*`, the deduped
  `tsx/esbuild*`, and the `overrides.sharp` line. No re-dedupe drift.
- `wrangler types --check` failed until `bun run --cwd packages/release-feed types` regenerated
  `worker-configuration.d.ts` (+588/-44). It confirms the lessons.md line; its citation was wrong.
- The audit printed STALE for `undici` GHSA-rfgv-xxqx-mfg5 and GHSA-w293-vg96-wgc3, so both were
  removed. The `braces` STALE line predates this lane.
- Gate, 2026-10-25:
  - frozen install, lint, `bun run test`: 0;
  - landing, release-feed, testnet-rpc and playground dry-runs on wrangler 4.151.1: 0;
  - audit exit 1, with a `BLOCKED` set equal to the trunk baseline's (happy-dom, undici xjj6 ×2, zod);
  - no `sharp` line.

# Phase 4: Worker

## Shipped

- `packages/release-feed/src/index.ts` routes through a `Map` of exact path to KV key, so no
  prototype name can match and every other path is a 404 before KV is read. Headers, 405 and the
  `no-store` 503 are shared by both paths; the read-failure log names the key.
- Tests run every path on both hostnames, check that each reads only its own key (GET and HEAD), that
  trailing slashes and near-miss paths are 404 with no KV read, that POST is 405 on both, and that a
  missing key is a 503 even when the other key holds a value.

## Gate (2026-10-08)

- `bun run --cwd packages/release-feed typecheck` and `test` (6 pass);
  `bunx wrangler deploy --dry-run --config packages/release-feed/wrangler.jsonc`: bundles, deploys
  nothing.
- Mutation: mapping `/releases/verified-sites.json` to `latest.json` fails 3 tests. Reverted.

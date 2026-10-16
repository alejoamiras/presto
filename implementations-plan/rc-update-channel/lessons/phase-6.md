# Phase 6: feed Worker

- The plan's line references into `packages/release-feed/src/index.ts` predate the verified-sites
  route; the route table now has three entries.
- Both keys hold one grammar, `X.Y.Z(-rc.N)` with no leading zeros. `latest.json` must hold a stable,
  `latest-rc.json` a candidate. The RC route serves the candidate only when its `X.Y.Z` is above the
  stable's: a stable outranks every candidate of its own version, and the stable key can never hold a
  candidate, so the route never compares two `rc.N` numbers.
- The stable route now reads text instead of a stream, to parse `version`; the feed is a few KB.
- Refusals log `release feed refused` with the path and the reason, separately from KV read failures.

## Mutations (all red)

| Mutation | Result |
|---|---|
| no stable-route guard | red |
| compare versions as text | red |
| candidate wins a same-core tie | red |
| `latest-rc.json` may hold a stable | red |
| RC route skips the stable key's prerelease check | red |
| missing stable key serves the candidate | red |
| loose prerelease grammar | red |

Gate: `bun run --cwd packages/release-feed test` (14 pass), `typecheck`, `bun run test` exit 0.

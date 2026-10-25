# deps-1 phase 5: the owner's picks (#172)

- P4-01, Option A, recorded by the orchestrator on 2026-10-25. Two entries went into
  `scripts/dependency-audit-allowlist.json` verbatim from `OWNER-ASKS.md` Ask 1, after the last
  npm entry, both expiring 2026-11-30.
- The one `undici` entry accepts both copies: miniflare's (the lock) and the npm bundle's. Both print
  as `ACCEPTED until 2026-11-30`, the second with its source. That is the shared key Ask 1 described.
- Gate, 2026-10-25: lint and `bun run test` exited 0. The audit reads `1 blocked, 12 accepted`; the
  one BLOCKED line is `happy-dom` GHSA-834v-8h66-3h79, left for arc 3.

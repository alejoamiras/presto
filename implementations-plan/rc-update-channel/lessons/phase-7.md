# Phase 7: pipeline, smokes, contract tests

## 7.1 signer

- A prerelease signs `latest-rc.json` at schema `rc-v1` (`--channel rc`) and, beside the v1
  `smoke-latest.json`, an `rc-v1` `smoke-latest-rc.json` (`--smoke`). A stable signs `latest.json`
  v1 and the v1 smoke twin only.
- `release-signer-roundtrip.sh` proves each twin against every verify mode: an rc-v1 manifest passes
  `--channel rc` and `--smoke`, and `--channel stable` refuses it as `CandidateOffChannel`.

## 7.2 workflow

- One key per dispatch, derived from the version by `release-feed-keys.ts` (the Worker's grammar,
  pinned to its source by a test), never from an input. `check-put` runs before `attempted=true`,
  so a feed in the wrong key fails before any KV write.
- An RC promote verifies four `Candidate` platforms, reads and verifies the live stable, and refuses
  unless the candidate stands above it. A stable promote settles `latest-rc.json`: a candidate above
  the new stable stays, anything else (at or below it, unreadable) is deleted.
- `withdraw-rc` refuses while KV holds a different readable candidate and is a no-op when the key is
  absent; an unreadable key is withdrawn with a warning.
- wrangler 4.135.0: `kv key list --prefix` prints JSON only; `kv key get --remote` errors on a missing
  key, so list first; `kv key delete` has no prompt.
- The read-back moved into `.github/scripts/verify-live-feed.sh` so the three modes share one poll and
  one verify. After a withdraw both routes must serve the same bytes.
- `update-feed-health.yml` gains `probe-rc`; it is red until the Worker with the RC route is deployed.
- Two root tests (`cloudflare-deployment`, `presto-release-readiness`) pinned the old literal put and
  the two literal namespace references; the 7.2 commit landed without the root suite. Run
  `bun run test` from the repo root, not only the package's tests, before committing a workflow change.

## 7.3 smokes

- A prerelease N runs only `positive` and `negative` (both workflow validators and every script).
- The refusal leg seeds developer mode off on the stable channel and serves the rc-v1 twin on both
  routes. A channel N-1 logs `update refused on channel stable: CandidateOffChannel`; a pre-channel
  N-1 (1.2.0) logs `update-manifest verification failed`. The leg reads which one from the first
  check line (`channel=` present or not), so an N-1 that only fails its check proves nothing.
- Unix stdout may carry ANSI codes; `first_check_line` strips them with perl, since BSD sed has no
  `\x1b`.
- The barrier, copy-initiator and stall seeds keep the old config_version 1 seed; only the release
  modes change.
- A test pinning a Windows ordering matched `schtasks /Delete` inside Cleanup; anchor ordering pins on
  a unique comment.

## Mutations (all red)

| Mutation | Result |
|---|---|
| put without the key guard | red |
| stable promote keeps a candidate below it | red |
| withdraw ignores another candidate | red |
| RC promote skips the live-stable bound | red |
| an RC may bump the source | red |
| read-back drops the platform check | red |
| read-back without a deadline | red |
| signer emits a v1 production feed for a prerelease | red |
| signer drops the rc twin | red |
| refusal leg serves the v1 feed | red |
| refusal accepts any line | red |
| channel build expects the schema refusal | red |
| feed order ignores the channel | red |
| prerelease seeds the stable channel | red |
| macOS skips the refusal leg | red |
| Linux serves one feed | red |
| Windows runs the refusal leg after crash-recovery arming | red |
| Windows drops the read-only check | red |
| ephemeral build has no rc twin | red |

Gate: `bun run test` exit 0, `bun run lint`, `bun run lint:actions`, shellcheck v0.9.0 clean.

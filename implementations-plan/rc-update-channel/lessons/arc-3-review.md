# Arc 3 review (Codex, gpt-6.1-sol, high, read-only)

Branch `rc-update-channel-feed`, diff `df8d527..0f42f1b`. The host runs Codex's sandbox in its
approve-for-me mode. Round 1 found nothing in the Worker, the pipeline shell or the smokes.

## Round 1: fix (3)

1. **Medium: `withdraw-rc` cannot clear a malformed candidate key.** Verified. With
   `latest-rc.json` holding `{"version":"1.3.0"}`, `1.3.0-beta.1`, `1.3.0-rc.01` or a number,
   the pre-flight read it as another candidate and refused; the command it suggested fails
   `validate`, since `withdraw-rc` takes a candidate version.
   - Fix: refuse only when the held version is a candidate under the Worker's grammar
     (`release-feed-keys.ts key`); anything else is withdrawn with a warning. The runbook says so.
   - Test: the withdraw test adds a stable, a bad grammar, a leading zero, a number and bad JSON.
     Without the fix it is red.
2. **Medium: `withdraw-rc` ran an unlocked wrangler with the feed token.** Verified. The job set up
   Bun and called `bunx wrangler` with no install, so it fetched whatever npm served. `promote`
   installs through `setup-presto` and `release-auth-preflight` runs `bun install`; only the new job
   missed it.
   - Fix: `bun install --frozen-lockfile` before the first credentialed step.
   - Test: every job holding `CLOUDFLARE_RELEASE_FEED_API_TOKEN` installs the lockfile before its
     first step that holds the token. Red without the install, and red if `promote` opts out of it.
3. **Low: review provenance in a comment.** The `verify-live-feed` comment this arc rewrote began
   `blocker-1 (codex High)`. Removed; the rest of the file's older provenance tags are out of scope.

Gate: `bun run test` exit 0, `bun run lint:actions`.

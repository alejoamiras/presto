# Phase 0: planning consults

## Recon (Explore, Sonnet)

- Inventory of every registry call on the release path, the reuse map and the text-pinning tests
  are in `recon.md`.
- Two guards decide where a shared bounded helper can live:
  - `sdk-release-contract.test.ts:278-288` bans the string `registry-consistency` in consumers.
  - The credentialed-job `codeViolations` checks `run(` calls only in the file that defines `run`.

## Probe (Bun 1.4.2)

- `fetch(url, { signal: AbortSignal.timeout(300) })` rejects with `TimeoutError` after about
  300 ms for a server that never sends headers, and for one that sends headers and then stalls
  the body (`response.json()`).
- `Bun.spawnSync(["sleep", "5"], { timeout: 200 })` returns `exitedDueToTimeout: true` and
  `signalCode: SIGTERM`.

## Codex round 1 (gpt-6.1-sol, high, fresh session)

Verdict: conditional approve. All conditions were adopted (see `plan.md` Decisions):
- E404 on stderr only.
- Guard: canonical, unaliased leaf imports.
- Test the stalled body.
- Fix the grep gate that contradicted the kept rejection test.
- Narrow the PR title.
- The remainder becomes an open follow-up, not a closed known limit.

The host runs Codex in its `approve-for-me` sandbox mode (machine opt-in). The consult made no
file change.

## Final fresh Codex pass (gpt-6.1-sol, high, new session)

Verdict: conditional approve. All three conditions were adopted:
- Add `scripts/npm-command.ts` to `app.yml`'s `published` filter. Without it,
  `cloudflare-deployment.test.ts` would fail, because the filter must route every module that
  `published-playground.ts` reaches.
- Phase 1.7 no longer requires a direct leaf import from `release-plan.ts`.
- The resume invocation is explicit. The follow-up issue is filed before the PR.

Resumed verification: **approve**.

Lesson: a new module under `scripts/` that the production playground build reaches must join
`app.yml`'s `published` filter. `cloudflare-deployment.test.ts` enforces this by import graph.

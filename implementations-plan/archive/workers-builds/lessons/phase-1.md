# Phase 1 — Wrangler with Worker Previews

- **Rebased onto `b46898f` first.** The lna-consent release moved `main` and the published SDK
  (presto 5.2.0-revision.5, noir 1.2.0; revision.4 is an orphan from an interrupted run). Only
  `implementations-plan/index.md` conflicted; the pin values in `plan.md` were updated to match.
- **A comment in `wrangler.jsonc` breaks two tests** that `JSON.parse` the config. The reason for the
  empty `previews` block lives in the test assertion instead.
- **Wrangler 4.135 regenerates `packages/release-feed/worker-configuration.d.ts`.** Its `typecheck`
  runs `wrangler types --check`, which fails after any Wrangler bump until `bun run --cwd
  packages/release-feed types` is re-run and committed.
- **Interfaces the feed workflows depend on still hold**: the `version-upload` output record keeps
  `version: 1`, `worker_name`, `version_id` (`wrangler-dist/cli.js`); the `--help` checks listed in
  the gate pass; landing and feed `deploy --dry-run` exit 0.
- **Audit**: `cargo-audit` is not installed on this machine, so `bun run audit:dependencies` stops at
  the Rust half; Cargo is untouched here. The npm half, run through the same `evaluateFindings` and
  allowlist, reports 0 blocked, and the `sharp` exception went stale (wrangler now ships sharp
  0.35.4). It was removed, with the matching `follow-ups.md` entry updated. No new advisory comes
  through Wrangler.

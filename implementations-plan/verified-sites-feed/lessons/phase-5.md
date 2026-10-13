# Phase 5: workflows, contracts and docs

## Shipped (before O2)

- `sign-verified-sites.yml`: `prepare` (main only, refuses while an unmerged `chore/verified-sites-N`
  record branch exists, reads the live list, `check --publish`, writes the diff and the signing-path
  tripwire to the summary), `sign` (environment `verified-sites-signing`, sparse checkout, re-reads
  `main` and compares the list and every signing path byte for byte before the seed step, runs the
  signer from `$RUNNER_TEMP` under `bun --no-install --no-env-file --config=/dev/null`),
  `verify-signed` (CLI `document` + `verify` against the approved hash and version), `record`
  (`permissions: {}`, App token, create-only bot-push of the two record files, checks a branch left by
  an earlier attempt, auto-merging bot-pr).
- `publish-verified-sites.yml`: `verify` (newest record, compared with live: identical skips, ahead,
  equivocating or another key fails), `publish` (`release-feed` environment, `permissions: {}`,
  re-checks that `main` still holds the history tree and `key.pub` blob, runs the KV guard from
  `main`, writes by API with the token on a file descriptor), `verify-live` (follows any attempted
  write, even a failed one).
- `verified-sites-health.yml`: daily and on dispatch, secretless; fails when the list is missing
  while history exists, signed by another key, or behind for more than an hour after the record's
  commit.
- `.github/scripts/verified-sites-kv-guard.sh`: decides write, skip or refuse from the KV GET status
  and body; `scripts/verified-sites-kv-guard.test.ts` runs it on fixture envelopes.
- `packages/presto/scripts/verified-sites-roundtrip.sh` and the `verified-sites-feed` job in
  `presto.yml`: append-only history check, the repo test, the throwaway-key round trip (production
  signer, CLI and stock minisign), and the change against live in the summary.
- Contracts: `scripts/verified-sites-workflows.test.ts` (12), plus `cloudflare-deployment`,
  `bot-pr`, `ci-filter-contract` and the filters; CODEOWNERS.
- Docs: `RELEASE_RUNBOOK.md` (environment exception, publishing, stuck records, restore, rotation,
  emergency, the `key.pub` preflight), `SECURITY_MODEL.md` (boundary, decision 7, not-accepted line),
  `SECURITY.md`, `CLAUDE.md`.

## Gate (2026-10-08)

- `bun run lint:actions`: clean.
- The plan's contract set plus the guard, release-contract and integrator-docs tests: 99 pass.
- Shellcheck v0.9.0 on the guard and the round trip: clean. Biome on the changed tests: clean.
- Round trip run locally with RFC 8032 TEST 1 as the throwaway seed, TEST 2's public key standing in
  for `key.pub`, and minisign in a container: the signed list verifies with the CLI and with
  minisign, and each negative fails with its own message.
- Mutations: dropping `persist-credentials: false` from `sign` fails 1 test; adding `bun install`
  to `publish` fails 2. Reverted.

## Facts relied on

- Cloudflare KV values API: PUT with an `application/octet-stream` body answers
  `{"success": true, …}`; GET returns the raw bytes. The answer for a missing key is not documented,
  so the guard treats only HTTP 404 with error code 10009 as absent and refuses anything else.
- `bun --config /dev/null x.ts` and `bun -c /dev/null x.ts` exit 0 without running the script; only
  `--config=/dev/null` works. Every launch line uses the `=` form, and the contract test pins it.
- Biome's `noTemplateCurlyInString` fires on `${{` in plain strings; tests build workflow
  expressions with a small template helper instead.
- actionlint: the `runner` context is not available in job-level `env`, so `$RUNNER_TEMP` paths are
  built inside steps; a `sed` with backticks trips SC2016, so the summary uses `printf '\x60'`.

## Deviation

- One local round-trip run without `VERIFIED_SITES_ROUNDTRIP_SEED` generated a throwaway key with
  `openssl rand` on the workstation (the script's CI default), against D15's "no key on a
  workstation". The key had no authority (nothing pins it) and was deleted with the run's temp
  directory. Every later local run set the TEST 1 seed.

## After O2 (2026-10-13)

- The round trip against the real `key.pub` (TEST 1 seed, minisign in a container): accepted, and all
  six negatives refused for their own reasons, the production-key check now against the real key.
- The live check as CI runs it: `presto.build/releases/verified-sites.json` answers 404 (the Worker
  without the route is still deployed), so it compares against nothing and passes.

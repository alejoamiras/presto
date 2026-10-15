# Updater smoke from the live stable

Tier: light. Branch `worktree-updater-smoke-stable`.

## Problem

`release-presto.yml` smokes one update path per OS: the greatest complete, published, lower,
same-key release (prereleases included) → the candidate N. For 1.2.0 that is `1.2.0-rc.3 → 1.2.0`.
The path installed users take, live stable → N (today `1.1.3 → 1.2.0`), only runs on the first RC
of a line, when the two coincide. A regression that breaks only the stable → next update (an
updater, config or migration change made during the RC train) ships untested.

Goal: every publish run (RCs included) also smokes `live stable → N` on macOS (arm64, Intel), Linux
and Windows, deduped when it is the same release as the greatest lower one.

## Decisions

1. **"Current stable" is the release the live signed feed serves** (`plugins.updater.endpoints[0]`
   of `tauri.conf.json`, today `https://presto.build/releases/latest.json`), not the greatest
   published non-prerelease. B6 publishes stable with `--latest=false` and promotes separately, and
   a rollback promote points the feed at an older release while GitHub Latest stays on the newer GA.
   The greatest-published rule is wrong in both windows; the rollback case is the one that matters
   most (after rolling 1.2.0 back to 1.1.3, the fix-forward 1.2.1 must be smoked from 1.1.3).
   GitHub Latest has the same rollback blind spot. Evidence: the feed serves 1.1.3 today and its
   bytes hash to the `latest.json` asset digest of `presto-v1.1.3`
   (`sha256:f1afaf95…1c28`).
   - Binding: the feed body's SHA-256 must equal the API digest of the `latest.json` asset of
     `presto-v<feed.version>`. Promotion uploads exactly those bytes and the Worker streams the KV
     value verbatim, so any other body (stale garbage, a forged feed) fails closed. The release
     must be published, non-draft, non-prerelease (flag and version string), carry the complete
     installer set, use the current updater key, and be strictly below N.
   - Cost: publish now reads the public feed (read-only, no credential). The read retries 5 times
     with backoff, then fails the resolver job with the URL and last error. The workflow comment
     "publishing never depends on feed availability" becomes "publishing holds no Cloudflare
     credential"; owner should confirm the trade (see Owner decisions).
2. **Same key: confirmed, and a different-key live stable fails closed.** `tauri.conf.json` updater
   pubkeys hash identically at `presto-v1.1.3`, `presto-v1.2.0-rc.2` and `main`. If the live stable
   ever uses another key, every installed user is stranded on N: that is the defect this gate
   exists to catch, and the runbook already routes key rotation through a separately reviewed
   migration with no dispatch override. Skip-with-summary would let that release ship.
3. **Dedupe by tag in the resolver.** It emits `baselines`, a JSON array: the greatest lower
   release first, the live stable second only when its tag differs. The smoke jobs iterate it, so
   a shared baseline runs once.
4. **Cost.** Measured on the green `1.2.0-rc.2` run (38644905039): total 29.6 min; updater stage
   (signer done → draft created) 6.4 min, bounded by the Windows positive leg (6.3 min); macOS legs
   0.8–2.5 min, Linux 1.2–3.0 min. The `1.2.0-rc.1` run (37071663152), which used 1.1.3 as its
   baseline with today's harness, shows the same leg times (Windows 2.8–6.3 min). A distinct
   live stable adds 7 legs (3 macOS, 2 Linux, 2 Windows) in parallel; the five-concurrent macOS
   ceiling queues up to 3 short macOS legs for about a minute, still under the Windows bound.
   Projected: updater stage about 6.5–7.5 min, total about 30–31 min. Not measurable before merge
   (no dispatch from this branch).
5. **Matrix dimension, not new jobs.** Each of the four smoke callers gains
   `baseline: fromJSON(needs.resolve-updater-baseline.outputs.baselines)`. The reusable workflows
   and their typed inputs are untouched; `release.needs` and its explicit `== 'success'` checks are
   untouched, and a matrix job is `success` only when every leg is. The macOS caller's `include`
   list becomes a `leg` dimension, because `include` entries without a shared key would overwrite
   each other across the new dimension. Negative (tamper) legs run per baseline too: it keeps the
   matrix a plain cross product with no `exclude`, and it proves the binary users actually run
   refuses a tampered N.

## Security and adversarial considerations

- **Spoofed feed** (DNS, Cloudflare account, KV write): the body must be byte-identical to some
  published stable's own signed `latest.json`, so the attacker can at most choose which legitimate
  same-key stable gets smoked. Baseline installers still come from GitHub with digest checks;
  nothing about N changes. Any other body fails closed.
- **Silent skip**: the resolver throws on every failure; an empty matrix dimension fails job
  evaluation; `release` requires each smoke job's `success`. Residual: a compromised or stale
  serving layer can present an older legitimate stable's feed; if that is the greatest lower
  release, dedupe leaves one baseline and the release users actually get goes unsmoked. Digest
  binding authenticates bytes, not freshness.
- **Stale resolver output on a partial rerun**: a failed run resumed with "Re-run failed jobs"
  keeps the first attempt's baselines even if a promote or rollback moved the feed in between.
  `tag` re-reads the live feed before pushing and refuses unless its release is one of the smoked
  baselines; recovery is "Re-run all jobs" (the untagged draft is replaceable). `finalize` repeats
  the check for a rerun that starts there; the tag is pushed by then, so recovery is a new
  version.
- **Dedupe hiding the stable leg**: dedupe only drops an entry whose tag equals the first one.
- **Spurious block**: a feed outage blocks publish (deliberate, after 5 attempts with a 15 s
  per-attempt timeout). KV propagation takes 60 s or more and `verify-live-feed` proves one
  observation, not global propagation, so right after a promote a resolver may read the previous
  feed: it then smokes the previous legitimate stable, or (backport-only: N below the new stable
  but above the old) fails "not below N". Both errors name the served version and say to re-run
  after propagation. No semantic retry loop. A rollback to an older-key release blocks every
  publish until a reviewed migration: correct, those users cannot update.
- **Fetch boundary**: the feed read is its own credentialless `fetch` (no GitHub token), rejects
  redirects, times out per attempt, and requires a well-formed `sha256:` asset digest with no
  fallback.
- No new permission, secret, or credential; the resolver job stays `contents: read`.

## Test plan

- `resolve-updater-baseline.test.ts`: (a) live stable added as a second baseline and deduped when
  equal; (b) each fail-closed rule (not below N, no release, digest mismatch, draft, prerelease,
  incomplete, other key) throws its named reason; (c) the feed read retries, hashes the exact
  bytes, and fails closed when unreachable or versionless.
- `release-contract.test.ts`, on the parsed YAML: the resolver step passes the configured
  endpoint; the four smoke jobs' matrices are exactly `baseline × leg` (macOS: arm64 positive,
  Intel positive, arm64 negative), `baseline × mode` (Linux) and `baseline` (each Windows job),
  with no `include`/`exclude`, wired to `matrix.baseline.*`; 7 legs for one baseline, 14 for two;
  `tag` and `finalize` run the live-feed recheck, unconditionally, before their side effect. Must
  fail on the old YAML.
- Real-data, gated on `UPDATER_BASELINE_LIVE=1` + `GITHUB_TOKEN`: resolve the real feed against
  the real releases API and the HEAD pubkey.
- `bun run test`, `bun run lint`, `bun run lint:actions`. No shell script changes.

## Rollback

Revert the PR. The workflow returns to one baseline; no state, key, or published artifact changes.

## Owner decisions

- Publishing now depends on a public read of the live feed (fails closed on outage). Alternative:
  the greatest published stable, which needs no network read but tests the wrong baseline after a
  rollback or while a stable awaits promotion.

## Audit log

- **Plan audit, Codex gpt-6.1-sol high (session `01a140ec`): APPROVE-WITH-FIXES**, no blocker.
  Agreed on decisions 1 and 5. Four should-fix items, all taken: (1) partial-rerun staleness →
  `finalize` recheck; (2) freshness overstated → wording, residual accepted, error hints, no
  semantic retry; (3) text-only YAML assertions could miss a dropped leg → parsed-YAML exact
  matrices and leg totals; (4) unspecified fetch boundary → credentialless, no redirects, timeout,
  strict digest, plus a gated real-data test. Nit (replay + dedupe can hide the user baseline)
  recorded as a residual above.
- **Diff review round 1, same session: NEEDS-FIXES.** (1) Should-fix: the finalize recheck's
  "re-run all jobs" recovery cannot work, because the release job refuses to replace a draft
  whose tag is pushed. Fixed: the same check now also runs in `tag` before the push (recovery:
  re-run all jobs), and `finalize`'s failure says to dispatch a new version. (2) Nit: the contract
  test accepted `if:`/`continue-on-error` on the recheck. Fixed, mutation-checked.
- **Diff review round 2, same session: CLEAN.** No findings; GitHub runtime evaluation of the
  matrix and rechecks remains unexercised until the next release dispatch.

# Phase 10: PR 2 pre-PR gate and close-out

## Merging `main` after PR 1

- PR 1 landed as a squash (`34784d2`) whose tree equals `a68a5ec`, while this branch already held
  PR 1 up to `28b5d6f`. Against the real merge base (`3ebb19b`), git saw every PR 1 file as added
  on both sides, so `plan.md`, `pr-1-review.md` and the core `mod.rs` conflicted, along with two
  files PR 2 had edited.
- The resolution is this branch's tree plus `28b5d6f..a68a5ec`, the one commit PR 1 made after
  this branch forked: `plan.md`, `pre-pr.md` and `pr-1-review.md`. In practice: check out ours for
  every path that differs from `main`, then apply that commit's diff.
- Checked: `git diff origin/main` after the merge has the same file set and line counts as
  `git diff 28b5d6f HEAD` before it.
- **Lesson:** after a squash merge, merge back by applying the squashed branch's own tail, not by
  resolving conflicts hunk by hunk.

## Done

- **Spec cleanup** (`verified-sites.spec.ts`): the `after` hook closes the popup before awaiting
  the pending `/prove`. Closing denies it, so the request returns at once instead of at the server's
  60 s deadline. Proof: the tampered mutant now shows one failure (`1 failing`, 9.6 s) instead of
  two (the test, then an "after all" timeout).
- **Finding 2 stays as noted:** tauri-plugin-webdriver's `refresh()` returns before the reload, so
  the first `#origin` lookups hit the old document and log "stale element" errors until
  `waitForActivePopup` succeeds. That costs about 3 s per reload and is harmless.
- **The 2^53 − 1 fixture:** `list-max-wrong-key.json` and its `.minisig`, a valid list at
  `MAX_VERSION` signed by RFC 8032 TEST 2. It comes from `verified-sites-fixtures.ts`, the other 29
  fixtures are byte-identical, and 31 files are written in all.
  - The store test `a_forged_list_at_the_highest_version_never_becomes_the_floor` first proves the
    forgery verifies under TEST 2 at `MAX_VERSION`. It then checks that, as the cache, it is refused
    with `KeyMismatch` and that list 5 replaces it.
  - Mutations: trusting the cache unverified fails both forged tests. So does trusting it only
    inside the save, where the floor assertion catches it.
  - The list-5 wrong-key test stays.
- **Docs:**
  - `VERIFIED_SITES.md`'s "In the app" describes the built-in record, the fetch, acceptance,
    whole replacement, the cache and failure handling.
  - `PRIVACY.md` adds the list request (same cadence, plain `GET`, user agent `presto`, nothing about
    the user's sites) and the cache file. Its update cadence is now the real one (launch, then every
    6 h, sampled every 15 min) instead of 12 h, and the Worker paragraph covers both files.
  - `CLAUDE.md`:
    - the Presto bullet loses "the app still reads its compiled-in copy" and describes the fetch;
    - the CI bullet names the `PRESTO_E2E_` prefix, the release-bundle scan and the per-OS
      integration test;
    - the Testing bullet now reads 27 WebDriver tests in 9 specs, 84 Playwright UI tests (66 was
      stale on `main`), ~600 Rust tests (586 non-ignored on Linux, from `cargo test -- --list`)
      and ~900 TS tests (presto scripts 179);
    - the Hosting bullet mentions the app's fetch.
- **Codex loop:** two rounds, converged (`lessons/pr-2-review.md`). The material fix is that a
  save that cannot lock still judges the disk.

## Local gate (2026-10-13)

Without the stand-in:

- `bun run test` (lint, typecheck, every unit suite) and `bun run lint:actions`.
- Core `cargo test`: 394 + 5 pass, 4 ignored. Clippy and the core Windows
  check are clean in the new code; the one Windows warning is in `update_schedule/tests.rs`, already
  on `main`.
- Server: 13 pass.
- `test:e2e:ui`: 84 pass.
- Updater identity against `origin/main`: identical apart from the one line.
- `release-presto.yml` removes no line and adds one hunk.
- No local paths in the diff, no plan references in comments, and the private RPC URL grep is empty.

With the stand-in, for src-tauri:

- `cargo test`: lib 151, bin 12, `verified_sites_feed` 9 plus 1 ignored, the rest unchanged.
- clippy, with and without `webdriver`.
- The Windows cross-check: only the existing `autostart_heal` and `uninstall_ownership` warnings.
- `run-webdriver-local.sh`: 9 of 9 specs, 27 tests.

## On the real record (2026-10-13)

The stand-in was deleted first. Then `main` was merged at `14c4085`, which adds only
`history/1.json` and its `.minisig` (byte-equal to the source list).

- `the_built_in_is_the_newest_record_byte_for_byte` passes. Mutation: embedding the `.minisig`
  instead fails it.
- The core repo test (5) verifies record 1 under `key.pub`.
- `PRESTO_VERIFIED_SITES_LIVE=1` case 25 passes against the live list.
- `autostart-test.sh` (Docker) passes in 114 s.
- `run-webdriver-local.sh` passes 9 of 9 specs, 27 tests; the verified-sites spec takes 12.9 s.
- Spec mutants:
  - signing the tampered list validly fails at step 3 (`spec.ts:130`, one failure);
  - removing the popup refresh fails at step 2 (the reloaded badge is null, one failure).
- Build pair: the release build (3 min 24 s) passes `assert-no-test-hooks.sh`. The WebDriver
  build fails it, carrying all three names.
- `bun run lint:clippy`, `bun run test` and `bun run lint:actions` pass.

## CI, and the one fix it forced

- Presto 38480721422 at `7a8dde1` was green except Cert Trust (windows). Its
  `verified_sites_feed` "connection refused" case returned `Unreachable` as expected but took
  2.0168 s against a 1 s bound.
- **Windows takes about 2 s to refuse a loopback connect**, so the 2 s test feed timeout ended it.
  The bound for that case on Windows is now `0..FEED_TIMEOUT * 2` (`2e79326`). The drip and hang
  cases, and the outer deadline, still catch a missing timeout. Codex verified it (round 4).
- The other run IDs are in `pre-pr.md`.

## Close-out

- **Issues:** #94 (no expiry), #95 (the approval gap), #96 (Firefox), #97 (the O8 canary) and
  #98 (auth-flow's `afterEach`).
  - #99, a same-user symlink at `~/.presto`, was filed as a known limit and closed as not planned.
  - New labels: `verified-sites`, `owner-decision` and `known-limit`.
  - Searching existing issues first found nothing to dedupe against.
- **`lessons.md`:** three entries promoted: the lock read, the `bun --config` form, and Windows'
  slow refused connect. To pay for them:
  - the two npm registry entries merged into one;
  - the process-group teardown entry retired, since the always-loaded run-isolation rules state it.

  The file was 9.1 KB before, over its ~8 KiB budget, and is 9.4 KB after. Reaching 8 KiB means
  retiring curated entries from other plans, which is the owner's call.
- The plan moved to `archive/` and its index line to `archive/index.md`. It has no relative markdown
  links to repair; `lessons.md` already points at the archive paths.

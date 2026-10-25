---
plan: server-1
tier: light
driver: claude-code
claude_model: opus
codex_model: sol
code_review: off
explainer: off
eli5_mode: skipped (orchestrator-owned)
quality_bar: production
status: completed 2026-10-25 (PR #180)
worktree: .claude/worktrees/server-1
branch: worktree-server-1
base: main @ 80b562e
---

## Outcome

- **Date**: 2026-10-25. **Status**: completed; delivered in PR #180, awaiting merge.
- **Shipped**: `500 download_failed` names only the failed step through `versions::DownloadFailure`;
  every `500 prove_failed` body is fixed text (`ProveFailed(&'static str)`); the log records both
  errors with their source chain. Codes and statuses are unchanged.
- **Deviations**: none in behaviour. The test helper is `versions::unpack_error`, not a re-export.
- **Rejected**: "could not install" for `UnpackFailed` (the brief fixes the four phrases); widening
  the macOS CI `custom_bb` filter (I3).
- **Known limits**: none.
- **Open items**: none. The `verified_sites::store` lock flake seen during the gates is #141, which
  was already open; this lane added its second test there. The owner ask about a PRIVACY.md sentence
  is `OWNER-ASKS.md` #1.
- The `/goal` and `/loop` seeds below are retired.

# server-1: error bodies carry no local filesystem path

## Summary

A site that asks the presto to prove can get two 500 bodies whose `message` is an error's
`to_string()`. Both can name a path under the user's home (`recon.md`, both demonstrated):

- `download_failed`: tar's unpack error names the staging directory under `~/.presto/versions`.
- `prove_failed` on the official route: tempfile's error names the prove workspace. The custom
  route already sends fixed text.

**Invariant after this plan:** no client-facing error body carries a local filesystem path that the
presto derived. A body may still echo the caller's own input (`invalid_version`). The `error` code
and the status stay. The full detail, with its source chain, goes to the presto's `tracing` log.

**Scope map.** Issues: none (the PR closes nothing). Asks: none. Arc `a1` (one PR) = phases 1-3.

## UI impact

- Recorded decision: "none: no screen changes. The `code` and status are the contract and stay;
  only the human-readable `message` text changes." This plan changes only `message` text.
- `OWNER-ASKS.md` has one entry (a PRIVACY.md sentence), on a surface arc 1 does not touch.

## Outcome & Quality Bar

- **For whom**: a dApp developer who reads a failed body in the console, and the operator who reads
  the presto log.
- **Excellent**: (1) a `download_failed` body names the failed step (release not found, request
  failed, integrity check failed, could not unpack), never a path; (2) the log keeps the whole
  chain, including the OS reason that today's log line drops.
- **Good enough**: every `prove_failed` body reads `bb prove failed` (the custom route's text) or
  another fixed text; why bb failed is in the log only.

## Architecture & Implementation

**Download.** New `versions/download_error.rs`, re-exported from `versions/mod.rs`:
`pub enum DownloadFailure { ReleaseNotFound, RequestFailed, IntegrityCheckFailed, UnpackFailed }`
and `pub struct DownloadError { failure, error: Box<dyn Error + Send + Sync> }`, with
`failure()`. `Display` is the inner error's and `source()` is the inner `source()`, so a log of
the error prints each cause once. `From<reqwest::Error>` gives `RequestFailed`.
`DownloadFailure::for_status` maps 404 to `ReleaseNotFound` and any other status to
`RequestFailed`. `download_bb`, `expected_digest`, `download_tarball` and
`fetch_github_asset_digest` return `DownloadError`; every check and its order stay. Causes:

| Where it fails | Cause |
|---|---|
| Metadata status (`for_status`); tarball status (`for_status`) | 404 → `ReleaseNotFound`, else `RequestFailed` |
| The release lists no asset for this platform | `ReleaseNotFound` |
| The asset has no `sha256:` digest; the digest does not match | `IntegrityCheckFailed` |
| HTTP client build, reqwest send, JSON or chunk error; a compressed-size cap | `RequestFailed` |
| No home dir; any `install_version_dir` error (decompression cap, bad archive or entry type, no `bb`, chmod, codesign, marker, publish, lease contention) | `UnpackFailed` |

The JSON scan moves into a pure `asset_digest(&Value, asset) -> Result<String, DownloadError>`, so
"no asset" and "no digest" become two causes; `Ok(None)` goes away. `expected_digest` stops
re-formatting the lookup error into a string, so its source chain reaches the log. The post-fetch
tail of `download_bb` (digest compare, home dir, install) becomes
`install_verified(version, &bytes, &expected) -> Result<PathBuf, DownloadError>`, testable offline.

**Wire.** `ProveError::DownloadFailed { version, failure }` holds no error text. `prove_parts`
renders `Failed to download bb v{version}: <cause>` with the four phrases above; `version` is the
validated request header. `download_if_needed` maps through a new
`download_failed(version, &DownloadError) -> ProveError` that logs `version`, `failure` and
`error = e as &(dyn Error + 'static)`; the `fmt` layer prints that field's `error.sources=[…]`.

**Prove failures.** `ProveError::ProveFailed` takes `&'static str`, so no runtime text can reach
that body. (The type guarantee covers these two codes only. `PayloadTooLarge`, `InvalidRequest` and
`OriginDenied` still hold runtime text, which by trace is client input or fixed validation text.) `bb_failure` logs the error the same way and returns `ProveFailed("bb prove failed")` on
both routes; the custom route still records the full detail for Settings, and `Unavailable` still
gives `CustomBbUnavailable`. `log_prove_failure` keeps its timing line and drops the error text
that `bb_failure` now logs once. The three other `ProveFailed` sites already pass fixed strings.

**Alternatives not taken** (the marker-type option for prove failures is in the audit record).
- Classify the boxed error by its text: brittle; the failing line knows its cause.
- Treat a metadata 404 as `Ok(None)`: changes the lookup's contract and its log line.
- A network seam for `download_bb`: new surface; `install_verified` plus a gated real-data test
  cover the stages.

## Assumptions

**Facts**
1. The body is built only in `prove_parts` (`server.rs:698-703`); `detail` is set at
   `prove.rs:653-656`; admission bodies (`admission_parts`, `server.rs:610`) are fixed or hold the
   canonical origin; both listeners use `router_for_port` (`server.rs:397`;
   `src-tauri/src/server/tls.rs:31`).
2. tar 0.4.46 names the unpack destination (`entry.rs:683-690`); tempfile 3.27.0 names the
   workspace (`error.rs:10-13`). A scratch program printed both (`recon.md`).
3. Bare OS errors from `std::fs` name no path; tar and tempfile wrap theirs with one.
4. The SDK reads only the code for these 500s (`presto-client.ts:552`); no test or doc pins either
   message (`recon.md`).
5. `tracing-subscriber` 0.3.23 `fmt` prints an error field's sources (`fmt/format/mod.rs:1276`).
6. The version policy accepts any canonical semver without build metadata that is not on the
   revocation list (`version_policy.rs:294-315`), so an old release whose asset has no digest is
   reachable.
7. `bb.rs` logs bb's stderr, exit status and timeout (`bb.rs:663-694`); UltraHonk logs no
   workspace or output error (`server/ultra_honk.rs:382-395`).

**Inferences**
- I1: dropping the `GITHUB_TOKEN` hint from the body is safe: it stays in the log, a CI integrator
  reads the presto's stdout, and a browser user cannot set the variable.
- I2: upstream never publishes `v0.0.0-presto-unpublished.1`; the gated test depends on it.
- I3: macOS CI runs only the `custom_bb`-filtered core tests (`presto.yml:202-203`), so the new
  tests run on Linux and Windows. This arc changes no macOS-specific code, and the macOS lane still
  compiles the crate's tests.

**Asks**: none. The PRIVACY.md sentence is in `OWNER-ASKS.md`; this arc ships without it.

## Security & Adversarial Considerations

- **Threat model**: an approved origin (any origin under `--allow-all`) reads the 500 body to learn
  the OS username or folder layout. It cannot cause the I/O error; disk-full or a blocked
  `prove-tmp` do that on real machines. After the fix the body holds the code, the validated
  version and a fixed phrase.
- **No new input, credential, crypto or dependency.** The integrity check, the download budget and
  the cache logic do not change. Logs keep paths, as `PRIVACY.md` and `SUPPORT.md` already say.

## Phases

### Phase 1: `download_failed` carries a coarse cause ✓

Steps: add `download_error.rs`; migrate the four functions; add `asset_digest` and
`install_verified`; change `ProveError::DownloadFailed`, `prove_parts` and `download_if_needed`.
Files: `versions/{download_error,downloader,release_metadata,mod}.rs`, `server.rs`,
`server/prove.rs`. Tests:
- `server/prove.rs`: a table over the four causes. Each `DownloadError` wraps a real tar unpack
  error (`make_targz` into a missing directory; `extract_bb_from_tarball` re-exported under
  `#[cfg(test)]`). The body is 500, `download_failed`, the fixed phrase, and lacks the directory.
  Control: the error's `Display` holds the directory and its `source()` the OS reason. On `main`
  the body holds the directory.
- `release_metadata.rs`: `for_status` (404, 403, 429, 500) and `asset_digest` (no asset, no
  `sha256:` digest, a good digest) give the causes in the table.
- `downloader.rs`, `#[serial]` with `ScopedPrestoHome`: `install_verified` gives
  `IntegrityCheckFailed` for a wrong digest and `UnpackFailed` for a tarball with no `bb`.
- `downloader.rs`, `#[serial]`, gated on `PRESTO_DOWNLOAD_TEST` like `download_and_verify_bb`:
  `download_bb` for `0.0.0-presto-unpublished.1` gives `ReleaseNotFound`. It self-skips without
  the variable, so run it once with `PRESTO_DOWNLOAD_TEST=1` and its own test-name filter (the
  neighbouring `download_and_verify_bb` is not serial), and record that output in
  `lessons/phase-1.md`.

**Validation gate**: `cargo test --locked --manifest-path packages/presto/core/Cargo.toml` exits 0
and lists the new tests; `bun run lint:clippy`, `bun run lint` and `bun run test` exit 0 (the last
runs no Rust test). Clippy on `src-tauri` first needs `frontend:build` and the
`binaries/bb-<triple>` placeholders (`lessons.md`). Layers: lint, typecheck, unit.

### Phase 2: every `prove_failed` body is fixed text ✓

Steps: `ProveFailed(&'static str)`; the new `bb_failure`; `log_prove_failure` drops the error
text; fix the comment at `server/ultra_honk.rs:341`. Files: `server.rs`, `server/prove.rs`,
`server/ultra_honk.rs`. Test (`server/tests.rs`, outside the Unix-only custom-bb module): one child
process, as in `a_custom_route_workspace_failure_keeps_its_path_off_the_wire`; `prove-tmp` is a
file, `TMPDIR` is missing, and `BB_BINARY_PATH` names an existing file (on Unix, a script that
writes a marker if it runs). `/prove` and `/prove/ultra-honk`, with an approved origin, no
`x-aztec-version` and no custom pin, each answer 500, `prove_failed`, `bb prove failed`, with no
`no-tmp` in the body and no marker. Keep the parent's check that the child reports `1 passed`.
On `main` the Unix bodies hold the path; on Windows the workspace fails closed and only the fixed
body is checked.

**Validation gate**: Phase 1's gate with the new test passing, then
`cargo check --target x86_64-pc-windows-gnu --lib` from `packages/presto/src-tauri` exits 0 (it
needs the empty `bb-x86_64-pc-windows-gnu.exe` placeholder). Layers: lint, typecheck, unit,
Windows compile.

### Phase 3: docs ✓

Add one clause to `CLAUDE.md`'s Presto paragraph: error bodies carry no presto-derived path, and
`download_failed` names its cause. **Validation gate**: `bun run lint` exits 0.

## Delivery

One arc, one PR against `main`: `fix(presto): keep local paths out of prove error bodies`. Open it
only after the gates pass and the Codex loop converges. The body says what changed and why, the
validation run, and that it closes no issue. No e2e spec changes. No parallel lanes.

## Post-implementation

1. Codex audit (`run-codex.sh <prompt> <worktree> high read-only gpt-6.1-sol`) of the net diff from
   80b562e, with this plan, the adversarial ask and these two rules verbatim. Triage, fix, commit,
   log in `lessons/codex-loop.md`, then `resume-codex.sh` until a round has no new material
   finding. Stop and report after 3 rounds.
   - *"Report bugs and small, targeted improvements only. Do not propose speculative abstractions,
     extra configuration surface, new layers, or rewrites — the smallest change that fixes each real
     problem. If code works and is clear, leave it alone."*
   - *"Audit the comments for value per character. Flag any comment that narrates what the code
     visibly does, restates its line, references implementation plans / phases / reviews, or spends
     a paragraph where a sentence works — and flag places where a non-obvious invariant or
     constraint deserves a comment it doesn't have. Comments are permanent context every future
     reader, human or LLM, pays to re-read: they must be few, dense, and exact."*
2. Delivery: `gh pr create`, then `gh pr checks --watch`. The orchestrator merges.
3. Close-out as the PR's final commits. Merge `origin/main` first and read what changed in
   `lessons.md` and `archive/index.md`. Write `## Outcome` after the front matter (date, status,
   PR, `Known limits:`, `Open items:`, seeds retired). Promote general gotchas to `lessons.md` with
   a pruning pass. File open items in their homes (blueprint's table). Delete `STATUS.md`. `git mv implementations-plan/server-1
   implementations-plan/archive/server-1` in its own commit, and add one line to
   `archive/index.md`. Add no row to `implementations-plan/index.md`.
4. Teardown after the merge: `git fetch -q origin main && git cat-file -e
   FETCH_HEAD:implementations-plan/archive/server-1/plan.md`, then `agent-worktree done server-1
   --merged`. Report a refusal; never force.

## Audit record

Size: the plan is over light's 150-line target; the verbatim review rules, the cause table and this
record are most of the excess.

**Codex round 1** (`gpt-6.1-sol`, high): conditional approve. All five findings adopted.
1. Medium, plausible: a `WorkspaceError` marker misses other path-bearing texts (serde quotes a
   malformed bb output string, `bb/ultra_honk.rs:335-350`). Adopted: fixed text on both routes,
   and `ProveFailed(&'static str)` makes it structural.
2. Medium, demonstrated: `Ok(None)` also means "asset without digest", and the policy accepts old
   versions. Adopted: `asset_digest` splits it.
3. Medium, demonstrated: `expected_digest` flattens the lookup error into a string. Adopted.
4. Medium, demonstrated: `chonk_request()` carries the custom label, and a non-bundled version
   downloads first. Adopted: no version header, no pin, test outside the Unix-only module.
5. Low: the invariant overclaimed (bodies echo caller input). Adopted: reworded; `recon.md`'s temp
   paths normalized.

**Codex final fresh pass** (`gpt-6.1-sol`, high): conditional approve. Adopted: `#[serial]` and a
recorded run for the gated test; a never-published version; the size-cap and client-build rows;
the narrower type claim and the Fact 1 and 6 qualifiers; one wording fix. Rejected: running the new
tests on macOS by widening `presto.yml`'s `custom_bb` filter. That is a workflow change in a file
other lanes hold, and this arc has no macOS-specific code (I3). Resumed check: **approve**; Codex
accepted I3 and added only the filter note for the gated run.

Decisions: D-a, the first option for official-route bodies was the marker type (planner); Codex
argued for fixed text. Fixed text won: it enforces the boundary and reuses the custom route's
rule. D-b: typed causes, shared types in their own file. D-c: the token hint leaves the body.
D-d: the test set plus `install_verified` and the chain control.

**Post-implementation Codex loop** (`lessons/codex-loop.md`): round 1 found two Low issues (a
custom `Unavailable` skipped the new log line; two doc comments restated their code), both fixed
in 1fab632. Round 2 (resumed, after merging `origin/main`): clean. The same-family review (Opus)
repeated the first finding, asked for two comment fixes and the trim of a third (done in ead6e9e),
and proposed "could not install" for `UnpackFailed`. That was rejected: the lane brief fixes the
four phrases. Round 3 (resumed): clean.

**Deviations from the plan**: none in behaviour. The server test builds its path-bearing errors
with `versions::unpack_error` (a `#[cfg(test)]` helper next to `make_targz`), not a re-export of
`extract_bb_from_tarball`.

## Seeds (draft; none will be run)

- `/goal` Phases 1-3 marked ✓ in implementations-plan/server-1/plan.md, each gate reported passing;
  the Codex loop converged; the PR exists with the close-out commits; `bun run test` and
  `bun run lint` exit 0.
- `/loop 15m` Drive implementations-plan/server-1 forward per its Post-implementation section.

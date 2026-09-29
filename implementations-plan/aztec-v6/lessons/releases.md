# Releases

## R1: app 1.1.3

Source version `1.1.3-rc.1`.

| Step | Dispatch | Run | Commit | Result |
|---|---|---|---|---|
| 1. publish | `mode=publish version=1.1.3` | 36473290807 | `aebe62a` (arc 1, #70) | failed at Create Git Tag; every gate had passed |
| 1. publish, retry | `mode=publish version=1.1.3` | 36478101239 | `a25100b` (arc 2, #71) | success; `presto-v1.1.3` published, 17 assets, tag at `a25100b` |
| 2. promote dry run | `mode=promote-only version=1.1.3 dry_run=true` | 36481355600 | `a25100b` | success: "promote pre-flight for 1.1.3 passed; the KV feed was NOT flipped" |
| 3. promote | `mode=promote-only version=1.1.3 bump_source=true` | 36481669428 | `a25100b` | success: feed flip, `verify-live-feed`, Latest, bump source (#72 → `1.1.4-rc.1`, auto-merge on) |

Independent check: `https://presto.build/releases/latest.json` serves `version: 1.1.3` for darwin-aarch64,
darwin-x86_64, linux-x86_64 and windows-x86_64, and `gh release view` names `presto-v1.1.3` Latest.
Rollback lever: `promote-only 1.1.2`.

### Attempt 1: the tag push was rejected

The run passed every gate: 32 jobs, covering the builds, smokes, WebDriver release E2E and packaged
E2E on the draft (macOS, and Linux over HTTP and HTTPS). It then failed at `Create and push tag`:

```
! [remote rejected] presto-v1.1.3 -> presto-v1.1.3 (refusing to allow a GitHub App to create or
update workflow `.github/workflows/_aztec-update.yml` without `workflows` permission)
```

Cause: #71 merged mid-run, so `main` moved to `a25100b`, which changes `_aztec-update.yml` and three
other workflows.
- When a new ref is created, GitHub compares it with the default branch. A tag at the run's
  `github.sha` (`aebe62a`) therefore "updates" workflow files, and `GITHUB_TOKEN` has no `workflows`
  permission.
- A rerun of the failed jobs would retry the same SHA, so the fix is a fresh dispatch from `main`.
  The release step replaces the stale unpublished draft by design.
- No tag was created. Nothing was published, signed into the feed or promoted.

**Rule:** merge nothing that touches `.github/workflows/` into `main` while a `release-presto`
publish run is between checkout and `Create Git Tag`.

### The source-bump PR (#72)

#72 auto-merged as `4ecb68c`. Every required check passed, but both Workers Builds previews on its bot
branch failed instantly, before any build step ran.
- The branch name is not the cause: throwaway branches `ci-probe-plain` and `ci-probe-1.1.4-rc.1` both
  built green, with Cloudflare sanitizing the dots to `ci-probe-1-1-4-rc-1`.
- The site builds read none of #72's files.
- The PR head was an unsigned commit by `github-actions[bot]`, pushed by the release-bot App.
- The production builds of the bot-authored, verified merge commit on `main` both passed (landing and
  playground). So a bot merge does deploy, which R2's pin PR relies on.
- The preview failure is unexplained without Cloudflare's build log, which only the dashboard shows.

## R2: SDKs

Arc 3 (#73) merged as `bc3eeee`. Every run below dispatched from `main`.

| Step | Dispatch or event | Run / PR | Commit | Result |
|---|---|---|---|---|
| 1. dry run | `release-sdk packages=all dry_run=true` | 36515098849 | `bc3eeee` | success. Plan: core 1.2.1, presto 6.0.0-rc.1 and noir 2.0.0-rc.1 publish; banners 1.2.0 reused. |
| 2. release | `release-sdk packages=all` | 36515244215 | `bc3eeee` | success. Every gate passed (SDK e2e, audit, noir identity, live and tarball), then core → noir → presto were packed, consumed, published to `testnet` and verified. `bump-playground` opened the pin PR. |
| 3. pin PR | bot PR, auto-merge | #74 | `07bc6c8` | The release bot's auto-merge fired at 03:23:44Z after 26 checks passed: the first `bump-playground` pin PR to auto-merge (#72 was the first bot PR to). |
| 4. deploy | Workers Builds on `main` | check runs on `07bc6c8` | `07bc6c8` | `presto-playground` and `presto-landing` both succeeded. |
| 5. smoke | `smoke-playground.yml` (default: the forwarder) | 36517162965 | `07bc6c8` | success: 3 passed, 1 skipped (the native Noir test, by design). |

`npm view` after the release:
- `@alejoamiras/presto`: `latest` 5.2.0-revision.5, `testnet` 6.0.0-rc.1.
- `@alejoamiras/presto-noir`: `latest` 1.2.0, `testnet` 2.0.0-rc.1.
- `@alejoamiras/presto-core`: `latest` 1.2.0, `testnet` 1.2.1.

The live bundle at `playground.presto.build` contains the forwarder URL and 6.0.0-rc.1, and no v5 RPC.

### Step 7: a native v6 proof on the live site with Presto 1.1.3

The released 1.1.3 `presto-server` ran with a sanitized env, a private home, a cold cache and
`ALLOWED_ORIGINS=https://playground.presto.build`. It served the demo smoke against the live site.

- **Attempt 1 fell back to WASM.** The server's anonymous release-metadata call got 403: this host's
  shared address had used all 60 anonymous GitHub API calls for the hour (`core` remaining 0 until
  04:00:51Z). The digest-first check refused the download, so the page proved in the browser, and
  `expectNativeProof` failed as it should. Handing the server a token outside a keyed run was ruled
  out, so the run waited for the reset.
- **Attempt 2 passed** at 04:01Z, after the quota reset (60 remaining), with a fresh server and a cold
  cache:
  - The released 1.1.3 downloaded v6 `bb` from `AztecProtocol/barretenberg` (9,320,781 bytes,
    digest `a03fae96…7b0e` verified), cached it, and logged "Proving succeeded" for the live
    playground's `x-aztec-version: 6.0.0-rc.1` request.
  - The Accelerated deploy passed `expectNativeProof`, and the Local deploy passed: 2 of 2 against
    `https://playground.presto.build`.
  - Teardown: the server's process group was killed, the port was released, and the throwaway
    Playwright config, `test-results/` and the server's home were deleted.

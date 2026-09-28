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

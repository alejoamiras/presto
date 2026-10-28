# Codex fix loop

## Arc a1 (gpt-6.1-sol, high)

- Session `01a17108-93dd-79e2-8acf-0c8a9767f48c`. Diff: `git diff 80b562e..HEAD -- . ':!implementations-plan'`.
- Round 1: `clean`. Codex traced every branch of `#classifyHttpError`: only `500 download_failed`
  changes. It also traced the HTTP retry path, the bounded error bodies and the tests that tell
  old from new.
- Opus diff review (alongside round 1): `findings: 1`. The core README had filed `500 prove_failed`
  under "capacity", but it means a failed or timed-out `bb` run (`packages/presto/README.md:85-87`).
  Verified and fixed in `a1054ff`.
- Round 2 (resumed, the fix diff): `clean`. Converged.

## Arc a2 (gpt-6.1-sol, high)

- Session `01a17eff-00eb-75c1-80b3-71b315c04c70`. Diff: `git diff origin/main...HEAD -- . ':!implementations-plan'`.
- Round 1: `clean`. Codex ran the release planner on this tree with live npm versions:
  core 1.3.0, noir 2.1.0, presto 6.0.0-revision.1 and banners 1.2.1 all plan as publish. No
  candidate version collides with npm, a tag or a release.
- Opus diff review (alongside round 1): the a2 diff is clean. It confirmed banners 1.2.0 → 1.2.1 by
  running `release-plan.ts` before #189 (unchanged) and after it (changed), and confirmed `all` plans
  cleanly. One pre-existing finding: noir's tested-pairs row `2.0.0-rc.3` names a version that was
  never published. npm returns E404 for it, and there is no tag or release; the manifest held it
  only on the unmerged `aztec-rc4` branch. Removed in `135761e` (D20).

## Cross-arc pass (fresh session `01a17f01-5e01-7300-9d58-7b930e43c12f`)

- Input: #178's merged code and doc diff, plus a2's diff.
- Round 1: `findings: 1`. After #180 the server sends fixed step text, so the classifier comment's
  claim that `message` "is the presto's whole error chain" was stale. D4 stands, because apps
  released before #180 still send the old chain. Fixed in `65e624f` (D21).
- Round 2 (resumed, both fixes): `clean`. Converged.

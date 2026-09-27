# Phase 4 — Docs

- **Historical records keep the retired names on purpose.** `docs/PRESTO_LAUNCH_TODO.md`,
  `docs/PRESTO_LAUNCH_STATUS.md` and `audit/**` describe runs that happened (`playground-only`
  recoveries, the old preview workflow); rewriting them would falsify the record. The sweep excludes
  them; every living doc (runbook, Cloudflare doc, READMEs, `CLAUDE.md`) is clean.
- **`CLOUDFLARE_DEPLOYMENT.md` now carries the dashboard table**, the custom build token, the
  account-wide boundary, previews, and the rollback rule; the runbook's token table points at it,
  and its new "Deploying the playground: the pin PR" section holds recovery and the fail-closed
  window after an Aztec or core bump.
- **`follow-ups.md` shares lines with open PR #60** (lna-consent archive), which deletes the
  "Run a `packages: all` release" entry. That entry is left to #60; this branch edits other entries
  only, so the two merge line-by-line. Re-read both after whichever lands second.
- Test counts: root scripts 198 → 215 (`test:scripts`), total ~710 → ~730.

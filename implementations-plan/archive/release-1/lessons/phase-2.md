# Phase 2: dead rollback allowance (#133)

- Removed `LEGACY_SDK_RELEASE_WORKFLOW` and `allowedWorkflows` from `verifyProvenanceStatement`,
  `fetchAndVerifySdkProvenance`, `verifyRegistryConsistency`, `verifySdkPackageSignatures` and
  `SignedProvenanceOptions`. The check is now `workflow.path !== SDK_RELEASE_WORKFLOW`.
- The positional `undefined` slot went from every caller and test. tsc would catch a missed one,
  because the parameter types differ (string vs `readonly string[]` vs `NpmPackage`).
- The first scripted edit aborted: the import line `LEGACY_SDK_RELEASE_WORKFLOW,` also appeared in
  the legacy test body. The rerun replaced the test first, and nothing was half-applied.
- Gate: focused tests 81 pass and 1 skip (the existing `PRESTO_LIVE_PROVENANCE` suite). `bun run test`
  exited 0, and both greps printed nothing.

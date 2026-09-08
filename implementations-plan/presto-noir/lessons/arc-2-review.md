# Arc 2 — codex fix loop

Codex session `01a07f2f-1edc-7d70-8f5a-9fc4562551c4` (GPT-6 Astra, `high`, read-only), over
`git diff 4ec2c61..0e34127` with the arc map, the adversarial ask, and the two standing rules.

## Round 1 — 2026-09-08

Verdict "request changes": one blocker, four highs, three mediums, two lows, comment nits. All
verified (codex reproduced the blocker and the planning counterexamples) and all accepted.

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | Blocker | `prepare-sdk-publish.ts` CLI took the manifest path from the first positional when `$VERSION` was set, so the reusable's exact invocation (`VERSION` env + positional version + `package.json`) opened a file named after the version | `parseCliArgs`: the path is always the second positional; unit test of the parser plus a spawned CLI regression with the workflow's exact invocation |
| 2 | High | An unselected `workspace:` dependency only had to exist on npm; its release verification and unchanged-since-tag facts were ignored | `resolveDependency` applies `requireReusable` (verified release, unchanged build inputs) to unselected dependencies too; test |
| 3 | High | Reuse trusted field-checked provenance without npm's cryptographic signature audit, and a run that tagged but never created its GitHub release counted as complete | `releaseFacts` requires provenance bound to the tag commit, `verifySdkPackageSignatures`, and an existing GitHub release |
| 4 | High | Preflight missed a leftover tag/release for a not-yet-published candidate; the reusable recomputed its version instead of consuming the plan | `recordsExist` fact → collision before any publish; `_publish-npm.yml` takes the planned `version` input and refuses to publish anything else; test |
| 5 | High | `mode=playground-only` could still publish core and noir | Both jobs carry the `inputs.mode != 'playground-only'` guard; contract test asserts it on every publish job |
| 6 | Medium | A reused adapter could be reported with a dependency version its immutable artifact does not carry, and deferred checks were listed for a job that never runs | `publishedDependencies` fact; `requireSamePins` makes a pin mismatch a collision; deferred checks only for entries that publish; test |
| 7 | Medium | `host-dependencies.json` could replace the tarball entry with a registry version | `scripts/tarball-consumer/host-manifest.ts` writes the tarball entry last and rejects an extra naming the tested package; unit test |
| 8 | Medium | Supplied workspace pins only had to be truthy (`latest`, ranges, URLs passed) | `EXACT_SEMVER` (now in `npm-packages.ts`) validates every pin; candidate versions are validated in the plan |
| 9 | Low | The collision step turned every `npm view` failure into "absent" | Only an identified E404 counts as absence |
| 10 | Low | `${DRY_RUN:+…}` labelled real releases as dry runs | Explicit `= "true"` comparison |
| 11 | Nit | Ledger IDs and audit history in comments; reviewer references in the consumer script | Trimmed; the profile-extras invariant is stated once |

Codex's moderate-confidence concern — package-directory-only equality may miss shared build
inputs — is taken: `changedSinceTag` now covers the package directory plus `bun.lock` and the root
`tsconfig.json`; arcs 3–4 add anything else their builds read.

Commit 906db58. `sdk.yml` run 34186307541 on it: green (tarball consumer included).

## Round 2 — 2026-09-08 (`response-1.md`)

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | Blocker | The plan job ran `gh release view` without a token (reproduced: exit 4) | `GH_TOKEN: ${{ github.token }}` on the planning step, read-only; contract test |
| 2 | High | Reuse runs npm's signature audit, which needs npm ≥ 11, but the plan job installed only Bun | The plan job gets the same pinned `setup-node` (24.20.0) as publishing and deployment; contract test |
| 3 | Medium | `isValidVersion` accepted `1.0.0-alpha..x`, `01.0.0`, `1.0.0-01` | `EXACT_SEMVER` AND the mode pattern; planner test over malformed candidates |
| 4 | Medium | Published pins were read from `dependencies` only, so a peer-only sibling pin forced a bump on reuse | `publishedPins` merges `dependencies`, `peerDependencies`, `optionalDependencies` (inconsistent pins throw); peer-only reuse test |
| 5 | Low | `test:scripts` excluded `scripts/tarball-consumer/*.test.ts` | Glob extended (157 tests) |

Commit 3498895.

## Round 3 — 2026-09-08 (`response-2.md`) — converged

> **Approve arc 2 at `3498895`. Confidence: high.** No material findings remain. … The review loop
> can close; the newly dispatched CI run remains pending verification.

Three rounds. `sdk.yml` run 34186590063 on 3498895 is the arc's final CI evidence: green (Lint,
Typecheck, Unit Tests, Tarball Consumer, SDK E2E).

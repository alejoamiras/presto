# Final cross-arc integration pass — codex fix loop

Fresh codex session `01a07fd2-1bb5-7801-8d65-74da783d6b88` (GPT-6 Astra, `high`, read-only) over
the net diff `git diff 667da60..4c1ef76` (196 files) with the five-arc map, the seam list (wire
contract, `/health`, version lockstep, release DAG + CI filters, duplication, plan drift, docs
drift), the adversarial ask, and the two standing rules. The plan names `ae1cb9c` as the base; the
plan was re-indexed onto `667da60` (= `git merge-base main HEAD`) after the presto-cleanup stack
merged, so that is the net diff.

**Where the fixes land.** Every cross-arc fix is committed on the top branch
(`presto-noir/playground-docs`) rather than on the arc that owns the file: the stack has not been
submitted, `gh stack sync` would have to rebase up to four signed branches per fix with likely
conflicts in files later arcs also touched (`release-plan.ts`, `release-sdk.yml`), and the merged
result is identical. The PR bodies of the lower arcs say so.

## Round 1 — 2026-09-08

No blocker or high. Four mediums, one low, comment nits, one suspect. All verified against the
code; all accepted except the suspect, argued below.

| # | Severity | Seam | Finding | Fix |
|---|---|---|---|---|
| 1 | Medium | release plan (arc 2) | `changedSinceTag` diffed the whole `bun.lock`, so any other workspace's dependency move marked a published core "changed" and an adapter-only release failed until core was bumped — contradicting the runbook's independent versioning | `lockfileSlice(lockText, dir)`: the workspace's own entry, the resolutions of its runtime dependencies (hoisted and nested keys), and `typescript`; compared between the tag and HEAD. `bun.lock` left `SHARED_BUILD_INPUTS`. Unit tests: unrelated workspace and own dev-dep moves are ignored; runtime dep, nested resolution, and compiler moves are not; trailing commas parse |
| 2 | Medium | published-playground (arcs 4–5) | `assertPeerPin` read the bb.js beside the swapped adapter, but Vite's `resolve.dedupe` bundles the copy resolved from the playground root; the two can differ | `packageRoot(name, from)` resolves like the bundler (from the playground root); test against the real tree |
| 3 | Medium | release DAG (arcs 2, 4) | `deploy-app` required `publish-presto` success, so `packages=presto-noir mode=sdk-and-playground` published noir and silently skipped the deployment the plan promises (published noir + current published presto) | `deploy-app` needs all three publish jobs; each must have succeeded or been skipped while unselected; `PUBLISHED_VERSION` falls back to the plan's `version_presto` (reuse) and, when empty, `published-playground.ts` resolves the SDK from `testnet` as it already did for `playground-only`. Contract test; runbook sentence |
| 4 | Medium | version lockstep (arcs 3–5) | `update-aztec-version.ts` moved the three manifests but not `scripts/tarball-consumer/presto-noir/host-dependencies.json`, so after a bump the consumer host installed the old peer (caught by CI, not silent) | `HOST_DEPENDENCY_FILES` + `updateHostDependencies` sharing `bumpPins`; tests: the flat file bumps like a section, and the committed host pin equals the adapter's peer pin |
| 5 | Low | docs (arcs 4–5) | The README's regeneration command only verifies | `--regenerate` added, with the verify-only default stated |
| 6 | Nit | comments (arcs 1–3) | `bb-version.ts` phase label; `npm-packages.ts` migration history; `presto-client.ts` "the old code"; `prove.rs` audit label + paragraph | Trimmed to the invariants |

**Suspect, not changed — response caps.** The Rust side accepts up to 64 MiB of proof output plus
4 MiB of public inputs/key; the adapter inherits core's 8 MiB JSON cap. A real UltraHonk proof is
tens of KB for any target (the fixtures are ~16 KB + 64 B), so the 8 MiB client cap carries >100×
headroom and the Rust ceiling is a defensive bound on bb's output, not a contract. Codex did not
show a supported circuit producing a larger response; raising the browser cap to the server's
ceiling would only enlarge what a malicious presto can make a page allocate.

Gates after the fixes: touched script tests 37/37, `bun run lint:actions` ✓, `cargo fmt --check`
(core) ✓, `bun run test` exit 0.

Commit a9eb0c2. `sdk.yml package=presto-core` dispatch 34198442747 on it: green (Lint, Typecheck,
Unit Tests incl. the root script tests, Tarball Consumer).

## Round 2 — 2026-09-08 (`response-1.md`)

Four of six fixes accepted (peer resolution, host pin, fixture command, comments; the response-cap
argument accepted: "not a convergence blocker"). Two new findings, both verified.

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | Medium | The round-1 `PUBLISHED_VERSION` fallback to the plan's `version_presto` handed a `playground-only` run the NEXT presto publication (e.g. `5.2.0-revision.1`), which does not exist; provenance lookup fails and the deployment stops | Fallback removed: only the version `publish-presto` produced in this run is passed, empty otherwise (the SDK on `testnet`). `presto` is aztec-derived and always publishes when selected, so the plan's version is never a published one. Contract test pins the expression and the absence of the plan output; comment in the workflow. A "behavioural" mode test was not added — every workflow test in the repo is a string contract and there is no expression evaluator |
| 2 | Medium | `lockfileSlice` included the `typescript` wrapper but not the platform package that carries the compiler binary (`@typescript/typescript-linux-x64`), whose integrity can move under an unchanged wrapper | `include()` follows one level of `optionalDependencies`; test changes the platform entry's integrity alone |

Gates: `release-plan.test.ts` + `sdk-release-contract.test.ts` 19/19, `bun run lint:actions` ✓,
`bun run test` exit 0.

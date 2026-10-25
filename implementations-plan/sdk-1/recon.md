# sdk-1 recon (base `main` @ 80b562e, 2026-10-25)

One Explore sweep (Sonnet) over seven capabilities, then the driver re-read every load-bearing line.
Searches ran over `git ls-files`, minus `implementations-plan/archive/` and the historical `audit/`.

## Reuse map

| Capability needed | Existing code | Verdict |
|---|---|---|
| Fallback reason type | `FallbackReason` union, `packages/sdk-core/src/lib/types.ts:201-223`; `ProveOutcome.reason` at :236 | adapt: add one member, fix the `transient` TSDoc ("known `500`s") |
| HTTP error classification | `#classifyHttpError`, `packages/sdk-core/src/lib/presto-client.ts:520-559`; the degrade block is :545-555 | adapt: split `500 download_failed` out before the `transient` block |
| `fallback()` helper | `presto-client.ts:65-67`, typed from `ProveOutcome["reason"]` | reuse as is |
| Server code recovery | `parseServerError` (text/plain JSON string body) | reuse as is |
| Aztec SDK carry-through | `packages/sdk/src/lib/presto-prover.ts:211-224` logs `` `Local proof completed (presto: ${outcome.reason})` `` | reuse as is: the new value is logged with no change |
| Noir carry-through | `presto-ultra-honk-backend.ts:214-219` → `PrestoUnavailableError(reason, phase)` (`sdk-noir/src/lib/errors.ts:9-20`) | reuse as is: the union flows through typed |
| Classifier test table | `presto-client.test.ts:330-336` (`[name, status, code, reason, phase, notPhase]`) | adapt: row :335 expects `download-failed`; row :336 (`prove_failed`) stays `transient` |
| Noir fallback table | `presto-ultra-honk-backend.test.ts:175-222` (`[name, routes, reason, phase]`, asserts WASM by default and `error.reason` under `"none"`) | adapt: add one `500 download_failed` row (none exists) |
| Reason docs | `packages/sdk-noir/README.md:113-124` (the only full reason table; `transient` row at :121); `packages/sdk-core/README.md:58-64` (a prose list of the conditions, which omits both `500`s; the sweep missed it); `packages/sdk/README.md:358`; `packages/sdk/.claude/skills/presto/SKILL.md:325-329` | adapt |
| Version bump flow | `scripts/release-plan.ts:95-124` (`decide`, `requireReusable`), :178-207 (`resolveDependency`, `requireSamePins`), :377-392 (`changedSinceTag` = any diff under the package dir, `tsconfig.json`, or its `bun.lock` slice) | reuse as is; plan the bumps around it |
| Workspace versions in the lock | `bun.lock:122-124` records `packages/sdk-core` `"version": "1.2.1"`, :133-135 `packages/sdk-noir` `"2.0.0"` | adapt: the two version lines only |
| Published playground gate | `scripts/published-playground.ts:137-160` compares the published adapters' core pin with `packages/sdk-core/package.json`; runs only on a `main` Workers Build (`scripts/workers-build.ts:26-31`) | reuse as is; the window is documented (`docs/RELEASE_RUNBOOK.md:405-410`) |

## Absences, with search trail

- **No exhaustive consumer of the union.** No `switch`, `never` check, or `Record<FallbackReason, …>` exists.
  - Searched `FallbackReason`, `ProveOutcome`, `PrestoUnavailableError`, `"transient"` and `transient` over
    `packages/{sdk,sdk-noir,banners,playground,landing}` and `scripts/`.
  - The only hits are the barrels (`sdk-core/src/index.ts:9`, `sdk-noir/src/index.ts:2`), the two adapters above,
    and `scripts/tarball-consumer/presto-noir/*`, which name the class only.
- **Banners and playground never read a reason.** `stateFromStatus` reads `PrestoStatus` only. Same search as above.
- **No other doc lists the reasons.** Beyond the prose list at :58-64, the sdk-core README (:51, :106) names
  `FallbackReason` only.
  - The root README, `packages/sdk/AGENTS.md`, `packages/landing/public/llms.txt`, the banners README and `docs/*`
    carry no reason list. Searched `transient|reason|fallback`.
- **No CHANGELOG for the npm packages.** Only `packages/presto/CHANGELOG.md` (the app) exists, and there is no
  `.changeset`. A core release is recorded by the manifest, the `@alejoamiras/<name>@<version>` tag and the
  GitHub release.
- **No API or `.d.ts` snapshot.** `git ls-files` shows no `*.snap`, and no committed `.d.ts` exists for these packages.
- **Server side.** `download_failed` is produced in one place only: `ProveError::DownloadFailed` →
  `(500, "download_failed", "Failed to download bb v{version}: {detail}")` at `packages/presto/core/src/server.rs:698-702`.
  - It is built at `server/prove.rs:653-656` when `versions::download_bb` fails.
  - The only other `500` code is `prove_failed` (:703).
  - `download_budget_exhausted` is a separate `429`.

## Conventions to match

- Every past core bump (#33, #47, #56, #73) moved the presto-noir manifest in the same PR. #64 deferred both bumps
  to the release, to keep `main`'s playground build green.
- Doc-sync guards are substring checks in each package's `public-contract.test.ts`. None pins the reason list.
- Test tables carry a never-happens column (`notPhase`) next to the expected phase.

## Collisions

- `bun.lock` is also touched by lane `deps-1`. The change here is two version lines; merge `origin/main` first if they
  conflict.
- `implementations-plan/follow-ups.md:72-73` holds the #102 entry, which the close-out deletes.
- Open issues: only #102 is in scope. No open or closed `known-limit` issue matches "fallback" or "download" in this area.
  The three closed limits (#125, #127, #153) concern the updater and custom bb.

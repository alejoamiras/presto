---
plan: workers-builds
tier: light (owner's call; the rubric scores one HIGH — external coupling — which would default to mid)
driver: claude-code
code_review: off
eli5_mode: artifact
harden: not scheduled (small CI/CD diff; the codex loop's adversarial pass covers it)
status: closed 2026-09-28 (see Outcome)
worktree: .claude/worktrees/workers-builds (branch worktree-workers-builds, rebased 2026-09-26 onto main @ b46898f)
---

## Outcome

**Closed 2026-09-28.** #61 was squash-merged as `08e507b` on 2026-09-27. Follow-on PRs #66 (`2d5826f`) and #68 (`2a04329`) closed its follow-ups. This plan's `/goal` and `/loop` seeds are retired.

**Shipped:**
- **Hosting:** Workers Builds builds and deploys both sites from the connected repo: production on every push to `main`, a Worker Preview on every other branch. Every branch decision lives in `scripts/workers-build.ts`; Wrangler is at 4.135.
- **Production playground:** installs the provenance-verified publications pinned in `packages/playground/published-sdk.json`.
  - `release-sdk`'s `bump-playground` raises the pin through an auto-merging release-bot PR.
  - `app.yml`'s Published Playground Build gates PRs that touch the pin or its code path.
- **Retired:** `deploy-landing.yml`, `presto-previews.yml`, and `release-sdk`'s `mode` input and `deploy-app` job. GitHub holds no site credential: the secret and variable were deleted on 2026-09-27, and the owner found no old token left in Cloudflare.
- **Verified live:**
  - Previews: headers, `crossOriginIsolated`.
  - Production on the merge commit.
  - Production again after #66 merged, on the owner's narrowed custom build token.
- **Follow-on #66:**
  - Every release-bot PR goes through the shared `bot-push` and `bot-pr` actions.
  - The Aztec update stages `host-dependencies.json`.
  - Release Bot Token Check exercises auto-merge.
  - The fork check passed (PR #63). See `lessons/post-impl.md`.

**Dropped or deferred:**
- The release-feed Worker stays on manual, environment-gated Actions deploys (owner decision).
- A3, the account-wide Workers Scripts Edit boundary, is an accepted risk.
- `bump-playground`'s own steps first run at the next `release-sdk`.
- Both of the last two are in `follow-ups.md`.

**Review:**
- Codex converged in 3 rounds on #61 and in 3 rounds on #66.
- The owner skipped the cutover's fork check at #61; it was run and passed before #66.

# Landing + playground deploys and PR previews on Cloudflare Workers Builds

## Goal

Cloudflare builds and deploys `presto-landing` and `presto-playground` from the connected GitHub
repo: production on every push to `main`, a Worker Preview (stable per-branch URL, posted on the PR)
on every other branch. GitHub Actions stops holding a Cloudflare deploy credential for the sites.

The production playground keeps its guarantee of running the **published, provenance-verified** SDK,
now declared by a committed pin that `release-sdk` bumps through a bot PR. Merging that PR is the
playground's deploy, so `release-sdk` loses its `mode` input and its `deploy-app` job.

Out of scope: the release-feed Worker (stays a manual, environment-gated Actions deploy), feed
promotion, a `dev` branch (rejected: previews per branch already are the staging environment),
release-please (separate evaluation).

## Outcome & Quality Bar

**For whom**: the owner, merging PRs and cutting SDK releases alone, and the people who open a PR's
preview link (the owner on a phone, a reviewer).

**What excellent looks like**
1. A PR touching a site gets its preview URL posted on the PR with no GitHub secret involved, and the
   URL stays the same across pushes to that branch.
2. Production never serves a playground built from unreleased SDK code. When the pinned versions
   cannot be verified, the build fails closed and shows as a red check on the `main` commit; the
   previous deployment keeps serving. A pin change is proven buildable by CI before it can merge.
3. The repository alone is enough to recreate the Cloudflare setup: every dashboard value is in
   `docs/CLOUDFLARE_DEPLOYMENT.md`, every branch decision is in one reviewed script.
4. `release-sdk.yml` gets strictly smaller in surface: no `mode`, no Cloudflare credential, no deploy
   job; one bot-PR job in their place.

**Good enough**: no automated preview cleanup (Cloudflare evicts the oldest at 100 per Worker), no
custom-domain previews, no Access protection on previews (they are public today as well).

## Recon

`recon.md` (reuse map, docs findings, collision risks). The decisions below cite it.

## Architecture & Implementation

**Shape.** Each Worker is connected to the repo with root directory `/`. The dashboard holds only
fixed strings: a build command that calls one repo script, and deploy / Preview commands that call
the root-pinned Wrangler with `--config`. All branch-dependent logic lives in `scripts/workers-build.ts`.

```
push ──► Workers Builds (per Worker, watch paths)
           build:   bun scripts/workers-build.ts <site>
                      ├─ assert Bun.version == .bun-version
                      ├─ playground: assert npm major >= 11, bash and tar on PATH   (every branch)
                      ├─ bun install --frozen-lockfile --ignore-scripts
                      ├─ playground && WORKERS_CI_BRANCH == main:
                      │     bun scripts/published-playground.ts   (reads the pin)
                      └─ bun run --cwd packages/<site> build
           main:    bunx wrangler deploy  --config packages/<site>/wrangler.jsonc
           branch:  bunx wrangler preview --config packages/<site>/wrangler.jsonc
```

The playground preflight runs on every branch so that each preview build proves the Cloudflare image
can run the published path's tools before any production build depends on it.

**The pin**: `packages/playground/published-sdk.json`, keyed by npm name:

```json
{ "@alejoamiras/presto": "5.2.0-revision.5", "@alejoamiras/presto-noir": "1.2.0" }
```

- `scripts/playground-pin.ts` — `readPlaygroundPin()` validates each value with the existing
  `isValidVersion(NPM_PACKAGES[key], v)` (`scripts/npm-packages.ts:115`), exactly two keys, no
  whitespace; a pure `raisePin(current, updates)` that moves a key only **forward**, so a re-run of an
  older release can never regress the pin. Forward means the repo's own release order: presto
  (aztec-derived) publishes `5.3.0` *before* `5.3.0-revision.1`, which semver sorts the other way, so
  presto compares the numeric base, then the revision number (absent = 0) — a `revisionOrder()`
  exported beside `resolvePublishVersion` in `scripts/get-sdk-publish-version.ts`, the scheme's single
  definition. Noir (manifest) uses `Bun.semver.order`. A deliberate rollback to an older SDK is a human
  PR. A CLI used by the bump job takes its inputs from environment
  variables, validates them before any file, ref or shell use, rewrites the pin in place and prints
  `changed` or `unchanged`.
- `scripts/published-playground.ts` — takes both versions from the pin. The `argv[2]` input and the
  `npm view …@testnet` fallback go (the dist-tag read is CDN-cached and non-reproducible). Noir is
  fetched at the pinned version rather than the workspace version; every existing check
  (provenance, tarball digest, published-manifest-vs-workspace-graph, shared core pin, bb.js peer pin)
  is unchanged.
- **What the pin does and does not decouple.** A production build succeeds only while `main`'s
  dependency graph (the `@aztec/*` versions, the core version the SDK depends on, the bb.js peer)
  matches the pinned publications. A version-only noir bump on `main` stays buildable; an Aztec bump or
  a core version bump fails closed until the release that publishes the new graph bumps the pin. That
  is today's invariant — the playground only ever deployed at release time — made continuous.
- Core is not pinned: it is derived from the adapters' exact pins, as today. Banners stay bundled from
  the workspace, as today.

**`release-sdk.yml`**
- Remove the `mode` input and every `inputs.mode` clause; `e2e` always runs with `build_presto: true`.
- Delete `deploy-app`.
- Add `bump-playground`, needs `[plan, e2e, dependency-audit, publish-core, publish-noir, publish-presto]`
  (the e2e and audit gates carry over from `deploy-app`, so a reuse-only run cannot move the pin past
  a red release). Condition, keyed on
  *scheduled publications* rather than selection, inside an explicit `!cancelled()` (without it GitHub's
  implicit `success()` skips the job whenever an upstream publish job skipped): not a dry run, `plan`,
  `e2e` and `dependency-audit` succeeded, and for each of core / noir / presto either `publish_<key> != 'true'` (unselected, or a
  verified reuse whose publish job skips) or its publish job succeeded. Inputs, passed as quoted
  environment variables:
  - presto: `needs.publish-presto.outputs.version` when it published in this run, else empty;
  - noir: `needs.plan.outputs.version_presto_noir`. The plan emits it for both `publish` and verified
    `reuse` (`release-plan.ts:222-224`), so a noir-only redispatch after a partial failure reconciles a
    noir that an earlier run published. A presto-only selection creates no noir entry
    (`release-plan.ts` `selectPackages`), so the value is empty.
  An empty input means "no update for that key".
- Mechanics (reusing `bump-source` / `_aztec-update.yml` patterns): job `permissions: {}`; a release-bot
  App token with `contents: write`, `pull-requests: write`; a new branch per attempt,
  `chore/playground-sdk-pin-<run_id>-<run_attempt>`.
  - If any open PR has a `chore/playground-sdk-pin-` head, the job **fails** with "pin PR #N is still
    open: merge or close it, then re-run this job". Pin PRs auto-merge within minutes, so this is rare,
    and failing loudly replaces every way of combining two pending bumps (each of which lost a version
    in some edge case).
  - Otherwise it checks out `origin/main` and applies `raisePin`. `unchanged` → success, nothing
    pushed. Else it commits the pin alone, pushes the new branch (never a force push), opens the PR
    and runs `gh pr merge --auto --squash --match-head-commit <pushed sha>` — a stale-head check at
    request time, not a lock: anyone who can push the branch already has write access, and every new
    head reruns the required checks.
  - Any failure after the push (PR creation, auto-merge) fails the job, so a published version never
    goes missing silently: re-running the job opens a fresh branch from `main`.
- **Recovery**: a failed `bump-playground` is re-run with "Re-run failed jobs" (upstream job outputs
  carry over); the manual fallback is a PR running `bun scripts/playground-pin.ts` by hand.

**`app.yml`** — a `published-build` job: Node 24.20.0 (npm 11), then
`WORKERS_CI_BRANCH=main bun scripts/workers-build.ts playground`, credential-free, reported through
`App Status` (already a required check). Its own paths-filter output routes only on the pin file and
the published-path code (`scripts/{workers-build,playground-pin,published-playground,verify-sdk-package-signatures,npm-pack-result,npm-packages,sdk-release-verification}.ts`,
`scripts/tarball-consumer/assert-core-pin.ts`, `.github/scripts/packaged-e2e-swap-sdk.sh`, `app.yml`).
It must never route on a file `scripts/update-aztec-version.ts` writes (the three `package.json`s,
`scripts/tarball-consumer/presto-noir/host-dependencies.json`, `bun.lock`): an Aztec bump cannot match
the published SDK until the release that follows it, so gating it here would deadlock that PR. A
contract test pins this.

**Deletions**: `.github/workflows/deploy-landing.yml`, `.github/workflows/presto-previews.yml`,
`scripts/presto-preview-config.test.ts` (its `_headers` assertions move to
`cloudflare-deployment.test.ts`). `landing.yml` drops its `deploy-landing.yml` filter line and keeps
both dry runs.

**Wrangler**: root devDependency `4.127.1` → the newest release ≥ 4.135.0 that is at least seven days
old on the day of implementation (4.135.0 cleared on 2026-09-25). Add `"previews": {}` to both site
configs. The feed config is untouched; `deploy-release-feed.yml` (structured `versions upload` output,
`versions deploy`) and the promote job (`kv key get/put`) ride the same bump, so Phase 1 checks those
interfaces explicitly.

**File-level change map**

| File | Change |
| --- | --- |
| `package.json`, `bun.lock` | wrangler bump |
| `packages/{landing,playground}/wrangler.jsonc` | `"previews": {}` |
| `packages/playground/published-sdk.json` | new pin |
| `scripts/playground-pin.ts` (+ test) | new |
| `scripts/workers-build.ts` (+ test) | new; exports a pure `buildSteps()` for tests |
| `scripts/published-playground.ts` | read the pin |
| `.github/workflows/release-sdk.yml` | drop `mode` + `deploy-app`, add `bump-playground` |
| `.github/workflows/app.yml` | `published-build` job + filter + `App Status` needs |
| `.github/workflows/deploy-landing.yml`, `presto-previews.yml` | delete |
| `.github/workflows/landing.yml` | filter line |
| `scripts/cloudflare-deployment.test.ts` | rewrite (see Phase 3) |
| `scripts/sdk-release-contract.test.ts` | drop `deploy-app` / `mode`, add `bump-playground` |
| `scripts/presto-preview-config.test.ts` | delete |
| `packages/presto/scripts/ci-filter-contract.test.ts` | fixture points at `deploy-release-feed.yml` |
| `scripts/update-aztec-version.ts` | exports the files it writes, for the routing contract test |
| `scripts/dependency-audit-allowlist.json` | drops the `sharp` exception the Wrangler bump resolved |
| `packages/release-feed/worker-configuration.d.ts` | regenerated by the new Wrangler |
| `docs/CLOUDFLARE_DEPLOYMENT.md`, `docs/RELEASE_RUNBOOK.md`, `packages/{landing,playground}/README.md`, `CLAUDE.md`, `implementations-plan/follow-ups.md` | docs |

**Alternatives not taken**
- *Deploy Hook from `release-sdk` + build reads `@testnet`*: re-introduces a GitHub-held credential
  (narrow, but still one) and the dist-tag read is CDN-cached, so a build right after publishing can
  silently ship the previous SDK. Rejected for the pin.
- *A `playground-live` production branch that `release-sdk` fast-forwards*: preserves today's timing
  exactly, but needs a protected deploy branch and still has to learn the version somehow. Rejected.
- *Build the production playground from workspace code*: simplest, rejected by the owner.
- *Root directory = `packages/<site>`*: Workers Builds' automatic install would find no lockfile there,
  and `deploy-landing.yml` already proves the `--config` form from the root.
- *`wrangler versions upload` for previews (works on the current Wrangler)*: a per-build Version URL
  but no stable per-branch URL without alias plumbing; Worker Previews is Cloudflare's current default.
- *Comparing the SDK's core dependency against the verified published core instead of the workspace
  core* (codex round 1): would make core-only bumps buildable, but it changes the semantics of a
  security check to avoid a fail-closed state that already has a clean exit (release, then pin).
- *Combining a new bump with a still-open pin PR* (codex rounds 2–4): a per-key three-way merge, then
  appending to the open PR with leased resets. Each round found another edge (an "Update branch" merge
  commit, a rerun of an older release, a pushed branch whose PR creation failed) where a version could
  vanish. Failing loudly while a pin PR is open removes the whole class.
- *Extracting a shared "bot PR" composite action*: this makes three App-token PR sequences
  (`bump-source`, `_aztec-update`, `bump-playground`); consolidating is out of scope and goes to
  `follow-ups.md`.

## Security & Adversarial Considerations

**Threat model.** The asset is the ability to change what `presto.build` and
`playground.presto.build` serve — the landing's download links and the page that talks to a user's
local Presto — and, one step removed, any other Worker in the account. Attackers: a compromised
dependency executing at build time, anyone able to push a branch, anyone holding a Cloudflare
credential, a malicious or equivocating registry.

- **The real boundary is the whole Cloudflare account.** Workers Builds needs Workers Scripts Edit,
  which Cloudflare grants account-wide. Any code that runs in a build and can read the token (assumed,
  I1) could redeploy *any* Worker in the account — including `presto-release-feed`, and through its
  binding read or write the feed KV — whatever permissions are dropped from the token. Clients verify
  the feed's Ed25519 signature, so the worst case on the updater path is withholding the feed or
  replaying an older signed one; on the landing it is altered download links. The retiring
  `CLOUDFLARE_DEPLOY_API_TOKEN` has the same account-wide scope and already ran next to `bun install`
  and `vite build` in the production deploy jobs. **What is new is branch builds**: today's preview
  builds ran without credentials; after this change a pushed branch's build-time code runs next to the
  token. The owner accepts this boundary explicitly (Ask A3).
- **Who can make Cloudflare run code.** Builds come from pushes to branches of `alejoamiras/presto`:
  the owner and the release-bot App. Fork PRs are the open question (I2): a fork PR raises events on
  the base repository, so the App's installation scope proves nothing. Evidence so far: the Workers
  Builds docs describe preview builds as triggered by pushes to branches of the connected repo, and
  Cloudflare Pages documents that "commits/PRs from forked repositories will not create a preview".
  Proof: a controlled fork PR right after previews are enabled, with no open fork PRs at the time (none
  today); if it starts a build, preview builds are switched off and the cutover stops. Dependabot only
  touches `.github/`, which no watch path includes.
- **Build-time code execution is minimised.** `bun install --frozen-lockfile --ignore-scripts`: no
  lifecycle scripts at all (Bun otherwise runs its built-in trusted list), which also skips Husky. The
  seven-day `minimumReleaseAge` gates new resolutions; `@aztec/*` is exempt by standing decision.
- **Narrower token anyway.** The owner selects a custom token instead of the auto-generated one:
  Account › Workers Scripts Edit, Account › Account Settings Read, Zone `presto.build` › Workers Routes
  Edit + Zone Read, User › User Details Read + Memberships Read. Dropping KV, R2 and all-zone routes
  does not change the account-wide boundary above; it removes direct access paths that need no Worker
  redeploy.
- **Supply chain of the published path is unchanged.** The production playground installs only
  tarballs whose sha512 matches the digest inside a verified provenance statement; `npm pack` and
  `npm install` keep `--ignore-scripts`. The pin makes the version reviewable in git, and CI proves a
  pin change builds before it merges.
- **Pin-bump PR.** Short-lived App token, job `permissions: {}`; version strings come from workflow
  outputs, travel as quoted environment variables and are validated by `isValidVersion` before they
  reach a file, a ref or a command. Pins only move forward, branches are new per attempt and never
  force-pushed, and `--match-head-commit` refuses a head that moved in between; required checks
  (`App Status` includes `published-build`) gate every head.
- **Fail closed.** Bun version mismatch, npm < 11, a missing `bash`/`tar`, a pin that does not
  validate, or any verification failure exits non-zero, so Workers Builds does not deploy and
  production keeps the previous version.
- **Previews are public** on `*.workers.dev` (noindex), as today. They never enter
  `verified-sites.json` (`VERIFIED_SITES.md` policy), so a preview gets no verified badge in Presto and
  starts deny-by-default.
- **Build variables are public.** `AZTEC_NODE_URL` is compiled into the bundle; no secret goes into a
  build variable.
- **Rollback does not stick on its own.** A dashboard rollback is overwritten by the next production
  build. The runbook says: revert the offending commit (preferred), or roll back and pause builds until
  the fix merges. Reverting this whole migration also requires disconnecting Workers Builds, whose build
  command would otherwise point at a deleted script.

## Assumptions

**Facts**
1. `deploy-landing.yml` deploys landing on pushes to `main` that touch `packages/landing/**`, with
   `CLOUDFLARE_DEPLOY_API_TOKEN` (`deploy-landing.yml:3-8,45-48`).
2. `release-sdk.yml` `deploy-app` deploys the playground after `published-playground.ts`, on Node
   24.20.0 because npm 10 omits verified attestations from the JSON signature audit
   (`release-sdk.yml:216-257`, comment at `:225`).
3. `presto-previews.yml` runs only when `vars.PRESTO_PREVIEWS_ENABLED == 'true'` (set 2026-09-05) and
   uses the same token (`presto-previews.yml:22,92`).
4. Worker Previews need Wrangler ≥ 4.135.0 and a `previews` block that may be empty; routes and custom
   domains target production only (Cloudflare docs, `recon.md`). The repo pins 4.127.1
   (`package.json:69`); 4.135.0 was published 2026-09-18.
5. Workers Builds injects `WORKERS_CI_BRANCH`, honours `BUN_VERSION`, `NODE_VERSION` and
   `SKIP_DEPENDENCY_INSTALL`, and its image lists npm 10.9.2 with Node 24.18.0 default (docs).
6. The default Workers Builds token includes Workers KV Storage edit and Routes edit on all zones; a
   custom token can be selected (docs, configuration page).
7. The live playground runs `@alejoamiras/presto` 5.2.0-revision.5 and `@alejoamiras/presto-noir`
   1.2.0 (release-sdk run 36195626527, 2026-09-25, which also deployed the lna-consent playground).
   5.2.0-revision.4 came from the interrupted run 36192153461 and has no tag, release or
   verification record, so it must never be pinned. `raisePin` cannot reach it: the bump job needs a
   successful `publish-presto`, and the pin already sits above it.
8. Landing and playground build from workspace source; no package `dist/` is needed (`recon.md`).
9. #55 (COEP `require-corp`) went live with run 36195626527, so the first production Workers Build
   changes nothing a visitor sees; only the builder changes.
10. An empty push bypasses build watch paths and always builds (docs, build-watch-paths page).
11. The release plan emits `version_<key>` for both `publish` and verified `reuse`
    (`release-plan.ts:93-110,218-224`); `_publish-npm.yml` outputs a version only when it ran.
12. Repository auto-merge is enabled today (`allow_auto_merge: true`, `gh api`, 2026-09-25); the
    `main` ruleset requires `SDK Status`, `App Status`, `Presto Status`, `Actionlint Status`, strict
    up-to-date, no approving review, no bypass actors. The last bot PR (#52) was merged by the owner by
    hand, so bot auto-merge has not been observed firing.

**Inferences**
- I1. Build-step code can read the Workers Builds token. Treated as true in the threat model.
- I2. Workers Builds does not build fork PRs. Supported by the docs' push-to-branch wording and the
  Pages known-issue on forks; undocumented for Workers Builds. Proven by the controlled fork PR (Owner
  step 3) before the cutover proceeds.
- I3. With `NODE_VERSION=24.20.0` the image's `npm` is Node 24's bundled npm 11, not a global 10.9.2.
  The preflight fails closed on every playground build, so the first *preview* build proves it before
  production depends on it. If it fails, the fix is chosen from that build's log.
- I4. `bunx wrangler preview --config …` satisfies "custom Preview commands must invoke
  `wrangler preview`". Checked on the first preview build; fallback `npx wrangler preview --config …`.
- I5. `bash` and `tar` exist in the image (Ubuntu 24.04 base); the preflight checks them.
- I6. Our Workers, created before Worker Previews but never connected to Builds, may still show the
  one-time "Set up Worker Previews" switch. Owner step: if the banner appears, complete the switch.
- I7. Wrangler 4.127 → 4.13x keeps the structured `versions upload` record that
  `deploy-release-feed.yml:46-58` parses, plus `versions deploy`, `kv key get/put`, `deploy --dry-run`.
  Checked in Phase 1 against the installed Wrangler source and `--help`.
- I8. The Worker `name` check passes with `--config` from the repo root, because Wrangler reads the name
  from the given config. Checked on the first preview build.
- I9. `bun install --frozen-lockfile --ignore-scripts` leaves both site builds and Wrangler working (no
  needed postinstall). Checked in Phase 2 on a clean install.
- I10. With a strict up-to-date rule, a bot PR that falls behind `main` (and, meanwhile, blocks the
  next release's bump job, which fails loudly) waits for "Update branch"
  instead of auto-merging. Accepted; the owner clicks it (same as `bump-source` today).

**Asks** — resolved by the owner on 2026-09-25: A1 owner does the Cloudflare side (step-by-step guide
given in chat, mirrored in `docs/CLOUDFLARE_DEPLOYMENT.md`); A2 auto-merge **yes**; A3 **accepted**.
On 2026-09-27 the owner connected both Workers with Cloudflare's **default** build token (the custom
token became optional hardening: it would not change the account-wide boundary) and **skipped the
fork check**: I2 stays unverified and is recorded as accepted risk in `follow-ups.md`.

Original asks:
- A1. The owner performs the Cloudflare side (custom token, GitHub App scope, connect both Workers,
  settings table) — nothing here can do it without a Cloudflare credential.
- A2. The pin-bump PR auto-merges once required checks pass (recommended: yes — today a release deploys
  the playground immediately), or stays open for the owner to merge. Auto-merge is already enabled at
  repository level; no policy change is needed.
- A3. The owner accepts the account-wide boundary: every build Cloudflare runs for these two Workers,
  preview branches included, could in the worst case redeploy any Worker in the account.

## Phases

### Phase 1 — Wrangler with Worker Previews ✓
Bump the root `wrangler` devDependency to the newest ≥ 4.135.0 release that clears the seven-day age
gate; add `"previews": {}` to both site configs; extend the wrangler-config assertions in
`cloudflare-deployment.test.ts` to require the block.

**Validation gate**
- `bun install --frozen-lockfile` after the lockfile update; `bun run test` exit 0.
- `bun run --cwd packages/landing build && bunx wrangler deploy --dry-run --config packages/landing/wrangler.jsonc`
  and `bunx wrangler deploy --dry-run --config packages/release-feed/wrangler.jsonc` exit 0.
- `bunx wrangler preview --help` lists `--config`; `kv key put --help` lists `--path` and `--remote`;
  `kv key get --help` lists `--remote`; `versions deploy --help` still accepts `<id>@<pct>` and `--yes`.
- The installed Wrangler still writes a `version-upload` entry with `version`, `worker_name` and
  `version_id` to `WRANGLER_OUTPUT_FILE_PATH` (grep its bundled source for the emitter), which
  `deploy-release-feed.yml:46-58` depends on.
- `bun run audit:dependencies` exit 0 (a new transitive advisory is a stop-and-surface, not an
  allowlist edit).
- Layers: lint, typecheck, unit, CLI smoke.

### Phase 2 — Pin and build entry point ✓
Add `packages/playground/published-sdk.json`, `scripts/playground-pin.ts`, `scripts/workers-build.ts`;
switch `published-playground.ts` to the pin.

Tests (inline): `playground-pin.test.ts` — rejects a malformed, whitespace-padded or extra-keyed pin;
`raisePin` moves presto forward from `5.3.0` to `5.3.0-revision.1` and from `5.2.0-revision.9` to
`5.3.0`, refuses both reverse moves, moves noir by semver, leaves a key with an empty update alone, and
reports `unchanged` when nothing moves; `revisionOrder` gets its own cases in
`get-sdk-publish-version.test.ts`. `workers-build.test.ts` — `buildSteps()` for landing on any branch, playground on `main`
(published step present), playground elsewhere (absent, preflight present), and rejection of an
unknown site, a missing branch, or a Bun version mismatch.

**Validation gate**
- `bun test scripts/playground-pin.test.ts scripts/workers-build.test.ts scripts/published-playground.test.ts` green.
- Clean install with `--ignore-scripts` (`rm -rf node_modules packages/*/node_modules` first), then the
  real published path, locally (network, npm 11): `WORKERS_CI_BRANCH=main bun scripts/workers-build.ts playground`
  exit 0 and prints `Playground uses verified published @alejoamiras/presto@5.2.0-revision.5 … presto-noir@1.2.0`;
  then `bunx wrangler deploy --dry-run --config packages/playground/wrangler.jsonc` exit 0.
- `WORKERS_CI_BRANCH=some-branch bun scripts/workers-build.ts landing` and `… playground` exit 0.
- Restore the workspace (`bun install --frozen-lockfile`), then `bun run test` exit 0.
- Layers: lint, typecheck, unit, integration against the live registry.

### Phase 3 — Retire the Actions deploy paths, add the CI and release pieces ✓
Delete `deploy-landing.yml`, `presto-previews.yml`, `presto-preview-config.test.ts`; rework
`release-sdk.yml` (drop `mode`, `deploy-app`; add `bump-playground`); add `published-build` to
`app.yml`; `landing.yml` filter line; `ci-filter-contract.test.ts` fixture.

Contract tests:
- `cloudflare-deployment.test.ts`: no workflow runs `wrangler deploy` / `wrangler preview` /
  `versions upload` for landing or playground, and none references `CLOUDFLARE_DEPLOY_API_TOKEN` or
  `PRESTO_PREVIEWS_ENABLED`; both site configs keep `./dist`, SPA handling, `preview_urls` and a
  `previews` block; the `_headers` COOP / COEP assertions moved from the deleted test; the feed
  assertions stay as they are; `app.yml`'s `published-build` runs `workers-build.ts playground` with
  `WORKERS_CI_BRANCH: main` and feeds `App Status`, and its filter matches none of the files
  `update-aztec-version.ts` writes (the list is exported from that script and imported by the test).
- `sdk-release-contract.test.ts`: no `mode` input and no `inputs.mode`; `bump-playground` has job
  `permissions: {}`, reads versions only from `needs.publish-presto.outputs.version` and
  `needs.plan.outputs.version_presto_noir` via `env:`, never interpolates them into `run:`, gates on
  `!cancelled()` and `publish_<key>` for core / noir / presto (so a presto-only run and a noir-only
  reuse run both reach it), fails when an open `chore/playground-sdk-pin-` PR exists, calls
  `playground-pin.ts`, pushes a `chore/playground-sdk-pin-${{ github.run_id }}-${{ github.run_attempt }}`
  branch without `--force`, and merges with `--auto --squash --match-head-commit`; `release-sdk.yml` references no `CLOUDFLARE_` secret.

**Validation gate**
- `bun test scripts/cloudflare-deployment.test.ts scripts/sdk-release-contract.test.ts packages/presto/scripts/ci-filter-contract.test.ts` green.
- `bun run lint:actions` exit 0; `bun run test` exit 0.
- Layers: lint (incl. actionlint), typecheck, unit/contract.

### Phase 4 — Docs ✓
`docs/CLOUDFLARE_DEPLOYMENT.md`: the dashboard settings table (below) as the source of truth, the
custom token, the GitHub App scope, the account-wide boundary, cutover order, rollback (revert first;
dashboard rollback only with builds paused; disconnect Builds if the migration itself is reverted).
`docs/RELEASE_RUNBOOK.md`: token table (site token retired), `release-sdk` dispatch without `mode`, the
pin PR as the playground's deploy, its recovery, and the expected fail-closed window after an Aztec
bump. Package READMEs, `CLAUDE.md` (Hosting, CI and release lines, test counts), `follow-ups.md` (the
token entry: site token retired, feed tokens stay; a new entry for the three bot-PR sequences).

**Validation gate**
- `rg -n "deploy-landing|presto-previews|playground-only|sdk-only|sdk-and-playground|PRESTO_PREVIEWS_ENABLED|CLOUDFLARE_DEPLOY_API_TOKEN" --glob '!implementations-plan/**' --glob '!scripts/*.test.ts' --glob '!packages/presto/scripts/*.test.ts'`
  returns only retirement notes in `docs/`; the excluded tests contain these names only as negative
  assertions.
- `bun run lint` exit 0.

### Dashboard settings (Phase 4 writes this into `docs/CLOUDFLARE_DEPLOYMENT.md`)

| Setting | `presto-landing` | `presto-playground` |
| --- | --- | --- |
| Repository / production branch | `alejoamiras/presto` / `main` | same |
| Enable Preview Builds | on | on |
| Root directory | `/` | `/` |
| Build command | `bun scripts/workers-build.ts landing` | `bun scripts/workers-build.ts playground` |
| Deploy command | `bunx wrangler deploy --config packages/landing/wrangler.jsonc` | `… packages/playground/wrangler.jsonc` |
| Preview command | `bunx wrangler preview --config packages/landing/wrangler.jsonc` | `… packages/playground/wrangler.jsonc` |
| Build variables | `BUN_VERSION=1.4.0`, `SKIP_DEPENDENCY_INSTALL=1` | same, plus `NODE_VERSION=24.20.0` |
| Watch paths (include) | `packages/landing/*`, `scripts/*`, `package.json`, `bun.lock`, `bunfig.toml`, `.bun-version` | `packages/playground/*`, `packages/sdk/*`, `packages/sdk-core/*`, `packages/sdk-noir/*`, `packages/banners/*`, `fixtures/noir/*`, `scripts/*`, `.github/scripts/*`, `package.json`, `bun.lock`, `bunfig.toml`, `.bun-version`, `tsconfig.json` |
| API token | custom (Security section) | same token |

`BUN_VERSION` duplicates `.bun-version`; the build script refuses to run on a mismatch, so a Bun bump
that forgets the dashboard fails loudly instead of building on the wrong Bun.

## Owner steps (in order)

1. After the codex loop converges: create the custom token. Install (or restrict) the Cloudflare
   GitHub App to `alejoamiras/presto` only. Connect both Workers with the table above; if a "Set up
   Worker Previews" banner shows, complete the switch. A production build of `main` may run on connect
   and fail (the script is not on `main` yet): harmless, nothing deploys.
2. Control: the agent pushes an empty commit to the branch → both preview builds must start and go
   green, and each Preview URL must load (playground: `crossOriginIsolated === true`, COEP
   `require-corp` served; the build log shows the preflight's npm ≥ 11).
3. Fork check, immediately after: from a fork the owner controls (e.g. under a throwaway
   organisation), open a PR whose change touches `scripts/` (a watch path of both Workers). Pass =
   after ten minutes, neither Worker's build list in the Cloudflare dashboard shows a queued, running
   or finished build for the fork commit, and the PR carries no Workers Builds check or comment. Fail
   → switch preview builds off on both Workers, cancel any fork build, and stop the cutover.
4. PR opened; owner merges. Both production builds on the merge commit must be green; production serves
   #55's headers and the pinned SDK.
5. After a day of normal operation: revoke the old token in Cloudflare,
   `gh secret delete CLOUDFLARE_DEPLOY_API_TOKEN`, `gh variable delete PRESTO_PREVIEWS_ENABLED`.
   Until then, reverting the PR (and disconnecting Builds) restores the Actions path.

## Post-implementation

Run after Phase 4 is green, over the whole diff from `b46898f`. `code_review` is `off`: no
`/code-review` pass.

1. **Codex audit** (`/codex high`): the diff, this plan, `recon.md`, the adversarial ask (*What could go
   wrong? What would an attacker target? What are we trusting that we shouldn't? Where are the
   supply-chain / least-privilege weaknesses?*), and the two rules below verbatim.
2. **Fix loop**: verify each finding against the repo, apply the accepted ones, commit, log the round in
   `lessons/post-impl.md` (finding → verdict → why), then **resume the same codex session** with the fix
   diff and ask for a re-review under the same rules. Stop when a round yields no new material finding.
   Still material after 3 rounds → stop and surface to the owner.
3. **Live preview check** (Owner steps 1–3): hold for the owner's dashboard connection, then push an
   empty commit and verify both check runs and Preview URLs; the owner then runs the fork check. A failure here is fixed on the branch and
   goes back through step 2.
4. **Delivery**: `gh pr create` (first PR of this plan), then `gh pr checks --watch`. Merging is the
   owner's call.

**No-over-engineering rule** (verbatim in every codex prompt): *"Report bugs and small, targeted
improvements only. Do not propose speculative abstractions, extra configuration surface, new layers,
or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it
alone."*

**Comment-quality rule** (verbatim in every codex prompt): *"Audit the comments for value per
character. Flag any comment that narrates what the code visibly does, restates its line, references
implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places
where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent
context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact."*

## Delivery

Single arc, single PR (`gh pr create`) from `worktree-workers-builds`: Phases 1–4. `/code-review`: off.
The PR is opened only after the codex loop converged and the live preview check passed.

## Audit verdicts

### Codex plan audit, round 1 (GPT-6 Astra, `high`) — `reject`

Blocking: production validation gap, incomplete release recovery, understated credential blast radius.

| # | Finding | Verdict | What changed |
| --- | --- | --- | --- |
| 1 | [High] A pin PR never exercises the published build before auto-merge | **Adopted** | `app.yml` `published-build`, routed on the pin and published-path scripts only, inside `App Status` |
| 2 | [High] Pinning noir does not decouple `main`'s graph (core version, bb.js peer still compared to the workspace) | **Adopted as a correction**, fix rejected | The decoupling claim is narrowed to version-only noir bumps and the fail-closed window is documented; comparing against the published core instead was rejected (see Alternatives) |
| 3 | [High] A redispatch that reuses an already-published noir leaves its pin stale | **Adopted** | noir comes from `needs.plan.outputs.version_presto_noir` (emitted for `reuse` too); recovery via "Re-run failed jobs" documented |
| 4 | [High] Closing older pin PRs can drop an unmerged bump | **Adopted** | one fixed bot branch; `nextPin` overlays main ← pending ← run; no-op when unchanged; `--match-head-commit` |
| 5 | [High] Dropping KV from the token does not isolate the feed: Workers Scripts Edit is account-wide | **Adopted** | Security section rewritten around the account boundary; GitHub App scoped to the repo; Ask A3 |
| 6 | [Medium] Auto-merge may be disabled at repo level | **Partly stale** | `allow_auto_merge` is `true` today (Fact 12); strict up-to-date and the unobserved bot auto-merge recorded (I10, A2); no Cloudflare check made required |
| 7 | [Medium] Published path first runs in Cloudflare's image in production; rollback gets overwritten | **Adopted** | preflight on every playground build (previews rehearse the tools); rollback + disconnect guidance |
| 8 | [Medium] Validation and reuse gaps | **Adopted** | Phase 1 checks the structured upload record, `versions deploy`, `kv key get`; `isValidVersion` reused; quoted env; `--ignore-scripts`; Phase 4 search scoped and includes `sdk-only` |

Also corrected: Fact 1 now states the landing path filter; I6 no longer equates "created" with
"connected".

### Codex plan audit, round 2 (same session, resumed) — `reject`

Blocking: Aztec-update CI deadlock, stale pending pins overriding `main`, unverified fork isolation.

| # | Finding | Verdict | What changed |
| --- | --- | --- | --- |
| 1 | [High] `scripts/tarball-consumer/**` in the filter matches `presto-noir/host-dependencies.json`, which `update-aztec-version.ts:21` rewrites — deadlock | **Adopted** (verified) | filter names `assert-core-pin.ts` only; a contract test imports the Aztec-update file list and asserts no match |
| 2 | [High] Overlaying the whole pending pin can undo a `main` change or resurrect a closed branch's value | **Adopted** | per-key three-way merge against the open PR's parent; leftover branches ignored; leased push |
| 3 | [High] Repo-scoped App installation does not exclude fork PRs (their events land on the base repo) | **Adopted** | I2 restated; evidence cited (Workers Builds push-to-branch wording, Pages fork known-issue); controlled fork PR as Owner step 2, with a stop rule |
| 4 | [Medium] Trigger said "selected" but verified reuse skips its publish job | **Adopted** | condition keyed on `publish_<key>`; empty input = no update; presto-only selection has no noir entry |
| 5 | [Medium] `--match-head-commit` overstated as a permanent lock | **Adopted** | described as a stale-head check; leased push; checks rerun on every head |

### Codex plan audit, round 3 (same session) — `reject`

Blocking: pending-pin loss after "Update branch", and a fork test that can falsely pass.

| # | Finding | Verdict | What changed |
| --- | --- | --- | --- |
| 1 | [High] After "Update branch", the head's parent already contains the pending bump, so the three-way merge drops it | **Adopted by redesign** | no recomputation: the job appends a commit to the open PR's head; `raisePin` is forward-only |
| 2 | [Medium] An `unchanged` result can leave an obsolete PR eligible to merge (rerun of an older release) | **Moot after redesign** | forward-only pins: an older rerun cannot move anything, and an open PR only ever carries increases |
| 3 | [Medium] Without an explicit status function, implicit `success()` skips the job when a publish job skipped | **Adopted** | `!cancelled()` outer guard stated and contract-tested |
| 4 | [Medium] The fork test can falsely pass (unwatched path, broken integration, queued build) | **Adopted** | same-repo control first; fork change touches `scripts/`; pass judged on Cloudflare's build list; stop and cancel on failure |

### Codex plan audit, round 4 (same session) — `reject`

Blocking: SDK revisions sort backward; an interrupted PR creation can lose a pending version.

| # | Finding | Verdict | What changed |
| --- | --- | --- | --- |
| 1 | [High] `Bun.semver.order` sorts `5.3.0-revision.1` below `5.3.0`, but `get-sdk-publish-version.ts:23-39` publishes the base first | **Adopted** (verified: `order` returns -1) | presto compares base, then revision (`revisionOrder`, beside `resolvePublishVersion`); noir keeps semver |
| 2 | [High] A branch pushed without a PR was treated as disposable, dropping its version | **Adopted by simplification** | no reuse of branches: fail loudly while a pin PR is open, a fresh branch per attempt, never a force push; any post-push failure fails the job |

### Codex plan audit, round 5 (same session) — `approve`

"No remaining findings meeting the stated criteria" (wrong production state, silent loss of a
published version, real security hole). Implementation and live cutover validation remain with the
phase gates and the post-implementation loop.

**Unresolved concerns carried to the owner**: the account-wide Workers boundary (A3), unobserved bot
auto-merge (A2, I10), and fork behaviour pending the controlled check (I2).

### Post-implementation codex loop (same model and effort) — converged `clean` in round 3

Round 1: recovery by closing an open pin PR dropped its versions (runbook and error now say merge);
the `published` filter missed install config; the deployment doc stated fork exclusion as fact and
lacked the cutover; two headers narrated. Round 2: routing `bunfig.toml` (added in round 1) re-created
the Aztec-bump deadlock, since that PR edits its excludes by hand; `bunfig.toml` is now on the
must-not-route list instead of codex's proposed content-based exemption. Round 3: clean. All
adopted; detail in `lessons/post-impl.md`.

## Seeds (final, 2026-09-25)

ELI5 companion: Artifact https://claude.ai/artifact/Ky7aNW8NzXzCA926Gbo2uf, published from
`implementations-plan/workers-builds/eli5.html` (gitignored; republish that path to keep the URL).

Recommended: `/goal` (completion is visible in the transcript).

```
/goal implementations-plan/workers-builds/plan.md Phases 1–4 are each marked ✓ in plan.md, each backed by its validation gate reported passing in the transcript and a printed LESSONS_FILE=implementations-plan/workers-builds/lessons/phase-N.md; /code-review was NOT run (code_review: off); the codex fix loop over the full diff converged, shown by a resumed codex pass reporting no new material findings quoted in the transcript; after the owner connected both Workers, an empty-commit push produced green Workers Builds check runs for presto-landing and presto-playground on the branch head (gh api check-runs output in the transcript) and both Preview URLs loaded; the PR exists, created only after all of that (gh pr view output in the transcript); bun run test and bun run lint:actions both exit 0 in the transcript. Never merge, never touch Cloudflare settings or secrets; when the owner's dashboard step is pending, say so and hold.
```

Fallback: `/loop 15m`

```
/loop 15m Drive implementations-plan/workers-builds forward. Each firing: (1) read plan.md + lessons/ (authoritative; if plan.md has an ## Outcome block or lives under archive/, STOP); rebuild the task list from plan.md if empty; git status; git log --oneline -5. (2) No task in hand → next pending phase; after each edit run bun run lint and the touched tests; commit and push. (3) Stuck or facing a real decision → /codex high, log the verdict in lessons/, act; never merge, never deploy, never touch Cloudflare settings or GitHub secrets, never widen scope. (4) Same step failed 5 times → reassess with codex. (5) Phase gate green → paste it, mark ✓ in plan.md, print LESSONS_FILE=…, next phase. (6) All phases ✓ → run plan.md's Post-implementation section in order: codex loop with the no-over-engineering and comment-quality rules until clean; then hold for the owner's dashboard connection; then empty-commit push and verify both check runs + Preview URLs; then gh pr create and gh pr checks --watch; then report what shipped, the codex debates with plain-language context, and open items, and stop.
```

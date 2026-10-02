---
tier: light
driver: claude-code
eli5_mode: artifact
code_review: off
codex_model: sol
status: completed
created: 2026-10-02
worktree: .claude/worktrees/bundle-v6
branch: worktree-bundle-v6
base: main @ a9dbe84
---

## Outcome

- **2026-10-02 — completed**, delivered in PR #86. The app prerelease and the SDK docs publish run
  after its merge.
- **Shipped:**
  - The release notes open with `### Aztec versions`: the desktop app bundles `bb` for
    `${AZTEC_VER}` and downloads any other version on first use; the headless server bundles none.
    "Built against Aztec X" is gone.
  - Packaged acceptance asserts the installed app's `/health.aztec_version` equals the SDK's Aztec
    pin.
  - Integrator docs, with contract tests on each opening: the root README's canonical
    `## Presto and Aztec versions`, leads in the SDK README, `AGENTS.md`, `SKILL.md` and the app
    README, the landing callout, and `presto.build/llms.txt`.
  - The root `README.md` now routes to the script-contract job.
- **Bundle evidence:** `build-test-bundle.yml` runs 37055445459 and 37055449680 at `e6d3038`, both
  success. Every build log shows `Aztec bb version: 6.0.0-rc.1`, and the Linux sidecar is
  byte-identical to bb.js 6.0.0-rc.1.
- **Approved for after the merge:**
  - `release-presto.yml` publishes `1.2.0-rc.1` as a prerelease, never promoted.
  - Then `release-sdk.yml packages=presto` publishes `6.0.0-rc.1.1` on npm `testnet`.
- **Dropped:**
  - Lead notes in the presto-core, presto-noir and presto-banners READMEs: any change forces a
    version bump; moved to `follow-ups.md`.
  - Renaming `/health.aztec_version`, and changing the tray label.
- **This plan's `/goal` and `/loop` seeds are retired.** This file is a record of what was decided,
  not instructions.

# bundle-v6

Ship the next Presto desktop release with the `bb` for Aztec 6.0.0-rc.1 instead of 5.2.0, published
as a prerelease. Make every first-read surface an integrating developer or coding agent meets say two
things up front:
- Presto proves for whatever Aztec version the dApp's SDK asks for: the desktop app bundles one `bb`
  and downloads the others on first use.
- Install and connect prompts come from `@alejoamiras/presto-banners`.

This closes the follow-up "The next app release should bundle v6 `bb`".

**Phase 0 answers:**
- Bundle v6 only; v5 dApps download 5.2.0 once per machine.
- After merge, publish a prerelease with `release-presto.yml` (`mode=publish`, never promoted).
- Gate the bundle on PR CI plus candidate `build-test-bundle.yml` dispatches.
- Codex runs on GPT-6.1 Sol (`gpt-6.1-sol`) at `high`; `/code-review` is off.
- No `/harden`: there is no new trust boundary (see Security).

The owner's report that prompted the docs half: one agent integrating Presto concluded "Presto is
5.2.0", and another started designing its own install banners before finding presto-banners.

## Outcome & Quality Bar

**For whom:**
1. A developer's coding agent integrating Presto into an Aztec or Noir dApp. It reads whatever it
   meets first: the installed SDK's `AGENTS.md`/`SKILL.md`/README, the GitHub README or release page,
   or presto.build.
2. Presto users who install the prerelease.

**What excellent looks like:**
1. Every surface this plan owns opens with the same points. A contract test fails if a pointer leaves
   a surface's lead. The points are:
   - Presto's app version is not an Aztec version.
   - Presto proves for the Aztec version the SDK sends, and fetches that `bb` itself.
   - Install and connect UI comes from `@alejoamiras/presto-banners`.
2. The prerelease's desktop installers bundle bb 6.0.0-rc.1 on every platform. This is proven before
   merge by candidate bundles and after merge by the release's own smokes. The release notes say
   "bundles", scoped to the desktop app, never "built against".
3. If A4 is approved, the installed `@alejoamiras/presto@testnet` carries the new `AGENTS.md`/`SKILL.md`.

**Good enough:** no API, `/health` field or tray-label changes. The long READMEs keep their bodies
and gain short leading notes plus one short canonical section.

## Architecture & Implementation

**The bundle needs no mechanism change.** `copy-bb.ts:207-225` `resolveAztecBb()` follows
`packages/sdk/package.json` → `@aztec-labs/bb-prover` → `@aztec-foundation/bb.js`, which is
6.0.0-rc.1 on `main`.
- macOS and Linux copy that package's native `bb`, and the label comes from the same `package.json`.
- Windows fetches the reviewed `6.0.0-rc.1` `bb.exe` pin (`copy-bb.ts:87-91`).
- 1.1.3 bundled 5.2.0 only because it was cut before the SDK moved.
- The headless server tarballs bundle **no** `bb` (`release-presto.yml:481`, prebuild off). The
  server uses `BB_BINARY_PATH` (labelled by `AZTEC_BB_VERSION`) or downloads; that does not change.

**Change map:**

| File | Change |
|---|---|
| `.github/workflows/release-presto.yml` (notes block) | Replace `### Aztec Version` / "Built against Aztec …" with an `### Aztec versions` section placed right after the opening lines, before the download tables. It says: "The desktop app bundles the \`bb\` for Aztec \`${AZTEC_VER}\`. For another Aztec version a dApp's SDK requests, Presto downloads that version's published \`bb\`, verifies it and caches it, on first use. The headless server bundles none (it uses \`BB_BINARY_PATH\` or downloads)." It then adds a line for dApp developers linking the canonical section and naming presto-banners. |
| `packages/presto/scripts/release-contract.test.ts` | Pins the new section, and that it precedes the download tables; forbids "Built against Aztec". |
| `README.md` (root) | Two parts. A lead note (before the first `##`) with both pointers. A short `## Presto and Aztec versions` section (the canonical anchor) that summarizes and links `packages/presto/README.md#version-model--why-an-aztec-bump-doesnt-re-release-this-app` for the detail, which already exists there (`:112-116`) and is not duplicated. Install comments name the SDK's Aztec line ("SDK for Aztec v6"). |
| `packages/sdk/README.md`, `packages/sdk/AGENTS.md`, `packages/sdk/.claude/skills/presto/SKILL.md` | One leading note each, before the first `##` (SKILL.md: its first "Key facts" bullets). It gives the version model in one or two sentences, links the canonical section, and adds the presto-banners pointer ("don't design your own install prompt"). The SDK README's `#ask-before-you-probe` section also gets the presto-banners pointer and canonical link: the presto-noir README already sends readers there (`packages/sdk-noir/README.md:31`), so Noir integrators reach both without a noir release. |
| `packages/playground/e2e/presto.packaged-e2e.spec.ts` | After the native proof, read the detailed `/health` from the approved page and assert `aztec_version` equals the SDK's pinned `@aztec-labs/stdlib` version. The app routes a request whose version equals its compiled label to the sidecar (`core/src/server/prove.rs:75`), so this proves the installed app proves the SDK's version with its bundled `bb` and no download. |
| `packages/presto/README.md` | Lead: one line linking the canonical section. `/health` docs: `aztec_version` is the bundled version. `available_versions`/`versions` (detailed body, approved origins only) list the bundled plus cached versions, an inventory that proves neither integrity nor compatibility (every cached `bb` is re-hashed before each prove). Headless config table: add the `AZTEC_BB_VERSION` and `GITHUB_TOKEN` rows. |
| `packages/landing/index.html` (developer callout) | One sentence: Presto proves for the Aztec version your SDK pins and fetches the matching `bb`; prompt users with `<presto-banner>` from `@alejoamiras/presto-banners`. Static text only. |
| `packages/landing/public/llms.txt` (new) | An [llms.txt](https://llmstxt.org) covering: what Presto is, the packages, the version model, presto-banners for install UI, and the rule never to contact Presto on page load (ask first, HTTPS default). Links: the canonical section, package READMEs, the security model. The page never fetches it. |
| Contract tests | `packages/sdk/src/lib/public-contract.test.ts`: the SDK README, AGENTS.md and SKILL.md carry both pointers in their lead. New `scripts/integrator-docs.test.ts`: the root README lead and canonical section, and the app README lead. New `packages/landing/src/integrator-docs.test.ts` (it runs in `landing.yml`, which the root tests do not): the landing callout and `llms.txt` (the four packages, the canonical link, the ask-first rule). Tests key on anchors and package names, not prose. |
| `CLAUDE.md`, `implementations-plan/follow-ups.md` | Current-state lines (headless bundles no `bb`; landing serves `llms.txt`; test counts); follow-ups per the close-out. |

**Canonical section (root README), in substance:**
- Presto's own version (1.x: the tray, `/health.version`) is the app's. It does not say which Aztec
  versions Presto proves.
- The desktop app bundles one `bb`; the release notes name it. For another Aztec version, Presto
  downloads that version's published `bb` from Aztec's GitHub releases on first use, verifies the
  bytes against the SHA-256 GitHub publishes for the asset, and caches it. Only releases that publish
  an asset digest can be downloaded. The digest comes from the same publisher, so it does not
  authenticate Aztec independently (the security model's SEC-02).
- Nobody configures this:
  - The SDK sends its pinned Aztec version with every request (`x-aztec-version`).
  - `@alejoamiras/presto-noir` sends its `bbVersion` option, which defaults to its tested bb.js
    version and is refused outside the tested list unless `allowUntestedBbVersion` is set.
- Tested pairings are the ones CI runs. A successful download says nothing about compatibility.
- Limits:
  - The first download needs network access to GitHub (an anonymous API call, 60 an hour per
    address; the headless server accepts `GITHUB_TOKEN`).
  - Downloads are budgeted per origin.
  - On Windows, native transaction proving needs Aztec v6 or later; Noir proving is unaffected.

**Alternatives not taken:**
- *Edit the `presto-core`, `presto-noir`, `presto-banners` READMEs now.* Any change under a
  manifest-versioned package makes the next `release-sdk.yml` refuse to reuse it
  (`scripts/release-plan.ts:118`). A bump without a matching published SDK then fails the production
  playground build (`scripts/published-playground.ts:140`). The pointers ride each package's next
  release instead (a follow-up). Meanwhile Noir integrators reach both pointers through the SDK
  README section their README already links.
- *Ship `AGENTS.md`/`SKILL.md` in the other packages.* Same release cost, and those `files` arrays
  are pinned by tests.
- *Rename `/health.aztec_version`.* A breaking API change for a docs problem.
- *Change the tray label.* The Versions submenu already marks "(bundled)".
- *Edit the `bb 5.2.0` comments in `ultra_honk.rs` and friends.* They document workarounds still
  needed when Presto downloads 5.2.0.
- *Bundle both versions.* Rejected at Phase 0.

## Security & Adversarial Considerations

- **Release.**
  - `release-presto.yml` runs only from `main` and signs inside its own isolated job.
  - A prerelease publishes with `--latest=false` and no `latest.json`, and the workflow is
    append-only.
  - This plan never runs `mode=promote-only`, so no installed client is offered the prerelease.
  - The dispatch preflight refuses while any `release-presto` run is queued, waiting, pending or in
    progress.
  - The plan captures the merge SHA and checks the dispatched run's `headSha` against it, cancelling
    on mismatch.
- **npm publish (A4).** `release-sdk.yml` publishes with provenance to the `testnet` dist-tag; npm
  `latest` stays on the v5 line. The `bump-playground` release-bot PR follows through the guarded
  `bot-push`/`bot-pr` path.
- **Supply chain.** No dependency or pin changes:
  - The bundled `bb` comes from `@aztec-foundation/bb.js@6.0.0-rc.1`, which is in the frozen lockfile
    and past the 7-day gate (published 2026-09-23).
  - On Windows, it comes from the manual-review sha256 pin.
- **Docs and `llms.txt` as agent-facing input.** Agents will follow them, so they teach only the
  safe path:
  - Never contact Presto on page load: ask first.
  - Keep the HTTPS-only browser default.
  - `--allow-all` and `ALLOWED_ORIGINS` are for headless CI only.
  - `/health` is diagnostic, not a security signal.

  The landing page still contacts nothing; `llms.txt` is a static file it never loads.
- **Overclaiming.** The version section states the download's limits (network, digests, rate
  limit, budget, Windows, tested pairings), so integrators do not promise offline or untested proving.
- **Least privilege.** `build-test-bundle.yml` is `contents: read` and secretless; no permission changes.

## Assumptions

**Facts (verified):**
1. The bundled desktop `bb` and its label both come from `resolveAztecBb()`
   (`packages/presto/scripts/copy-bb.ts:207-266`); no workflow overrides it.
2. The SDK pins `@aztec-labs/bb-prover` 6.0.0-rc.1 (`packages/sdk/package.json:34`). The only bb.js in
   `node_modules` is 6.0.0-rc.1, with native `bb` for arm64/amd64 on macOS and Linux.
3. Windows has a reviewed `6.0.0-rc.1` `bb.exe` pin (`copy-bb.ts:87-91`).
4. Headless release tarballs skip the prebuild and ship only `presto-server`
   (`release-presto.yml:481`). The server reads `AZTEC_BB_VERSION` at runtime
   (`packages/presto/server/src/main.rs:114`).
5. The release workflow:
   - requires `main` (`release-presto.yml:63`);
   - treats any `-` version as a prerelease (`:87`);
   - stamps the dispatched version into `Cargo.toml`/`tauri.conf.json` (`:239-262`).

   The committed version is `1.1.4-rc.1`.
6. The 1.1.3 notes say "Built against Aztec \`5.2.0\`" (`release-presto.yml:1029-1030`).
7. bb 5.2.0 on Windows corrupts binary proof files (`core/src/bb.rs:350-352`). UltraHonk reads JSON
   outputs to work around it (`core/src/bb/ultra_honk.rs:323`).
8. The SDK sends its pinned stdlib version as `x-aztec-version` (`packages/sdk/src/lib/presto-prover.ts:79-84`,
   `packages/sdk-core/src/lib/presto-transport.ts:944`). presto-noir sends `bbVersion`, which defaults to
   `TESTED_BB_VERSION` (`packages/sdk-noir/src/lib/tested-versions.ts:6-23`).
9. `release-plan.ts:118-121` refuses to reuse a published manifest-versioned package whose `pkg.dir`
   changed since its tag. sdk-core, sdk-noir and banners are unchanged since `1.2.1`, `2.0.0-rc.1`
   and `1.2.0`.
10. The SDK's publish version is Aztec-derived (`scripts/get-sdk-publish-version.ts`): the next
    publish is `6.0.0-rc.1.1` with no manifest bump. `_publish-npm.yml` defaults to `testnet`.
    The npm dist-tags are `latest` 5.2.0-revision.5 and `testnet` 6.0.0-rc.1.
11. `build-test-bundle.yml`:
    - `platform=all` covers linux-x86_64, macos-arm64 and windows-x86_64 with packaged acceptance;
    - `macos-x86_64` is a separate choice (`:39-40`);
    - it runs from any ref and is secretless.
12. `packages/presto/README.md:112-116` already explains the version model in depth.

**Inferences (unverified — attack these):**
- Agents integrating Presto read the installed SDK's files and the GitHub README more than the npm
  web page. The npm page renders the `latest` (v5) README and stays unchanged here.
- Some agents fetch `/llms.txt`; it harms none.
- bb 6.0.0-rc.1 behaves like 5.2.0 on every route path. Every real-`bb` PR lane on `main` runs it,
  and packaged acceptance proves natively with it.

**Approval (2026-10-02):** all four asks approved, A1 = `1.2.0-rc.1`. On A4 the owner noted that
`testnet` already carries 6.0.0-rc.1. npm versions are immutable, so the docs publish is the next
revision, `6.0.0-rc.1.1`.

**Asks (resolved at the approval gate):**
- **A1 — prerelease version.** Recommended `1.2.0-rc.1`: the bundled Aztec line changes (v5 dApps now
  download on first use), and a minor bump keeps 1.1.x free for a v5-bundled patch. Alternative:
  `1.1.4-rc.1`, which matches the committed source. Neither is mechanically wrong (both exceed 1.1.3).
- **A2 — `llms.txt` on presto.build.** Recommended yes.
- **A3 — merge and app prerelease.** Approval authorizes the squash-merge once Codex converges and
  checks are green, then the prerelease dispatch from the merge commit.
- **A4 — publish the SDK docs to npm `testnet`.** Recommended yes: after the app prerelease finishes,
  run `release-sdk.yml packages=presto` (publishes `6.0.0-rc.1.1`, reuses core 1.2.1), so installed
  v6 SDKs carry the new `AGENTS.md`/`SKILL.md`. Its `bump-playground` PR auto-merges as usual.
  Without A4 the fix reaches only GitHub and presto.build until the next SDK release.

## Plan audit

**Codex (GPT-6.1 Sol, `high`), round 1: APPROVE WITH CHANGES.** Every claim was re-checked against
the repo.

Accepted:
1. *Headless releases bundle no `bb`* (high): bundle claims are scoped to the desktop app, and the
   notes and docs say how headless gets one.
2. *npm needs a publish* (high): confirmed, and widened. Editing the manifest-versioned READMEs
   forces bumps, and a bumped core breaks the production playground until the SDK is republished.
   Those READMEs move to a follow-up. The SDK's own publish needs no bump and becomes A4.
3. *Phase 1 proves less than advertised* (medium): two additions. A `macos-x86_64` dispatch, and an
   independent `bb --version` on the Linux candidate's sidecar. Run ids are recorded. Signing,
   stamping and updater checks are named as release-time gates.
4. *Overclaims* (medium): the wording now says "published `bb`", needs a digest, and names tested
   pairings. The Windows limit is scoped to transaction proving. Noir's `bbVersion` default is
   described as it is.
5. *`/health` diagnostic-only* (medium): the docs say the inventory is bundled plus cached, appears
   on detailed bodies only, and proves neither integrity nor compatibility. `llms.txt` links the
   security model and the ask-first rule.
6. *Missed first-read surfaces* (medium): the landing callout, the app README lead, and the release
   notes' placement were added.
7. *Placement not enforced* (low): tests check the lead (before the first `##`) and anchors.
8. *Release preflight* (medium): it checks queued/waiting/pending runs too, captures the merge SHA,
   and verifies the dispatched run's `headSha`.

**Round 2 (resumed): APPROVE WITH CHANGES.** All verified and accepted:
1. *Digest wording overstated authentication* (medium): the section now says GitHub's digest comes
   from the same publisher (`core/src/versions/release_metadata.rs:154`, SEC-02).
2. *The unchanged-package gate compared all three directories with each tag* (medium): it now
   compares each tag with its own directory. A `release-sdk.yml` dry run before A4 covers the
   shared inputs and provenance.
3. *Routing identity differs from binary identity* (medium): routing follows the compiled label
   (`core/src/server/prove.rs:75`). Packaged acceptance now asserts `/health.aztec_version` equals
   the SDK's version, beside the Linux `bb --version`. This reverses round 1's one rejection.
4. *SDK publish preflight* (medium): it checks SDK release runs and open pin PRs, runs a dry run,
   and verifies the dispatch SHA and planned version.
5. *Noir discovery* (low): the pointers go into the SDK README section that the presto-noir README
   already links.

## Phases

### Phase 1 — The release says what it bundles, and the bundle is proven ✓

Rewrite and move the notes section in `release-presto.yml` and pin it in `release-contract.test.ts`.
Add the `/health.aztec_version` assertion to `presto.packaged-e2e.spec.ts`. Push the branch (no PR)
and dispatch:
- `gh workflow run build-test-bundle.yml --ref worktree-bundle-v6 -f platform=all`;
- `gh workflow run build-test-bundle.yml --ref worktree-bundle-v6 -f platform=macos-x86_64`.

Download the Linux candidate artifact, extract its `bb` sidecar, and run `bb --version`.

Assumptions for this phase: Facts 1-6, 11; the bb-behaviour inference.

**Validation gate:**
- Commands, in order:
  1. From `packages/presto`: `bun test scripts/release-contract.test.ts`.
  2. `bun run lint`, `bun run test`, `bun run lint:actions`.
  3. `gh run watch <id>` for both runs.
  4. `gh run view <id> --log` for both runs.
  5. `gh run download` for the Linux artifact.
- Pass:
  - Every command exits 0.
  - Each run's `headSha` is the pushed commit.
  - Every build job and packaged acceptance concludes `success`.
  - Every build log shows `Aztec bb version: 6.0.0-rc.1`.
  - The Linux sidecar reports 6.0.0-rc.1.
  - Both run ids go into `lessons/phase-1.md`.
- Not proven here: signing, version stamping, headless builds and updater smokes. Those are
  release-time gates, verified in Post-implementation step 6.
- Layers: lint, unit, packaged e2e on three OSes, Intel build.

### Phase 2 — Integrator and agent docs ✓

Write:
- the root README lead and canonical section;
- the SDK README, AGENTS.md and SKILL.md leads;
- the app README lead, `/health` and config rows;
- the landing callout sentence and `llms.txt`;
- `scripts/integrator-docs.test.ts` and the SDK contract-test additions.

Assumptions for this phase: Facts 7-10, 12; the agent-reading and `llms.txt` inferences; A2.

**Validation gate:**
- Commands, in order:
  1. The new and extended test files.
  2. `bun run lint`, `bun run test`.
  3. `bun run --cwd packages/landing build`, then confirm `dist/llms.txt` exists.
  4. For each manifest-versioned package, `git diff --quiet` from its release tag to `HEAD`, scoped
     to that package's directory only:
     - `@alejoamiras/presto-core@1.2.1` with `packages/sdk-core`;
     - `@alejoamiras/presto-noir@2.0.0-rc.1` with `packages/sdk-noir`;
     - `@alejoamiras/presto-banners@1.2.0` with `packages/banners`.
- Mutation check, restoring after each:
  - Move the presto-banners pointer in `packages/sdk/AGENTS.md` below its first `##`.
  - Remove the canonical link from the root README lead.

  Each mutant must fail its test.
- Pass: every command exits 0, both mutants fail, the built site contains `llms.txt`, and the three
  packages are unchanged since their tags.
- Layers: lint, unit (doc contracts), build.

## Post-implementation

1. `/code-review` is **off** for this plan; go straight to Codex.
2. **Codex audit.** Run `/codex high` on `gpt-6.1-sol`, passed as the fifth argument of
   `run-codex.sh` and of every `resume-codex.sh`.
   - Inputs: the net diff from `a9dbe84`, this plan, `recon.md`, and the asks.
   - Adversarial/security: could any doc or `llms.txt` line lead an agent into an unsafe
     integration? Does anything change what ships beyond the notes text?
   - Accuracy: every version claim, checked against the code.
   - These two rules, verbatim:
     - *"Report bugs and small, targeted improvements only. Do not propose speculative abstractions,
       extra configuration surface, new layers, or rewrites — the smallest change that fixes each real
       problem. If code works and is clear, leave it alone."*
     - *"Audit the comments for value per character. Flag any comment that narrates what the code
       visibly does, restates its line, references implementation plans / phases / reviews, or spends a
       paragraph where a sentence works — and flag places where a non-obvious invariant or constraint
       deserves a comment it doesn't have. Comments are permanent context every future reader, human or
       LLM, pays to re-read: they must be few, dense, and exact."*
3. **Fix loop.**
   - Each round: verify every finding against the repo, apply the accepted ones, commit, log the round
     in `lessons/phase-2.md`, and resume the same session with the fix diff.
   - Repeat until a round reports no new material findings.
   - If findings are still material after 3 rounds, stop and surface them.
   - A fix touching the build path (`copy-bb.ts`, `setup-presto`, `tauri.conf.json`, `Cargo.toml`)
     re-runs the Phase 1 dispatches. Docs, tests and the notes text do not.
4. **Delivery** — single arc: `gh pr create`, this plan's first PR. The body carries the
   candidate-bundle run ids and the Codex verdict.
5. **Close-out**, as the PR's final commits:
   - Write `## Outcome` directly after the front matter: date, status, PR number, the candidate-bundle
     runs, the prerelease and npm publishes to follow, what was dropped, and a line retiring this
     plan's `/goal` and `/loop` seeds.
   - Update `implementations-plan/follow-ups.md`:
     - delete "The next app release should bundle v6 `bb`";
     - amend the cold-download entry to say v5 dApps now hit it too;
     - add "presto-core, presto-noir, presto-banners READMEs: add the version-model and presto-banners
       lead notes at each package's next release".
   - `implementations-plan/lessons.md` is over its ~8 KiB budget: add only by replacing, or add nothing.
   - Archive the plan in its own commit:
     `git mv implementations-plan/bundle-v6 implementations-plan/archive/bundle-v6`. Repair broken
     links and move the index line to `archive/index.md`.
   - Run `gh pr checks --watch`. When green, squash-merge with `--match-head-commit` (A3), after
     `gh run list --workflow release-presto.yml --json status` shows no run queued, waiting, pending or
     in progress.
6. **App prerelease** (A3), from the merged `main`:
   - Record the merge SHA.
   - Repeat the run-status preflight.
   - Run `gh workflow run release-presto.yml --ref main -f version=<A1>`.
   - Immediately confirm the new run's `headSha` equals the merge SHA; cancel on mismatch.
   - Watch it, then verify per `docs/RELEASE_RUNBOOK.md` §2:
     - the tag resolves to the merge SHA;
     - 16 assets;
     - `isPrerelease` true and not GitHub Latest;
     - the macOS, Linux and Windows smokes passed;
     - the notes open with the new "Aztec versions" section naming 6.0.0-rc.1.
   - Never `mode=promote-only`. A failed run is fixed forward with the next `-rc.N`, never by deleting.
7. **SDK docs publish** (A4), after step 6 finishes:
   - Preflight:
     - no `release-sdk` run is queued, waiting, pending or in progress;
     - no `bump-playground` pin PR is open;
     - record `main`'s SHA;
     - run `gh workflow run release-sdk.yml --ref main -f packages=presto -f dry_run=true`. It must
       plan `presto` publish and `presto-core` reuse with no deferred check.
   - Run `gh workflow run release-sdk.yml --ref main -f packages=presto`. Confirm the run's
     `headSha` is the recorded SHA; cancel on mismatch.
   - Verify:
     - the planned version (expected `6.0.0-rc.1.1`, registry-derived) is on `testnet` with
       provenance;
     - `latest` is still 5.2.0-revision.5;
     - its tarball contains the new `AGENTS.md`;
     - the `bump-playground` PR merges and the playground deploys.
8. **Teardown**, without asking, once
   `git fetch -q origin && git cat-file -e origin/main:implementations-plan/archive/bundle-v6/plan.md`
   succeeds: `ExitWorktree` with `keep`, then `agent-worktree done bundle-v6 --merged`. Report what it
   removed, or relay a refusal and stop.

## Delivery

| Arc | Phases | Stacks on | `/code-review` |
|---|---|---|---|
| `worktree-bundle-v6` (one PR) | 1, 2, close-out | `main` | off |

Single arc: one branch and a plain `gh pr create`, with the close-out as its final commits. The app
prerelease and the SDK publish follow the merge.

## Seeds

ELI5: https://claude.ai/artifact/6KDteyVsQPP3HeJz5np7XB (source: `implementations-plan/bundle-v6/eli5.html`,
gitignored; redeploy that path to keep the URL).

Final (approved scope: A1 `1.2.0-rc.1`, A2–A4 yes). Recommended: `/goal`.

```
/goal Phases 1 and 2 marked ✓ in implementations-plan/bundle-v6/plan.md (the phase headers in the file, not the chat or task list), each backed by its validation gate as written in plan.md reported passing in the transcript — Phase 1: both build-test-bundle.yml runs (platform=all and macos-x86_64) green at the pushed SHA, every build log showing `Aztec bb version: 6.0.0-rc.1`, packaged acceptance asserting /health.aztec_version equals the SDK's Aztec version, the extracted Linux sidecar's `bb --version` reporting 6.0.0-rc.1; Phase 2: the doc contract tests passing, both mutants failing, `bun run --cwd packages/landing build` producing dist/llms.txt, and packages/sdk-core, packages/sdk-noir, packages/banners each unchanged since their own release tag; `LESSONS_FILE=implementations-plan/bundle-v6/lessons/phase-N.md` printed for each phase; /code-review NOT run (code_review: off); the codex fix loop on gpt-6.1-sol at high converged over the whole diff from a9dbe84, evidenced by a resumed codex pass reporting no new material findings quoted in the transcript; exactly one PR exists, opened only after convergence (`gh pr view` output), whose final commits include the archive move (`git show --stat` of that commit); `bun run test`, `bun run lint` and `bun run lint:actions` exit 0 in the transcript. Then (approved asks A3, A4): the PR squash-merged with --match-head-commit while no release-presto run is queued or running; the release-presto prerelease 1.2.0-rc.1 dispatched from the merge SHA and verified per plan.md Post-implementation step 6 (16 assets, isPrerelease, tag at the merge SHA, notes opening with the Aztec versions section), never promoted; the SDK testnet publish (expected 6.0.0-rc.1.1) dry-run, dispatched and verified per step 7; the worktree torn down per step 8.
```

The `/loop 15m` fallback is in the ELI5 Artifact; it carries the same gates and limits.

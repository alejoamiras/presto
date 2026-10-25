---
plan: ci-1
tier: light
driver: claude-code
claude_model: opus
codex_model: sol
code_review: off
explainer: off
eli5_mode: skipped (orchestrator-owned)
quality_bar: production
trunk: main
base: f8a9f3b
issues: none
asks: [ask3]
---

# ci-1: land #169's action bumps with a reviewed re-pin of the App-key tripwire

Dependabot's #169 moves `actions/create-github-app-token` from v3.2.0 to v3.3.0 and
`dtolnay/rust-toolchain`'s `v1` commit. Its required checks fail on one test that pins the commit of
the action holding the release-bot App key. This plan applies #169's diff byte for byte, records a
review of the new action commit, re-pins the two test strings, and ships one PR that supersedes #169.

Size: about 265 lines against the `light` target of 150. The written-out Post-implementation steps
(no repo standard to cite) and the review evidence, which is the deliverable, account for the excess.

## Outcome & Quality Bar

**For whom.** The maintainer who merges an action bump that receives `RELEASE_BOT_PRIVATE_KEY`, and
the next reader of `verified-sites-workflows.test.ts`, who must trust that each pin there was reviewed.

**Excellent.**
1. The pinned commits are the upstream tags' commits, and the PR body says, in two or three lines,
   what the new App-token commit changes at run time (endpoints, inputs, outputs, key use, post-step).
2. The PR's workflow diff equals #169's line for line, and only the two pinned strings in the test
   change, so the tripwire still fails on the next unreviewed commit.

**Good enough.** No change to how the steps use the action (the deprecated `app-id` input stays).
No runtime exercise of the token before merge (Ask A1).

## UI impact

Recorded owner decisions for this lane: **none: no screen changes.** The change touches CI files and
one test; no surface a person sees.

## Issue and ask map

| Item | Arc | Disposition |
|---|---|---|
| issues | none | the lane brief names none |
| ask3 | a1 | `Delivers ask3`; the PR body also says `Supersedes #169` (the lane never touches #169 itself) |

## Architecture & Implementation

- **File-level change map.** Modified: #169's nine `uses:` lines in eight files (`recon.md` lists
  them), applied from its commit 49110f1; the two strings at
  `scripts/verified-sites-workflows.test.ts:105-106`, the only literal app-token SHA in any test.
  Added: this plan folder. Flow: Phase 1's steps.
- **Alternative not taken.** Derive the SHA in the test from the workflow text (or `action-pins`'
  parser): it removes the edit, but then the test passes on any commit, which removes the review it
  exists to force. Cherry-picking 49110f1 was also rejected: its long Dependabot body fails the
  repo's commit-msg lint, and a split commit leaves a red test inside the branch.
- Key interfaces, schemas, algorithms: N/A.

## Security & Adversarial Considerations

- **Threat model.** The attacker is whoever controls the upstream action's repository or release
  process. The step receives `RELEASE_BOT_APP_ID` and `RELEASE_BOT_PRIVATE_KEY` and mints a token with
  `contents`/`pull-requests`/`issues: write`. A hostile commit could send the key or token elsewhere.
- **What the review found (F3–F6).** Both pins are the upstream tags' commits. In the App-token
  bundle the action's own code is unchanged, and so are the inputs our workflows pass, its state,
  outputs, masked values, post-step (`DELETE /installation/token`), JWT signer and base-URL use.
  Changed code that runs: the bundler's `__commonJS` helper (resets a module whose init throws),
  the token-response parsing in `@octokit/request`, nested `undici` internals, and an OAuth-only
  GHE.com URL branch this action's JWT path does not take. No new external sink for the key or the
  token was found in those paths (I2). `rust-toolchain`'s commit does not touch `action.yml`.
- **Residual trust.** The upstream action still receives the raw App private key; requested
  permissions bound the minted token, not what hostile code could mint with the key. SHA pinning plus
  this reviewed test edit is the control; an immutable, signed release proves identity, not intent.
- **Least privilege.** No permission, input or secret changes. The pin stays a full SHA with an exact
  label, so `action-pins.test.ts` still binds it.
- **Supply chain.** Dependabot's 7-day cooldown held: v3.3.0 was published 2026-10-12. Crypto, input
  validation, npm: N/A (no package change).

## Assumptions

### Facts (verified 2026-10-25)

- F1. #169 = one commit 49110f1, merge base f8a9f3b (`main`); 9 `uses:` lines in 8 files.
- F2. #169's red checks: "Audit dependencies" (BLOCKED only on happy-dom GHSA-834v-8h66-3h79), and
  `test:scripts` in presto "Lint" and the sdk and sdk-noir "Unit Tests", each the single test at
  `verified-sites-workflows.test.ts:103`; the three Status jobs fail as a consequence. All else passes.
- F3. `gh api repos/actions/create-github-app-token/git/ref/tags/v3.3.0` → commit 64ab729a (so does
  `v3`); `v3.2.0` → bcd2ba49. Release v3.3.0: immutable, published 2026-10-12T23:42Z by the releaser
  bot; commit signature valid. `dtolnay/rust-toolchain` `v1` → 683b588c.
- F4. Compare v3.2.0…v3.3.0: 13 commits, all signature-verified. `action.yml` adds three permission
  inputs, drops `permission-team-discussions` and lets Copilot seat management be `read`; outputs
  and `runs:` unchanged. Our six steps pass only `app-id`, `private-key` and `permission-contents`,
  `-pull-requests`, `-issues`.
- F5. In `dist/main.cjs` and `dist/post.cjs` the action's modules (`lib/*.js`, `main.js`, `post.js`)
  differ only in the licence trailer; the preamble's `__commonJS` helper gains a reset on a throwing
  init. Set diffs of URL literals, route strings, env reads and `require`s are indexes, not proofs;
  Codex spot-read the dependency deltas (Audit verdicts). Bundled moves: `@octokit/auth-app`
  8.2.0→8.3.1 (only its version string), `@octokit/oauth-methods` (a GHE.com OAuth base-URL branch),
  `@octokit/request` 10.0.8→10.0.16 (octet-stream never decoded as text),
  `fast-content-type-parse`→`content-type`, `json-with-bigint` 3.5.12, `p-retry` 8.0.1, nested
  `undici` 6.24.0→6.29.0.
- F6. `dtolnay/rust-toolchain` e2a55d2f…683b588c: one commit, "Add 1.99.1 patch release", touching
  only `scripts/update-revs.sh`.
- F7. On `main`, the two pin tests pass (17 tests). No doc names either version or SHA.
- F8. `app-id` carries `deprecationMessage: "Use 'client-id' instead."` in v3.2.0 and v3.3.0 alike.

### Inferences

- I1. No PR-triggered workflow mints the App token, so PR CI cannot run the new action. All five
  minting workflows are dispatch-only, except `sign-verified-sites.yml` on a push to its two paths.
- I2. No new external sink for the key or the token was found in the reviewed paths: the unchanged
  JWT signer (`universal-github-app-jwt` 2.2.0), Octokit's configured base URL and native `fetch`,
  `@actions/http-client`'s unchanged proxy choice, and the unchanged post-step. Not a proof of
  harmlessness (see Residual trust).

### Asks (working assumption in force; the orchestrator may override)

- A1. Run "Release Bot Token Check" to exercise v3.3.0? It pushes a branch and opens a throwaway PR
  with the App token. **Assumption:** the lane does not dispatch it; the PR body offers it as a
  post-merge check for the owner.
- A2. The `app-id` deprecation (F8) predates this bump, has no removal date, and changing it is a
  workflow change outside scope. **Decision (Codex R1):** a disposition line in the Outcome, no issue;
  an issue only if the owner accepts the migration as work.

## Phase 1 (a1): apply #169 and re-pin the tripwire ✓

Warning: change no line that #169 does not change, except the two test strings.

1. Run `git fetch origin pull/169/head`. Check that `FETCH_HEAD` is 49110f1 and that
   `git merge-base origin/main FETCH_HEAD` is `main`'s head. If #169 moved, re-run F3–F6 on its new
   commits first, and use its new head and base for 49110f1 and f8a9f3b everywhere below.
2. Run `git diff f8a9f3b 49110f1 | git apply --index -` (explicit SHAs: any later fetch rewrites
   `FETCH_HEAD`).
3. Run `bun test scripts/verified-sites-workflows.test.ts`. It must fail on the one test, with only
   the two app-token strings in the diff (the tripwire control).
4. Replace `bcd2ba49218906704ab6c1aa796996da409d3eb1` with `64ab729a6294000f5aa4a4bc0b73d1f32bc45510`
   at `scripts/verified-sites-workflows.test.ts:105-106`. Change nothing else in the file.
5. Commit once: `chore(ci): bump create-github-app-token to v3.3.0 and rust-toolchain v1`, with the
   review summary in the body.

**Validation gate.** Run from the worktree root, one command per line. `MB` makes the scope checks
hold before and after the close-out merge; the expected tree is `MB` plus #169's patch.

```sh
git fetch origin main && MB=$(git merge-base origin/main HEAD)
T="${SCRATCH:?set SCRATCH to the lane scratch dir}/expected.index"
OLD=bcd2ba49218906704ab6c1aa796996da409d3eb1; NEW=64ab729a6294000f5aa4a4bc0b73d1f32bc45510
bun test scripts/verified-sites-workflows.test.ts scripts/action-pins.test.ts
rm -f "$T" && GIT_INDEX_FILE="$T" git read-tree "$MB" && git diff f8a9f3b 49110f1 -- .github | GIT_INDEX_FILE="$T" git apply --cached && GIT_INDEX_FILE="$T" git diff --cached --exit-code HEAD -- .github
git show "$MB":scripts/verified-sites-workflows.test.ts | grep -c "$OLD"
diff <(git show "$MB":scripts/verified-sites-workflows.test.ts | sed "s/$OLD/$NEW/g") <(git show HEAD:scripts/verified-sites-workflows.test.ts)
git diff --name-only "$MB" HEAD -- . ':!implementations-plan' | wc -l
git grep -nE 'bcd2ba49218906704ab6c1aa796996da409d3eb1|e2a55d2ffb04f378e9626c28d38b36d230d1e12f' -- . ':!audit' ':!implementations-plan'
bun run test && bun run lint:actions
```

Pass criteria, in order: 17 pass, exit 0; the tree check exits 0 (a failed `git apply` means `main`
moved those lines: stop and report); `2`; no output; `9`; no output (exit 1); exit 0. Layers: lint,
typecheck, unit. No e2e spec, no Rust source and no `cfg` code is touched. `SCRATCH` is the lane's
scratch directory from the lane brief: outside the repo, never `/tmp`.

## Delivery

Single arc, single PR, no stack. a1 = Phase 1 + the close-out, on branch `worktree-ci-1` (it holds
the plan commit). Base `main`. `code_review: off`. Parallelism: N/A (one phase).

## Post-implementation

There is no `implementations-plan/README.md` standard in this repo, so the steps are written out.
While implementing: comments state invariants only (this change adds none); log attempts in
`lessons/phase-1.md`; run `agent-worktree status ci-1 "phase 1 green: codex loop"` at the gate;
stop after 3 failures on one step.

1. **Codex audit.** Write the prompt to a `mktemp` file under `$SCRATCH`. Run
   `~/.claude/skills/codex/scripts/run-codex.sh <prompt> <worktree> high read-only gpt-6.1-sol` and
   keep the `CODEX_DIR` it prints.
   Send `git diff f8a9f3b HEAD`, this plan, the adversarial ask, the line "Never open, list or search
   `~/.agents/orchy/`", and the two rules below verbatim. One Opus `general-purpose` diff review runs
   alongside round 1.
   - *No over-engineering:* "Report bugs and small, targeted improvements only. Do not propose
     speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest
     change that fixes each real problem. If code works and is clear, leave it alone."
   - *Comment quality:* "Audit the comments for value per character. Flag any comment that narrates
     what the code visibly does, restates its line, references implementation plans / phases /
     reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious
     invariant or constraint deserves a comment it doesn't have. Comments are permanent context
     every future reader, human or LLM, pays to re-read: they must be few, dense, and exact."
2. **Fix loop.** Verify each finding against the tree; fix, commit, log the round in
   `lessons/codex-loop.md`. Then resume the same session with the fix diff (or "no changes; verify")
   and the same rules: `~/.claude/skills/codex/scripts/resume-codex.sh "" <followup> "$CODEX_DIR" high gpt-6.1-sol`.
   Run at least one resumed round, even after a clean round 1; stop at a resumed round with no new
   material finding. A fix that adds state, a lifecycle, a protocol, a recovery policy or a public
   contract is a plan change: stop and report. Hard stop at 3 rounds (`ARC_FAILED`).
3. **Delivery.** Rerun the gate on the final head. `git push -u origin worktree-ci-1`. Then
   `gh pr create --base main --title "chore(ci): bump create-github-app-token to v3.3.0 and rust-toolchain v1" --body-file <file>`.
   The body: what changed and why; the review in two or three lines (F3–F6); the gate results; that
   the audit is red on `main` for happy-dom and stays red here; Ask A1's offer; `Supersedes #169`;
   `Delivers ask3`; the Claude Code footer. No label. Never comment on, close or approve #169.
4. **Close-out**, as the PR's final commits: merge `origin/main` and read what changed in `lessons.md`
   and `archive/index.md`. Write `## Outcome` after the front matter (date, status, PR, `Known limits:`,
   `Open items:`, a line retiring the seeds, A2's disposition line). Promote a lesson only if it
   would bite another task. File any open item in its home (table below). Delete `STATUS.md`. Run
   `git mv implementations-plan/ci-1 implementations-plan/archive/ci-1` in its own commit, add one
   line to `archive/index.md`, add no row to `index.md`. Rerun the gate and `git push`. Then run
   `timeout 590 gh pr checks <n> --watch` in the foreground, at most three times; exit 124 means
   still pending: report it. The happy-dom audit failure is expected and is not lane work. Do not merge.

| Situation | Home |
|---|---|
| Work inside this implementation | this `plan.md` and the PR |
| Actionable work that outlives the plan | a GitHub issue with a domain label and a `Record` link to the archived plan |
| Needs a product call, or waits on something outside the repo | an issue labelled `owner-decision` or `blocked:external` |
| A suspected exploitable weakness | a private draft security advisory; `plan.md` records only "tracked privately" |
| Rejected, superseded or already done | a disposition line in the Outcome |
| A path that needs unsupported conditions, or whose consequence does not matter | a `known-limit` issue, closed as not planned at once |
| Knowledge that prevents a repeat | `implementations-plan/lessons.md` |

5. **Teardown after the merge** (the session the orchestrator resumes): if
   `git fetch -q origin main && git cat-file -e FETCH_HEAD:implementations-plan/archive/ci-1/plan.md`
   passes, run `agent-worktree done ci-1 --merged` and report its output; never force past a refusal.
   This session started inside the worktree, so there is no `ExitWorktree`.

**Post-implementation hardening:** none.

## Audit verdicts

**Codex R1** (gpt-6.1-sol, high): `conditional approve`. Codex re-read the tags, all eight cached
upstream files against their git blobs, the bundles and the gate commands. All findings adopted:
- I2 overclaimed (demonstrated review gap): marker extraction skips the preamble (`__commonJS`
  changed) and literal sets miss the OAuth GHE.com URL branch. Codex spot-read the deltas: no new
  sink. Fix: I2 narrowed, both changes and the residual trust recorded in Security.
- "Inputs unchanged" contradicted F4. Fix: "inputs our workflows pass".
- The `grep '^[-+] '` equality gate is lossy (demonstrated: an extra workflow edit passed it). Fix:
  the exact expected-tree check and the exact test-delta check.
- The close-out merge would break a gate fixed at f8a9f3b (plausible). Fix: the gates use `MB`.
- A2 issue filing creates an obligation with no requirement behind it. Fix: disposition line.
- A1 confirmed: no dispatch inside the lane. `git grep` no-match exits 1: noted in the gate.

**Final fresh Codex pass** (new session, plan plus this ledger): round 1 `conditional approve`;
Codex re-checked the tags, release, #169's head and the eight upstream blobs live. All adopted:
- Wrapped inline commands broke when copied raw (demonstrated with `bash -n`/`zsh -n`). Fix: the
  gate is one fenced block, one command per line; the `git mv` is on one line.
- The resume step lacked its invocation, and the seed needs a resumed clean pass (demonstrated).
  Fix: the exact `resume-codex.sh` call and at least one resumed round.
- `gh pr checks --watch` had no bound (plausible). Fix: `timeout 590`, at most three times.

Round 2 (resumed): `VERDICT: approve`. No regressions.

## Seeds (drafts; not run — the orchestrator owns execution)

```
/goal Phase 1 of implementations-plan/ci-1/plan.md is marked ✓ with its validation gate reported passing in the transcript; LESSONS_FILE=implementations-plan/ci-1/lessons/phase-1.md printed; /code-review NOT run; the Codex fix loop converged (a resumed pass with no new material finding quoted); the PR against main exists (gh pr view) with "Supersedes #169" and "Delivers ask3", created after the loop; the close-out archive-move commit shown with git show --stat; bun run test and bun run lint:actions exit 0.
```

```
/loop 15m Drive implementations-plan/ci-1 forward per its plan.md: reality check (plan.md, lessons/, git status, gh pr view), then the next pending step; run its gate; Codex loop before any PR; never merge, never touch #169; stop when the PR is open, archived and its checks are reported.
```

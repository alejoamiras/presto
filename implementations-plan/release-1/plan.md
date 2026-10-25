---
plan: release-1
tier: light
driver: claude-code
claude_model: opus
codex_model: sol
code_review: off
explainer: off
eli5_mode: skipped (orchestrator-owned)
quality_bar: production
trunk: main
baseline: 80b562e
---

# release-1: deadlines for the release scripts' registry calls; no dead rollback allowance

One arc, one PR: **a1** closes #132 and #133. Asks: none. **UI impact: none.** The recorded owner
decision is "none: nothing a person sees changes". The orchestrator's call on #133 is "drop the dead
allowance". Evidence: [`recon.md`](recon.md). Size: about 290 lines against the 150-line `light`
target, because of the one-instruction-per-line layout and the verbatim fix-loop rules; no
restatement is left to cut.

## Outcome & Quality Bar

For: the maintainer who reads a failed `release-sdk.yml` run or Cloudflare playground build, and
the next agent who edits a release script.
- **Excellent**:
  - Each registry call in the release scripts ends within the existing 180 s budget when a registry
    or proxy accepts the connection and never answers.
  - The error names the command or URL, in the `gave no answer within` form the runbook already
    tells the operator to re-run on (`docs/RELEASE_RUNBOOK.md:617`).
  - The repository has one deadline and one bounded spawn. A test refuses a new direct npm spawn in
    those scripts.
  - Rollback and forward promotion check the same workflow. Only the signer list differs.
- **Good enough**: the shell steps' registry calls keep their job's `timeout-minutes` ceiling. They
  stay open work (see Scope).

## Assumptions

**Facts** (verified at 80b562e):
1. The only bounded spawn is `registry-consistency.ts:33-51` (`NPM_TIMEOUT_MS`, `run`). Its message
   is pinned at `registry-consistency.test.ts:87-88`.
2. Each #132 site is still unbounded: `release-plan.ts:279`, `sdk-release-verification.ts:46,140`,
   `published-playground.ts:114`, `_publish-npm.yml:346`. One #132 claim does not hold:
   `release-plan.ts` "runs most npm calls through a 180 s deadline". None of its own spawns has
   one. Only `auditSignatures`, behind `verifySdkPackageSignatures`, is bounded.
3. Consumers may not contain `registry-consistency` (`sdk-release-contract.test.ts:278-288`).
   `sdk-release-verification.ts` would form an import cycle with it.
4. The credentialed-job guard (`sdk-release-contract.test.ts:72-96,240-257`) has two limits:
   - It checks `run(` calls only in the file that defines `run`.
   - Its `view` rule refuses `--json`.
5. `verify` runs `auditSignatures` (via `verify-sdk-package-signatures.ts`) before the shell step
   "Verify a fresh registry install". `auditSignatures` already does the same work: a fresh
   directory, the same npm, the same four flags, and an exact-version check, inside 180 s
   (`registry-consistency.ts:103-130`). The shell step (`_publish-npm.yml:340-352`, from #32) only
   repeats it.
6. #133 holds:
   - `RELEASE_IDENTITY.buildConfig` is `release-sdk.yml` for every signer, and
     `bindToSigningIdentity` requires the statement to name it (`provenance-identity.ts:28-37,
     175-191`).
   - `publish-testnet.yml` signed no npm publication (`archive/presto-verifier-identity/plan.md:136`).
   - Promote's rollback is the only caller that passes `allowedWorkflows`.
7. Bun 1.4.2: one `AbortSignal.timeout` aborts a stalled header and a stalled body with
   `TimeoutError` (probed). `spawnSync` sets `exitedDueToTimeout`.

**Inferences**:
- I1. 180 s is the operational budget the bounded calls already use. A single `npm view`, an
  `npm pack` or one attestation GET has not come near it, but no measured maximum exists.
- I2. Removing `allowedWorkflows` changes no reachable result. Every signed path requires
  `release-sdk.yml`, and the unsigned checks default to it.

**Asks**: none.

## Architecture & Implementation

- **Leaf `scripts/npm-command.ts`** (built-ins only). Move `NPM_TIMEOUT_MS` and its comment here.
  Split `run` into two functions:
  - `spawnBounded(command, cwd?, timeoutMs = NPM_TIMEOUT_MS)`: piped `spawnSync` with the
    deadline. On timeout it throws `<cmd> gave no answer within <n> s`.
  - `run`: `spawnBounded`, then the existing non-zero-exit error. It returns stdout.
  - `registry-consistency.ts` imports `run` from the leaf.
- **`get-sdk-publish-version.ts`** owns `npmViewJson(spec, field)` and `publishedVersions(name)`.
  `npmViewJson` uses `spawnBounded`. It classifies `E404` only on the `error.code` that npm writes
  under `--json`, so a timeout, a parse error or registry text never reads as absent. (Round 1
  tightened this: stderr echoes registry text.) `release-plan.ts` imports both
  and deletes its copies. The async, unbounded `getPublishedVersions` goes. This module is outside
  the credentialed graph, so `--json` is allowed.
- **`sdk-release-verification.ts`**:
  - `npmView` becomes `run(["npm", "view", spec, field]).trim()`.
  - The fetch-and-decode block becomes an exported `fetchAttestationStatement(url, timeoutMs =
    NPM_TIMEOUT_MS)`. One `AbortSignal.timeout` covers `fetch` and `response.json()`.
  - A `TimeoutError` from either is rethrown as `GET <url> gave no answer within <n> s`, with
    `cause` set.
- **`published-playground.ts`**: the leaf's `run(args, directory).trim()` replaces the local
  closure.
- **`_publish-npm.yml` `verify`**: delete the duplicate step (Fact 5). Keep `setup-node`.
- **`app.yml`**: add `scripts/npm-command.ts` to the `published` filter. `published-playground.ts`
  now reaches the leaf, and `cloudflare-deployment.test.ts:83-91` requires every module it reaches
  to route the production build.
- **Guard** (`sdk-release-contract.test.ts`), so that the move keeps the invariant: every subprocess
  in the `publish` job's graph is an npm read.
  - Check `run(` calls in every module of that graph.
  - Those modules may import only `run` and `NPM_TIMEOUT_MS` from the leaf, without an alias. A
    namespace or default import is refused, and so is `spawnBounded`.
  - The guard stays syntactic. Its doc comment says that, and claims no more.
- **#133**:
  - Delete `LEGACY_SDK_RELEASE_WORKFLOW`. Remove the `allowedWorkflows` parameter from
    `verifyProvenanceStatement`, `fetchAndVerifySdkProvenance`, `verifyRegistryConsistency`,
    `verifySdkPackageSignatures` and `SignedProvenanceOptions`. The check becomes
    `workflow.path === SDK_RELEASE_WORKFLOW`.
  - Promote passes only `rollback ? ROLLBACK_SIGNERS : RELEASE_SIGNERS`.
  - Runbook line 521: rollback and promotion accept only `release-sdk.yml` provenance. A rollback
    signer may also be `_publish-sdk.yml`, so presto 5.2.0 stays a target.
- **Not taken**:
  - A coreutils `timeout 180` on the shell step: it is a second copy of the deadline, on a
    duplicate step.
  - Importing from `registry-consistency.ts`: Fact 3.
  - Matching `E404` in `run`'s message: the command or the timeout text can contain it.
  - An error class that carries stderr: `spawnBounded` already returns it.
  - Keeping `allowedWorkflows` as a dead knob that widens the verifier.
  - Putting the leaf's code in `npm-packages.ts`, which owns package descriptors, not subprocesses.

## Security & Adversarial Considerations

- **Threat**: a hostile or broken registry, or a proxy, stalls a call. Today the call holds the job
  until its ceiling. After the change it fails closed and names itself. A deadline only adds a
  failure exit, and `E404` comes only from npm's error code, so no timeout becomes "absent". "Absent" matters: it
  is the input that lets release planning choose to publish.
- **Credentialed job**: the leaf joins the `publish` job's graph. The guard changes above keep the
  `run` call checks and close the alias and `spawnBounded` bypasses. It cannot stop a reviewed
  edit that hides a call (`const r = run`). This limit exists today, and the comment states it.
- **Verifier**: the #133 change only narrows what is accepted. The identity policy and the signers
  stay unchanged.
- **Supply chain**: no dependency, lockfile or permission change.

## Phases

### Phase 1 — one bounded spawn under every release-script registry call (#132) ✓
1. Create `scripts/npm-command.ts`. Move the timeout test into `scripts/npm-command.test.ts`.
   Repoint `registry-consistency.ts` and its test.
2. Move `npmViewJson` and `publishedVersions` into `get-sdk-publish-version.ts`. Update
   `release-plan.ts`.
3. Bound `npmView` and the attestation fetch.
4. Put `published-playground.ts` on `run`. Add the leaf to the `published` filter in `app.yml`.
5. Delete the duplicate `verify` step. Change the contract pin at `sdk-release-contract.test.ts:228`
   to `not.toContain("npm install")`.
6. Make the guard changes. Add three refusal cases: an imported `run(["bunx", …])`, a
   `run as execute` alias, and an imported `spawnBounded`. Confirm that all three pass on the old
   guard. Log the result in `lessons/phase-1.md`.
7. Add a contract test. Five modules may not spawn npm directly: `release-plan.ts`,
   `get-sdk-publish-version.ts`, `sdk-release-verification.ts`, `registry-consistency.ts` and
   `published-playground.ts`. The four that run npm themselves must import from the leaf.
   `release-plan.ts` must import `npmViewJson` and `publishedVersions` from
   `get-sdk-publish-version.ts`. Its local `run` stays for `git`.
- **Tests**:
  - The moved spawn-timeout test.
  - `fetchAttestationStatement` against a loopback `Bun.serve` that stalls first the header, then
    the body. Each rejects within 5 s and names the URL. The control: a served statement decodes.
  - `publishedVersions` in a child process, with a fake `npm` first on `PATH`. A fake `E404` on
    stderr gives `[]`. The control: a fake E500 for a name that contains `E404` throws, and the
    error names the command.
  - The guard cases and the contract test.
- **Validation gate**: `bun test scripts/npm-command.test.ts scripts/sdk-release-verification.test.ts
  scripts/get-sdk-publish-version.test.ts scripts/registry-consistency.test.ts
  scripts/sdk-release-contract.test.ts scripts/cloudflare-deployment.test.ts`, then
  `bun run lint:actions`, then `bun run test`.
  - Pass: exit 0 everywhere.
  - Layers: lint, typecheck, unit.

### Phase 2 — drop the dead rollback allowance (#133) ✓
1. Make the #133 deletions. Update the callers, the positional test calls and the promote regex
   (`sdk-release-contract.test.ts:296-299`).
2. Keep one explicit test: a `.github/workflows/publish-testnet.yml` statement throws
   `unexpected provenance workflow`.
3. Edit `docs/RELEASE_RUNBOOK.md:521`.
- **Validation gate**: `bun test scripts/sdk-release-verification.test.ts
  scripts/provenance-identity.test.ts scripts/promote-sdk-latest.test.ts
  scripts/sdk-release-contract.test.ts`, then `bun run test`. Pass: exit 0. Then run two greps:
  - `git grep -n "LEGACY_SDK_RELEASE_WORKFLOW\|allowedWorkflows" -- scripts docs` prints nothing.
  - `git grep -n publish-testnet -- scripts docs ':!scripts/*.test.ts'` prints nothing.

## Scope

- **In**: the five #132 sites, plus `getPublishedVersions`, the unbounded twin of
  `publishedVersions` on the same path.
- **Open follow-up** (filed before the PR opens, after a dedupe): the release path's other
  registry calls still lack a command deadline.
  - The calls: the `_publish-npm.yml` shell steps (the pack preflight `npm view`, the publish
    read-back loop and `npm publish`), `sdk-tarball-consumer.sh`, `install-legacy-sdk.ts`,
    `bun audit` and `bun install`, and Sigstore's TUF refresh.
  - The consequence is the one #132 fixes, so it stays open. It is not a known limit.
  - Without a second copy of the deadline, a fix moves those reads into the bounded TypeScript, or
    pins one shell value to `NPM_TIMEOUT_MS` in a test.
- **Out**: `promote-sdk-latest.ts`, which is local and interactive, so a person sees a hang. Also
  out: `git` and `gh` calls, and `_publish-sdk.yml` in `ROLLBACK_SIGNERS`.

## Delivery

Single arc. **a1** = Phases 1-2, branch `worktree-release-1`, one PR against `main`, `code_review:
off`. Title: `fix(release): bound the release scripts' registry calls; drop dead rollback allowance`.
Body: `Closes #132`, `Closes #133`, the validation run, and the follow-up issue number. The close-out
is the PR's final commits. There are no lanes: the two phases are short and sequential.

## Decisions (panel)

Codex round 1 (gpt-6.1-sol, high): **conditional approve**. Every condition is adopted:
- E404 on stderr only (**demonstrated** for message matching, because a timeout or command text
  can contain `E404`). The fix is `spawnBounded` plus classification on stderr. Fix round 1
  tightened it to npm's `--json` `error.code`.
- The guard alias bypass (**demonstrated**): canonical, unaliased leaf imports in the graph, and the
  comment states the guard's syntactic limit.
- Test the stalled body as well as the stalled header.
- The Phase 2 grep contradicted the kept rejection test. The grep now excludes tests.
- The PR title promised more than the PR delivers, and a closed known limit would hide work of
  #132's own value. The title is narrowed, and the remainder becomes an open follow-up.
- I1 restated as a budget, not a guarantee.

Codex agreed on Q1 (leaf, not `npm-packages.ts`), Q4 (dedupe into `get-sdk-publish-version.ts`),
Q5 (the step is an exact duplicate; neither guarantees a cold cache), Q7 (remove the parameter) and
the scope boundary. Rejected: none.

Final fresh Codex pass (new session): **conditional approve**. All three conditions are adopted:
- `app.yml`'s `published` filter lacked the leaf (**demonstrated**: `cloudflare-deployment.test.ts`
  would fail).
- Phase 1.7 required a direct leaf import from `release-plan.ts`, which makes no npm call of its
  own.
- The resume command and the order of the follow-up issue and the PR were implicit.

It also confirmed the following:
- The leaf passes `codeViolations`, because the `command` exemption covers the whole file.
- `playground-pin.ts` gains no external import.
- Only the contract pin depends on the deleted step.
- The `allowedWorkflows` call sites to touch: both `fetchAndVerifySdkProvenance` callers, its CLI,
  `verifySignedReport` and the registry forwarding, the positional tests and the promote regex.
  The 5.2.0 rollback-signer test stays.

Resumed verification of the three fixes: **approve**. No material finding remains.

## Audit verdicts (implementation)

- Codex fix round 1: **2 material findings**, both demonstrated and both fixed in `dc2d20f`.
  - E404 read from stderr, which can echo registry text. Now npm's `error.code` decides.
  - Other spellings of the leaf path, a dynamic import or a re-export bypassed the guard's
    whitelist. Specifiers now resolve by path.
  - Detail: `lessons/review-round-1.md`.
- Same-family review (Opus), run beside round 1, found two low, test-only findings. Both were
  adopted:
  - A chained literal array (`[...].map(...)`) passed the call check.
  - The contract test missed release planning's local `run(["npm", …])` and a reverted
    `Bun.spawnSync` in `get-sdk-publish-version.ts`.
  - Detail: `lessons/review-round-2.md`.
- Codex fix round 2 (resumed): **clean** on the round-1 fixes.

## Post-implementation

While implementing: write comments to the value-per-character bar, with no plan or issue
references. Log the attempts in `lessons/phase-N.md`. Run `agent-worktree status release-1 "phase N
green: <next>"` at each gate. Stop after 3 failures on one step.
1. **Codex fix loop** over `git diff 80b562e...HEAD`:
   - Write the prompt to a file under the lane's scratch directory, never `/tmp`.
   - Run `~/.claude/skills/codex/scripts/run-codex.sh <prompt-file> <worktree> high read-only
     gpt-6.1-sol`.
   - Keep the `SESSION_ID` and `CODEX_DIR` lines that it prints.
   - Send the diff, this plan, the adversarial ask, and these two rules verbatim:
     - *"Report bugs and small, targeted improvements only. Do not propose speculative abstractions,
       extra configuration surface, new layers, or rewrites — the smallest change that fixes each
       real problem. If code works and is clear, leave it alone."*
     - *"Audit the comments for value per character. Flag any comment that narrates what the code
       visibly does, restates its line, references implementation plans / phases / reviews, or
       spends a paragraph where a sentence works — and flag places where a non-obvious invariant or
       constraint deserves a comment it doesn't have. Comments are permanent context every future
       reader, human or LLM, pays to re-read: they must be few, dense, and exact."*
   - Verify each claim. Fix, commit and log the round.
   - Write the fix diff and the same two rules to a follow-up file. Then run
     `~/.claude/skills/codex/scripts/resume-codex.sh <SESSION_ID> <followup-file> <CODEX_DIR> high`.
   - Stop when a round has nothing material. Hard stop at 3 rounds.
   - A fix that adds state, a lifecycle, a protocol, a recovery policy or a public contract changes
     the plan: stop.
2. **Delivery**:
   - `bun run test` and `bun run lint:actions` must be green.
   - File the follow-up issue (Scope). Search with `gh issue list --state all --search` first.
   - Run `gh pr create --base main` with that issue's number in the body.
   - Run `gh pr checks <n> --watch` in a bounded foreground loop.
3. **Close-out** (the PR's final commits):
   - Merge `origin/main` and read the changes to `lessons.md` and `archive/index.md`.
   - Write `## Outcome` after the front matter: date, status, shipped, `Known limits: none`,
     `Open items: #<follow-up>`, and the seeds retired.
   - Promote the lessons, with the pruning pass.
   - Delete `STATUS.md`.
   - `git mv` the folder to `archive/release-1` in its own commit, then add one line to
     `archive/index.md`. Add no `index.md` row.
   - Open work goes in GitHub issues, and a suspected exploitable weakness in a private draft
     advisory.
4. **Teardown after the merge**: `git fetch -q origin main && git cat-file -e
   FETCH_HEAD:implementations-plan/archive/release-1/plan.md`, then
   `agent-worktree done release-1 --merged`. Report its output. Never force.

## Seeds (not run; orchestrator-owned)

```
/goal Phases 1-2 of implementations-plan/release-1/plan.md marked ✓, each backed by its validation gate passing in the transcript; LESSONS_FILE printed per phase; codex fix loop converged (resumed pass with no new material findings quoted); one PR against main with Closes #132 and Closes #133 opened only after that, including the close-out archive commit (git show --stat); bun run test and bun run lint:actions exit 0.
```

```
/loop 15m Drive implementations-plan/release-1 per its plan.md: reality check (plan, lessons, git status, PR checks; archived on origin/main → teardown and stop), next unchecked step, its gate, ✓, lessons; after Phase 2 the Post-implementation section; decide with codex (gpt-6.1-sol, high); never merge or publish.
```

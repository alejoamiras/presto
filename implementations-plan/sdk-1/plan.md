---
plan: sdk-1
tier: mid
driver: claude-code
eli5_mode: skipped (orchestrator-owned)
code_review: off
claude_model: opus
codex_model: sol
explainer: off
status: audited 2026-10-25 (final Codex: approve); approval is the orchestrator's
created: 2026-10-25
worktree: .claude/worktrees/sdk-1
branch: worktree-sdk-1 (a1), sdk-1-version (a2, based on a1)
base: main @ 80b562e
budget: recon 1 agent (Sonnet); code-review off; Codex gpt-6.1-sol at high (program brief)
---

## Summary

presto-core folds Presto's `500 download_failed` into the `transient` fallback reason, so a failed
`bb` download reads as a busy prover (#102). Arc a1 returns a new reason, `download-failed`, for
exactly that answer; both adapters carry it with no code change, and the reason docs and tests move
with it. Arc a2 is only the version transition (core 1.3.0, presto-noir 2.1.0), merged right before
the owner's release, because a core bump on `main` before publication turns other lanes' checks red.

## Outcome & Quality Bar

**For whom.** A dApp developer who reads `ProveOutcome.reason`, presto-noir's
`PrestoUnavailableError.reason`, or the SDKs' LogTape output (category `["presto"]`), in front of a
proof that went to WASM, who needs to know why.

**What excellent looks like.**
1. A `500 download_failed` gives `reason: "download-failed"` on both routes (`/prove`,
   `/prove/ultra-honk`). A `500 prove_failed`, `408`, `413`, `429` (also
   `download_budget_exhausted`) and `503` still give `transient`. A test pins each side.
2. The reason docs match the code: the `FallbackReason` TSDoc, the core README's list of
   conditions, presto-noir's reason table, and the Aztec SDK README and skill. No doc calls the
   failure permanent or tells the caller whether to retry.
3. The log line says the download failed and names the Aztec version the client sent, which
   exposes a wrong `x-aztec-version`. It carries no free text from the server.
4. `main` stays green for every other lane until the owner releases. Then the owner merges a2 and
   dispatches `release-sdk.yml` with `packages=all`, with no other PR to write.

**Good enough.** No new phase, no new public field, no server change. The Aztec SDK's dApp-facing
API does not show the reason: option B was not chosen, so the log is its only channel.

## Scope

| Item | Arc | Notes |
|---|---|---|
| #102 SDK reports a deterministic bb download failure as a silent transient fallback | a1 | `Closes #102` |
| The version transition the lane brief names (core minor bump) | a2 | no issue; draft until the owner schedules the release |
| Asks | — | none in the lane brief |

**UI impact (a1):** none on any screen. The playground, the landing and the banners never read a
fallback reason (recon). The budget is P2-01 (owner, 2026-10-25, decision page 2, SDK fallback
reasons): **Option A**. presto-core adds the fallback reason download-failed for a 500
download_failed (a minor release).

**UI impact (a2):** none on any screen. `playground.presto.build` keeps serving its last build
until the release's pin PR merges. Budget: P2-01, as quoted above.

**Out of scope (lane brief):** any release or publish; an `onPhase` event for the download
(option B); the server's status codes and error codes; `prove_failed` and every other `transient`
case, including `429 download_budget_exhausted`; banners and playground copy.

## Architecture & Implementation

### Proposed architecture, data and control flow

1. `PrestoClient.prove` gets `TransportHttpError(500, body)` from the POST or its one HTTP retry; the
   body is read under a byte cap (`readTextBounded`, `presto-transport.ts:955`).
2. `#classifyHttpError`, where the cause is, gets a branch before the `transient` block:
   `status === 500 && code === "download_failed"` → `logger.warn("Presto could not download bb for
   this version, falling back", { status, code, aztecVersion })` →
   `fallback("download-failed")`, no phase. The `transient` block keeps `prove_failed`.
3. No adapter code changes (recon). The Aztec SDK emits `fallback`, proves in WASM and logs
   `Local proof completed (presto: download-failed)`. presto-noir does the same, or throws
   `PrestoUnavailableError("download-failed", undefined)` under `fallback: "none"`.
4. The behaviour change (a1) and the dependency-graph transition (a2) are separate PRs: a2 can only
   be green on `main` once publication follows it.

### Key interfaces

```ts
// packages/sdk-core/src/lib/types.ts — FallbackReason gains one member
  /** The presto could not download or install the `bb` release for this version (`500 download_failed`). */
  | "download-failed"
  /** A transient/capacity condition the presto itself signalled (`408`/`413`/`429`/`503`, `500 prove_failed`). */
  | "transient"
```

`ProveOutcome` keeps its shape. `phase` stays `undefined` for the new reason (option A).

### File-level change map

| Arc | File | Change |
|---|---|---|
| a1 | `packages/sdk-core/src/lib/types.ts` | new member + TSDoc; `transient` TSDoc names `500 prove_failed` |
| a1 | `packages/sdk-core/src/lib/presto-client.ts` | new branch in `#classifyHttpError` (:545-555); its TSDoc (:510-516) and inline comment |
| a1 | `packages/sdk-core/src/lib/presto-client.test.ts` | row :335 expects `download-failed`; row :336 (`prove_failed` → `transient`) stays; new row `429 download_budget_exhausted` → `transient` |
| a1 | `packages/sdk-core/README.md` | the conditions list (:58-64) names a failed `bb` download and its reason |
| a1 | `packages/sdk-noir/src/lib/presto-ultra-honk-backend.test.ts` | one row: `500 download_failed` → `download-failed`, no phase |
| a1 | `packages/sdk-noir/README.md` | a `download-failed` row in the reason table (:113-124); the `transient` row says `500 prove_failed` and names the bb download budget |
| a1 | `packages/sdk/README.md` (:358), `packages/sdk/.claude/skills/presto/SKILL.md` (:325-329) | the degrade list names the failed download, logged as `download-failed` under LogTape's `["presto"]` category |
| a2 | `packages/sdk-core/package.json`, `packages/sdk-noir/package.json` | `1.2.1` → `1.3.0`; `2.0.0` → `2.1.0` |
| a2 | `bun.lock` | the two workspace `version` lines (:124, :135) only |
| a2 | `packages/sdk-noir/README.md` | tested-pairs row `2.1.0` above :150, with the same peer, default and Presto range as 2.0.0 |
| a2 | `CLAUDE.md` | core line: `(1.2.1)` → `(1.3.0)` |
| a2 | `implementations-plan/` | the close-out |

**Not changed:** `sdk-core/src/lib/errors.ts:4` and `packages/sdk/MIGRATION.md:266-270` (they list
the statuses that degrade, which do not change; MIGRATION.md records a past release);
`sdk-noir/src/lib/errors.ts:5-7` (illustrative); `sdk-noir/README.md:104` (the 429);
`packages/presto/README.md:87` (the server's doc); the Aztec SDK's code and manifest (its version
derives from Aztec).

### Non-obvious mechanics

- **The download budget.** Every download attempt, success or failure, spends a token from two
  sliding ten-minute buckets: three per origin, six app-wide (`versions/download_budget.rs:9-13`,
  `server/prove.rs:638-646`). A full bucket gives `429 download_budget_exhausted` before any
  download, which stays `transient`: the presto learned nothing about the release. So a retried
  missing release shows `download-failed` up to three times, then `transient` (or `transient` at
  once if other origins spent the global bucket).
- **Neither permanent nor a retry policy.** `download_bb` fails for a missing release, a failed or
  rate-limited GitHub request, a digest mismatch, a size cap, an I/O error, or a cache entry a
  running proof or an eviction holds, which asks for a retry (`downloader.rs:136-178,335-352`). The
  reason names the failed stage, nothing more.
- **Log fields.** `status`, `code` and `aztecVersion`, as the `transient` line logs (:554), never the
  server's `message`. For `download_failed` that text is the presto's whole error chain, which is no
  contract, and a dApp's LogTape sinks may ship logs off the machine (tracked privately:
  GHSA-q9x2-p4gh-hw97). The `403` branch logs `message` because those are fixed server strings.
  Presto's own log keeps the detail.
- **The window a2 opens.** `published-playground.ts:139-148` requires the published adapters to pin
  the workspace core version. `app.yml` runs it (`WORKERS_CI_BRANCH: main`, :214-238) on every PR
  that touches its `published` paths (:71-87), which include release scripts lane release-1 holds.
  After a2 merges, those PRs fail `App Status` (:243-253) and `main`'s Workers Build fails, until the
  release publishes and its pin PR merges (`docs/RELEASE_RUNBOOK.md:405-410`). a1 alone opens no
  window: no check compares core source with a published artifact (Codex R2, Opus).

### Trade-offs & alternatives not taken

- **`onPhase("download-failed")` (option B).** Not chosen by the owner.
- **Keep `transient` and add a `code` field to the fallback outcome.** Rejected: P2-01 names a reason.
- **Map `429 download_budget_exhausted` to `download-failed` too.** Out of scope, and wrong: the
  budget refuses an attempt and says nothing about the release.
- **A doc-sync test that every `FallbackReason` member is in the noir table.** Rejected: the union
  has no runtime list, so it would need a new exported constant for one test.
- **Log the server's `message`** (Opus F2). Rejected on the final Codex pass (see Log fields).
- **Assert the log line in a test** (final Codex F5). Rejected: the log is not a contract, no test in
  the repo captures LogTape output, and a global `configure()` leaks across `bun test --parallel`.

## Outlines considered

- **A: one PR with code, docs and bumps.** Opus's pick: the owner then releases with no extra PR
  (`RELEASE_RUNBOOK.md:416`; `release-plan.ts:121` refuses a changed package at a published
  version). Its cost is the window above, from the merge until publication, and it can block another
  lane's required check.
- **B: one PR with code and docs; the owner's release PR bumps later (as #64 did).** `main` stays
  green, and `release-plan.ts` refuses any release that includes core until the bump lands, so the
  bump cannot be forgotten. But the lane brief gives the bump to this lane.
- **C (chosen): a1 = B's PR; a2 = only the version edits, a draft PR based on a1.** a2 is merged
  right before the owner dispatches the release. This is Codex's pick (high confidence). It also
  meets Opus's concern, because the owner still writes no PR. Cost: one draft PR that waits. Before
  a2 merges, refresh it against `main` and rerun its checks. a2 must not grow: one production-path
  file in its diff would make its own Published Playground Build fail.

## Security & Adversarial Considerations

- **Threat model.** A hostile listener on the loopback port can already send any `5xx`; now it can
  pick `download-failed` over `transient`. Both fall back, so no capability or boundary is new.
- **Input validation.** `parseServerError` accepts only strings, and the body is capped at read
  time. The branch compares `code` with one literal.
- **Log redaction.** The server's `message` stays out of the client log (see Log fields). A related
  server-side point is tracked privately: GHSA-q9x2-p4gh-hw97. It is out of this lane's scope.
- **Least privilege, crypto, supply chain, publishing.** No workflow, permission, secret, dependency
  or cryptography change; a2's `bun.lock` change is the two workspace version lines. The owner
  publishes through `release-sdk.yml` (trusted publisher, provenance).

## Assumptions

### Facts (verified 2026-10-25 against `main` @ 80b562e)

1. `#classifyHttpError` returns `fallback("transient")` for `503`, `408`, `413`, `429`, and `500`
   with `download_failed` or `prove_failed` (`presto-client.ts:545-555`). #102 cites :546-555: it holds.
2. The server renders `ProveError::DownloadFailed` as `500 download_failed`
   (`packages/presto/core/src/server.rs:698-702`; #102 cites :679-682, which drifted). It is the only
   producer of that code (`server/prove.rs:653-656`).
3. No consumer switches exhaustively on `FallbackReason`, so the new member compiles everywhere. The
   one `switch` on a reason (`playground/src/presto-status.ts:33`) reads `PrestoStatus.reason`.
4. Both adapters depend on core through `workspace:*`. `prepare-sdk-publish.ts` pins the exact
   version at pack time.
5. `release-plan.ts` refuses to reuse a published manifest version when the package's directory,
   `tsconfig.json` or its `bun.lock` slice changed since its tag (:121, :377-392). It also refuses a
   reused adapter whose published core pin differs from this run's (:190-199). So presto-noir must
   go to a new version once its README changes or core moves.
6. `bun.lock` records both workspace versions (:124, :135).
7. `presto-client.test.ts:335` pins `500 download_failed` → `transient`. Only that test pins the
   mapping. No row covers `download_budget_exhausted`.
8. The PR gates need no registry copy of an unpublished version. The tarball job packs core at its
   manifest version and installs it with `--with` (`_ts-package-ci.yml:148-159`,
   `pack-candidate.ts:128-139`). `assert-core-pin.ts` compares manifests only.

### Inferences (attack these)

1. Adding a member to an output union is a minor change for presto-core (P2-01 says "a minor
   release") and for presto-noir, whose `PrestoUnavailableError.reason` gains the value. A consumer
   with an exhaustive `switch` gets a compile error on upgrade. Semver practice treats that as minor.
2. A presto-noir consumer under `fallback: "none"` who keys on `transient` now sees a failed
   download as its own case. The reason does not say the failure is permanent.
3. `bun install` after the two manifest edits changes only the two version lines in `bun.lock`.
   Phase 2 checks this.

### Asks (proceeding on the working assumption; the orchestrator may override)

1. **When a2 merges.** Working assumption: a2 stays a draft. The orchestrator marks it ready and
   merges it only when the owner is about to dispatch `release-sdk.yml packages=all`. Outline A
   (merge at once, accept the window) is the alternative.

## Phases

### Phase 1 (a1): `download-failed` in core, carried through both adapters (#102)

Steps (tests first, so each new expectation is seen failing against the old classifier):
1. In `presto-client.test.ts`, change row :335 to expect `download-failed`. Keep row :336. Add the row
   `["429 download_budget_exhausted", 429, "download_budget_exhausted", "transient", null, null]`.
2. In `presto-ultra-honk-backend.test.ts`, add the row
   `["failed bb download (500)", { "/health": healthOk, "/prove/ultra-honk": () => proveError(500, "download_failed") }, "download-failed", null]`.
3. Run `bun run --cwd packages/sdk-core test:unit` and `bun run --cwd packages/sdk-noir test:unit`.
   Exactly the two `download_failed` rows must fail, each receiving `transient`. Record the output
   in `lessons/phase-1.md`.
4. In `types.ts`, add the member and fix the `transient` TSDoc, as in Key interfaces.
5. In `presto-client.ts`, add the branch before the `transient` block. Remove `download_failed` from
   that block. Update the method TSDoc and the inline status comment.
6. Run the two unit suites again. Every row must pass.
7. Edit the a1 docs in the change map. No doc calls the failure permanent or gives a retry policy.
8. Commit.

**Validation gate.**
- Commands: `bun run --cwd packages/sdk-core test:unit`; `bun run --cwd packages/sdk-noir test:unit`;
  `bun run lint`; `bun run test`.
- Pass criteria:
  - every command exits 0;
  - step 3 showed the two `download_failed` rows red and every other row green;
  - the core table shows `download_failed` → `download-failed`; `prove_failed` and
    `download_budget_exhausted` → `transient`;
  - the noir row passes in both modes (WASM by default; `reason === "download-failed"` and
    `phase === undefined` under `"none"`);
  - `git status --porcelain` prints nothing, and `git diff --stat origin/main...HEAD` lists no
    `package.json` and no `bun.lock`.
- Layers: lint, typecheck, unit. No e2e: no spec covers a failed download, and the classifier is a
  pure function of status and code.

### Phase 2 (a2): the version transition

Steps:
1. After a1's Codex loop converges and its PR exists, run `git switch -c sdk-1-version worktree-sdk-1`.
2. Set core to `1.3.0` and presto-noir to `2.1.0`. Run `bun install`. Then `git diff -- bun.lock`
   must show exactly the two version lines. If it shows more, restore the file and edit the two
   lines by hand.
3. Add the presto-noir `2.1.0` tested-pairs row. Change CLAUDE.md's core version. Commit.

**Validation gate.**
- Commands: `bun install --frozen-lockfile`; `bun run lint`; `bun run test`;
  `git status --porcelain`; `git diff --name-only worktree-sdk-1...sdk-1-version -- . ':!implementations-plan'`
  (once a1 has merged and `origin/main` is merged into a2, use `origin/main...sdk-1-version`).
- Pass criteria: every command exits 0, and `git status` prints nothing. The name list is exactly
  the two manifests, `bun.lock` (2 changed lines), the noir README (one row) and `CLAUDE.md` (one
  line). None of them is a `published` path in `app.yml:71-87`.
- Layers: lint, typecheck, unit.

## Delivery

| Arc | Phases | Branch | Base | PR | `code_review` |
|---|---|---|---|---|---|
| a1 | 1 | `worktree-sdk-1` (the plan commit first) | `main` | `fix(sdk-core): report a failed bb download as download-failed`; ready; `Closes #102` | off |
| a2 | 2 + close-out | `sdk-1-version`, from a1's head | a1 | `build(sdk): presto-core 1.3.0 and presto-noir 2.1.0 for the download-failed release`; draft | off |

- a2 is the top layer and carries the close-out, so the plan closes when a2 merges.
- No pushed branch is rewritten, so `gh stack sync` and `gh stack rebase` are not used: they
  force-push. When `main` moves, merge `origin/main` into a1, run its gate, and push; then merge a1
  into a2, run its gate, and push.
- After a1 squash-merges, merge `origin/main` into a2. That merge brings back
  `implementations-plan/sdk-1/` beside the archived copy: the squash adds it independently of a2's
  move. Carry any difference into `archive/sdk-1/`, then `git rm -r implementations-plan/sdk-1`.
  Commit, then check the whole `git diff origin/main...sdk-1-version`, `implementations-plan/` included.
  Run the gates, push, and run `gh pr edit <a2> --base main` if GitHub has not retargeted it.
- Parallelism: none. a2 is five small file edits.
- The orchestrator merges a1 when it is green. It merges a2 only under the Ask above.

## Post-implementation

There is no `implementations-plan/README.md` standard in this repo, so the steps are written out.
This, the two arcs and the inline table are why the plan runs about 85 lines over the `mid` target of 350.

**While implementing.** Write comments to the value-per-character bar: invariants and whys only, no
plan, phase, review or issue references. Log each meaningful attempt in `lessons/phase-N.md`. At
each gate, run `agent-worktree status sdk-1 "phase N green: <next>"`. Stop and reassess after 3
failures on one step.

1. **Codex audit, per arc at its boundary** (a1 before a2's branch exists; a2 before its PR). Write the
   prompt to a fresh `mktemp` file under the lane's scratch directory. Run
   `~/.claude/skills/codex/scripts/run-codex.sh <prompt> <worktree> high read-only gpt-6.1-sol`.
   The prompt carries:
   - the arc's diff (a1: `git diff 80b562e..worktree-sdk-1`; a2: `git diff worktree-sdk-1..sdk-1-version`);
   - this plan, its decision ledger, and the arc map ("arc N of 2");
   - the adversarial and security ask;
   - the line "Never open, list or search `~/.agents/orchy/`";
   - the two rules below, verbatim.
2. **Fix loop.** Verify each finding against the tree. Apply the accepted fixes, commit, and log the
   round in `lessons/codex-loop.md`. Resume the same session with `resume-codex.sh` and its
   codex-dir. Stop when a round has no new material finding.
   - A round fixes bugs, adds tests and makes local changes. A fix that adds persistent state, a
     lifecycle, a protocol, a recovery policy or a public contract is a plan change: stop and report.
   - A resumed round verifies. It reopens a settled point only on new evidence.
   - Hard stop at 3 rounds: then report `ARC_FAILED`.
   - *No over-engineering:* "Report bugs and small, targeted improvements only. Do not propose
     speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest
     change that fixes each real problem. If code works and is clear, leave it alone."
   - *Comment quality:* "Audit the comments for value per character. Flag any comment that narrates
     what the code visibly does, restates its line, references implementation plans / phases /
     reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious
     invariant or constraint deserves a comment it doesn't have. Comments are permanent context
     every future reader, human or LLM, pays to re-read: they must be few, dense, and exact."
3. **Cross-arc pass.** After a2's loop, open a fresh Codex session over `git diff 80b562e..sdk-1-version`
   with the cross-arc ask (the seams, duplication, drift from the plan). Run the same loop.
4. **Delivery.** Run `bun run test`, `bun run lint` and `bun run lint:actions` first.
   - a1, after its loop: `git push -u origin worktree-sdk-1`, then
     `gh pr create --base main --title <a1 title> --body-file <file>`.
   - a2, after its loop and the cross-arc pass: `git push -u origin sdk-1-version`, then
     `gh pr create --draft --base worktree-sdk-1 --title <a2 title> --body-file <file>`.
   - Each body states what changed and why and the gate results, and ends with
     `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
   - a1's body also carries `Closes #102`. a2's body carries the window and the merge rule.
5. **Close-out**, as a2's final commits:
   1. Run `git fetch origin`. Merge `origin/main` into a1, run Phase 1's gate, and push a1. Then
      merge a1 into a2. Read what changed in `lessons.md` and in the archive index.
   2. Write `## Outcome` after the front matter: date, status, what shipped (both PR numbers),
      `Known limits:`, `Open items:`, and one line that retires the seeds.
   3. Promote the generalizable gotchas to `lessons.md`, with the pruning pass.
   4. Delete the #102 entry from `follow-ups.md`, and delete `STATUS.md`.
   5. File open items in their home, using the table below.
   6. Run `git mv implementations-plan/sdk-1 implementations-plan/archive/sdk-1` in its own commit.
      Fix the links it breaks. Add one line to `archive/index.md`. Add no row to `index.md`.
   7. Rerun `bun run test`, `bun run lint`, `bun run lint:actions` and Phase 2's scope check. Push
      each branch with `git push`. Then run `gh pr checks <n> --watch` on the pushed head of each PR
      (bounded, in the foreground) and report. Do not merge.
   8. Stop. The implementing session ends here, with a2 a draft. The orchestrator owns what follows:
      refresh a2 against `main` and rerun its checks, mark it ready and merge it under the Ask,
      and resume a session for the teardown.

| Situation | Home |
|---|---|
| Work inside this implementation | this `plan.md` and the PRs |
| Actionable work that outlives the plan | a GitHub issue with a domain label and a `Record` link to the archived plan |
| Needs a product call, or waits on something outside the repo | an issue labelled `owner-decision` or `blocked:external` |
| A suspected exploitable weakness | a private draft security advisory; `plan.md` records only "tracked privately" |
| Rejected, superseded or already done | a disposition line in the Outcome |
| A path that needs unsupported conditions, or whose consequence does not matter | a `known-limit` issue, closed as not planned in the same breath |
| Knowledge that prevents a repeat | `implementations-plan/lessons.md` |

6. **Teardown after a2 merges** (the session the orchestrator resumes). Check
   `git fetch -q origin main && git cat-file -e FETCH_HEAD:implementations-plan/archive/sdk-1/plan.md`.
   If it passes, run `agent-worktree done sdk-1 --merged` and report its output. Never force past a
   refusal. This session started inside the worktree, so there is no `ExitWorktree`.

**Post-implementation hardening:** none. There is no new trust boundary.

## Decision ledger

| # | Decision | Source | Status |
|---|---|---|---|
| D1 | The reason is `download-failed`, for exactly `500 download_failed`, with no phase | P2-01; lane brief | adopted |
| D2 | The classifier branch, not an adapter mapping | draft; Codex, Opus "looks fine" | adopted |
| D3 | Outline C: a1 code and docs; a2 the version edits, a draft merged right before the release | Codex R1 F1 and R2 (C); Opus F1 (A, with the window stated) | adopted |
| D4 | Log `status`, `code` and `aztecVersion`, not the server `message` | draft; Opus F2 (log it) rejected on final Codex F1 | adopted |
| D12 | A server-side point found in the final pass is tracked privately (GHSA-q9x2-p4gh-hw97), not in a public issue | final Codex F1, round 2 | adopted |
| D13 | Push after the close-out; gates run on a clean, committed tree; the seeds stop once a2's draft is up | final Codex F2–F4 | adopted |
| D14 | No log assertion in tests | final Codex F5 | rejected (see Trade-offs) |
| D15 | Plain branches, merges and `git push`; no `gh stack sync`/`rebase` (they force-push) | final Codex R2; program hard rule | adopted |
| D5 | Tests first. Change core row :335; add `429 download_budget_exhausted` and one noir row; no union doc-sync test | Codex F3, F4; Opus F5 | adopted |
| D6 | Docs: core README, noir table, SDK README and skill (naming `["presto"]`); in a2, the noir tested-pairs row and CLAUDE.md. Not MIGRATION.md or the `errors.ts` lists | draft; Codex F5; Opus F8 | adopted |
| D7 | `429 download_budget_exhausted` stays `transient`, and the docs name the budget | lane brief; Codex F4 | adopted |
| D8 | No doc or inference says the failure is permanent or sets a retry policy | Codex F2; Opus F3 | adopted |
| D9 | presto-noir 2.1.0 is required, not optional | Opus F6 | adopted (Ask moved to Facts) |
| D10 | Gates diff against `origin/main...HEAD`, not the local `main` | Opus F7 | adopted |
| D11 | Delete only the #102 entry from `follow-ups.md`; moving that file to issues is not this lane's work | draft | adopted |

**Still disputed:** D3 (Opus preferred A without seeing C; C keeps A's benefit and drops its early
window) and D4 (Opus would log `message`; the final Codex pass showed why not).

## Audit verdicts

- **Codex R1** (gpt-6.1-sol `high`, session `01a170e7-bca3-7ac1-a2a1-350b40a84f08`): `conditional
  approve (with conditions: resolve release-timing acceptance, correct the retry inference, and fix
  regression-test sequencing)`. 5 findings (2 MEDIUM, 3 LOW), all verified and adopted (D3, D5–D8).
  Looks fine: the classifier boundary, the passthrough reuse, the rest of the doc map, noir 2.1.0.
- **Codex R2** (resumed): C, high confidence. a1 alone breaks no gate; unpublished versions in a2
  break no PR gate (`_ts-package-ci.yml:118-120,148-159`, `pack-candidate.ts:128-139`).
- **Opus (Plan agent):** `conditional approve (with conditions: tell the orchestrator about the
  post-merge CI block on other lanes' PRs (F1); fix the reason given for keeping the server message
  out of the log, and the retry wording (F2, F3); add a 429 download_budget_exhausted control row
  (F5))`. 8 findings (1 MEDIUM, 7 LOW), all verified and adopted (D3–D6, D8–D10). Looks fine: the
  line references, the code shape, no exhaustive consumers, tests that fail on old code, the
  release shape, the threat model.
- **Final fresh Codex pass** (gpt-6.1-sol `high`, new session `01a170f5-9229-7b91-ac86-f75ffe62c387`):
  `conditional approve (with conditions: correct D4's privacy claim, push and revalidate close-out,
  and fix the archived-plan continuation)`. 5 findings (3 MEDIUM, 2 LOW), all verified. F1–F4
  adopted (D4 back to the draft's choice, D12, D13). F5 rejected (D14). Looks fine: the classifier,
  the passthrough, the transient cases, the doc map, C, unpublished-version packing.
- **Final pass, round 2** (resumed): `conditional approve (with conditions: track the disclosure
  privately and fix the two close-out edge cases)`. All three adopted: GHSA-q9x2-p4gh-hw97 (D12), the
  `/loop` checks the pushed head, and the merges run bottom-up. Its cascade-rebase suggestion was
  rejected: the program forbids rewriting a pushed branch (D15).
- **Final pass, round 3** (resumed): `conditional approve (with conditions: handle file resurrection
  after squash, remove the stale public-issue goal, and validate before refresh pushes)`. 4 findings,
  all verified and adopted (Delivery, close-out step 1, the seeds). No committable file still
  describes the advisory.
- **Final pass, round 4** (resumed): `approve`.

## Seeds

Drafts (no ELI5; the orchestrator owns approval). One seed per session, inside the worktree.
`/goal` is recommended: completion shows in the transcript.

```
/goal Phases 1 and 2 marked ✓ in implementations-plan/sdk-1/plan.md, each backed by its validation gate reported passing in the transcript (phase 1: the two download_failed rows seen red then green, core and noir unit, `bun run lint`, `bun run test`, a clean tree; phase 2: `bun install --frozen-lockfile`, lint, test, a clean tree, the five-file scope check); `LESSONS_FILE=implementations-plan/sdk-1/lessons/phase-N.md` printed per phase; `/code-review` NOT run (code_review: off); the Codex fix loop on gpt-6.1-sol at high converged for a1 and for a2 at their boundaries and for the fresh cross-arc pass, each evidenced by a resumed pass with no new material findings quoted in the transcript; a1's PR (ready, `Closes #102`) and a2's draft PR (base a1) exist, opened only after convergence; a2's pushed head includes the archive move (`git show --stat`); `gh pr checks` reported on both pushed heads. Never publish, release, merge, mark a2 ready, or push to main.
```

```
/loop 15m Drive implementations-plan/sdk-1 forward. Each firing: read plan.md and lessons/ from `sdk-1-version` once it exists, else from `worktree-sdk-1` (authoritative); `git status`, `git log --oneline -5`, `gh pr list --head worktree-sdk-1` and `gh pr list --head sdk-1-version` and their checks. If the plan sits under implementations-plan/archive/ on `sdk-1-version`: if `git fetch -q origin main && git cat-file -e FETCH_HEAD:implementations-plan/archive/sdk-1/plan.md` succeeds, run `agent-worktree done sdk-1 --merged`, report, and stop; else, if `git rev-parse sdk-1-version` equals `git rev-parse origin/sdk-1-version` and both PRs' checks were reported on those heads, report once "delivered: a2 is a draft awaiting the owner's release" and stop (the orchestrator owns a2 from there); else finish close-out step 7. Otherwise take the next step in plan.md; after each edit run the touched package's `test:unit`, then `bun run lint` and `bun run test`; commit signed. A phase is green only when its gate as written passes: paste it, mark ✓, write lessons/phase-N.md, print `LESSONS_FILE=…`, `agent-worktree status sdk-1 "phase N green: <next>"`. At each arc boundary run the Codex loop per Post-implementation before moving on; then the cross-arc pass, the PRs (a2 as a draft), the close-out, the push, `gh pr checks`; report and stop. Never rebase or force-push. Decisions: Codex at high on gpt-6.1-sol, logged in lessons. Same step failing 5 times: reassess with Codex. Never publish, release, merge, mark a2 ready, or push to main.
```

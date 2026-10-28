# Phase 0: planning consults

## Recon (2026-10-25)

- One Explore sweep on Sonnet, seven capabilities. The driver re-read every load-bearing line.
- The sweep missed one reason list: the condition prose in `packages/sdk-core/README.md:58-64`. It
  is now in `recon.md`.
- #102's line references drifted: `server.rs:679-682` is now :698-702. The claims hold.

## Codex plan audit, round 1 (gpt-6.1-sol, high)

- Session `01a170e7-bca3-7ac1-a2a1-350b40a84f08`. Sandbox mode: the host's `approve-for-me`
  opt-in, not plain `read-only`.
- Verdict: `conditional approve (with conditions: resolve release-timing acceptance, correct the
  retry inference, and fix regression-test sequencing)`. It prefers outline B.
- 5 findings (2 MEDIUM, 3 LOW). Each was verified against the tree:
  1. The post-merge playground window needs acceptance, not a note. Verified:
     `published-playground.ts:139-148`, `RELEASE_RUNBOOK.md:405-410`. Settled in the ledger (D3).
  2. `download-failed` is not always permanent. Verified: `downloader.rs:136-178,335-352` hold
     recoverable causes. Adopted: the inference and the docs carry no retry policy.
  3. The steps did not show red before green. Adopted: tests come first.
  4. The budget narrative ignored the global bucket of six. Verified:
     `download_budget.rs:9-13`. Adopted: the text is fixed, plus one core row
     (`429 download_budget_exhausted` → `transient`) and a noir `transient` row that names the budget.
  5. The noir tested-pairs table (`README.md:144-154`) needs a 2.1.0 row. Adopted, in the arc
     that bumps the version.

## Codex plan audit, round 2 (resumed, same session)

- Asked: A (one PR with the bumps), B (bumps at release) or C (a1 code and docs; a2 the version
  edits as a draft, merged right before the release)?
- Answer: C, high confidence. Traced: a1 alone breaks no gate; unpublished versions in a2 break no
  PR gate (`_ts-package-ci.yml:118-120,148-159`, `pack-candidate.ts:128-139`, `assert-core-pin.ts:25-32`).
  A core bump on `main` turns red every later PR that touches `app.yml`'s `published` paths
  (`app.yml:71-87,214-253`), which include release-1's scripts.

## Opus plan audit (Plan agent)

- Verdict: `conditional approve` (F1 window to the orchestrator; F2/F3 log reason and retry wording;
  F5 the 429 control row). It prefers A; it was not shown C.
- 8 findings, each verified:
  - F2: log the server's `message`, as the 403 branch does. Adopted at first, then reverted after
    the final Codex pass (D4).
  - F6: noir 2.1.0 is forced, not an Ask (`release-plan.ts:121,190-199`). Moved to Facts.
  - F7: diff against `origin/main...HEAD`, not the local `main`. Adopted.
  - F8: name LogTape's `["presto"]` category where the docs say "logged". Verified the categories in
    the three `logger.ts` files. Adopted.
  - F1, F3, F4, F5 duplicate Codex R1 findings. They are adopted there.
- Decision on the outline: C. It keeps A's benefit (the owner writes no PR) and removes A's cost
  (an early window).

## Final fresh Codex pass (gpt-6.1-sol, high, new session)

- Session `01a170f5-9229-7b91-ac86-f75ffe62c387`.
- Round 1: `conditional approve (with conditions: correct D4's privacy claim, push and revalidate
  close-out, and fix the archived-plan continuation)`. 5 findings, each verified:
  - F1: D4 must not log the server `message`. Verified in the locked dependency's source. D4 reverted.
  - F2: the close-out commits were never pushed. Adopted: gates, push, then checks.
  - F3: diff checks on HEAD miss uncommitted edits. Adopted: commit, clean tree, exact command.
  - F4: the `/loop` seed lost its plan once a2 archived it while still a draft. Adopted: the
    session stops at the draft and the orchestrator owns a2.
  - F5: assert the log line. Rejected (D14): the log is no contract, no test captures LogTape
    output, and a global `configure()` leaks across `bun test --parallel`.
- Round 2 (resumed): `conditional approve (with conditions: track the disclosure privately and fix
  the two close-out edge cases)`.
  - The related server-side point moved from a planned public issue to a private draft advisory:
    tracked privately, GHSA-q9x2-p4gh-hw97.
  - An interrupted close-out could look delivered. Adopted: the seed checks that the remote head
    equals the local head and that checks ran.
  - Merging `main` into a2 alone breaks the five-file scope check. Adopted: merge `main` into a1
    first, then a1 into a2.
  - Codex suggested cascade-rebasing the stack. Rejected: `gh stack sync` and `rebase` rewrite
    pushed branches, which the program forbids. Merges and plain `git push` are used instead.
- Round 3 (resumed): `conditional approve` with 4 findings, all adopted. Merging `main` into a2
  after a1's squash brings back the plan folder beside its archived copy, so the plan now says to
  remove it. The `/goal` seed still asked for the removed public issue. A refresh must validate
  each branch before pushing it. `gh pr list --head` takes one branch per call.
- Round 4 (resumed): `approve`.

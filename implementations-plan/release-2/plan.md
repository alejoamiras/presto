---
plan: release-2
tier: light
driver: claude-code
eli5_mode: skipped (orchestrator-owned)
code_review: off
claude_model: opus
codex_model: sol
explainer: off
status: plan approved by the final Codex pass 2026-10-28; awaiting the orchestrator
created: 2026-10-28
base: main @ 8d4098b, worktree .claude/worktrees/release-2, branch worktree-release-2
budget: recon 1 agent (Sonnet); code-review off; Codex gpt-6.1-sol at high
---

## Outcome & Quality Bar

Two blockers stop the 1.2.2-rc.1 desktop publish and the SDK release (evidence: `recon.md`).
**For whom:** the owner and the orchestrator, at the next release dispatch and on every PR.

1. On `ubuntu-latest` (now Ubuntu 26.04), the Linux updater smoke's N-1 can swap itself for N:
   its home has the XDG cache dir that tauri-plugin-updater 2.11 needs when `/tmp` is on another
   device. One line in the one script both Linux lanes run, kept by a contract test.
2. `bun run audit:dependencies` exits 0 with `0 blocked` and no `STALE` or `INVALID` line; each
   new entry carries the reason and removal condition the owner accepted.

**Good enough:** no runner pin, dependency bump or Rust change; the owner's next release dispatch
is the smoke change's first real run.

## Scope

| Item | Arc |
|---|---|
| ask11 (1): Linux updater smoke passes on the current `ubuntu-latest` | a1 (`Delivers ask11`) |
| ask11 (2): three undici allowlist entries until 2026-11-30 | a1 |
| Issues: none in the lane brief, none open in the repo | — |

**UI impact (a1):** none on any screen. Budget: "ask11 is the owner's acceptance of the three
undici entries, in the shape of P4-01 (owner, 2026-10-25, decision page 4, Release audit
exceptions: **Option A**, allowlist entries are the owner's, each with its reason and removal
condition). No screen changes."

## Assumptions

**Facts** (trail in `recon.md`):
1. Job 122450669186 (image `ubuntu-26.04` 20261012.163.1) logged `Update install failed: No such
   file or directory (os error 2) at path "/home/runner/.cache/tauri_current_app2Fyq5L"`.
2. tauri-plugin-updater 2.11.0 `updater.rs:1051-1065` runs `tempdir_in(..)?` under
   `env::temp_dir()`, `dirs::cache_dir()` (dirs 6.0.0: absolute `$XDG_CACHE_HOME`, else
   `$HOME/.cache`), then the AppImage's parent; only a device mismatch moves on.
3. Both Linux lanes (`_e2e-updater-linux.yml:161`, `smoke-updater-unix.yml:156`) run
   `updater-smoke-linux.sh`; it creates only `$HOME/Applications` (`:74`) and `$HOME/.presto`
   (`:231`). `ephemeral-updater.sh` launches nothing; `updater-smoke-modes.sh` also serves macOS.
4. The audit prints the same five BLOCKED lines on this base as on #190's run 40582228314.
5. The three advisories are fixed in undici 6.29.1 / 7.30.1, like GHSA-xjj6-f33q-929c. Affected:
   `miniflare/undici` 7.29.1 (exact pin) and npm 11.21.1's bundled 6.29.0 (4w7w misses 6.x). An
   entry is one `ecosystem:id:package` key covering every copy.

**Inferences:** 1. The runner's `/tmp` is on its own device: the plugin reaches location 2 only
after a mismatch at location 1. 2. A desktop session usually has `~/.cache` (fontconfig, mesa,
WebKitGTK); how often a user lacks it is unknown, while the failure path is demonstrated (Fact 2).

**Asks** (none block): 1. GHSA-4w7w reuses the existing reason and removal condition word for
word, as ask11 says, though its npm half does not apply. Working assumption: deliver as stated;
the condition stays sufficient, and the audit's `STALE` line flags the entry once miniflare moves.

## Architecture & Implementation

**Change map.** `packages/presto/scripts/updater-smoke-linux.sh`: one `mkdir` operand and a
one-sentence comment. `packages/presto/scripts/release-contract.test.ts`: one `test()`.
`scripts/dependency-audit-allowlist.json`: three entries, `reviewed` re-stamped.

- **D1, a `mkdir`, not a runner pin.** It gives the smoke a home whose cache dir exists, so on
  26.04 the swap takes location 2, as a 26.04 user with that dir does; 24.04 still takes
  location 1. A `ubuntu-24.04` pin avoids that path, splits the smoke from the build host and
  every other Linux job, and expires with the image; a `TMPDIR` override makes the runner unlike
  a user's machine. The mkdir masks the no-cache-dir user path (the known limit) but lets no
  broken swap pass: the download, checksum-changed and `/health` checks stay.
- **D2, `${XDG_CACHE_HOME:-$HOME/.cache}`** equals `dirs::cache_dir` for an unset, empty or
  absolute value. Only a relative value differs, which the XDG spec calls invalid; a literal
  `$HOME/.cache` would differ for a valid absolute one.
- **D3, the line-74 `mkdir`:** before `source` and every mode branch, so both lanes and every
  launch are covered and macOS's shared `launch_app` is untouched.
- **D4, a contract test**, the repo's pattern for smoke text: nothing can run the script (sudo,
  FUSE, `/etc/hosts`). **D5, three entries, one per id,** in the existing shape (Ask 1).

## Security & Adversarial Considerations

- **Accepted advisories.** 2m5v needs a function-valued `tls` option on an undici `Agent`; 4w7w
  needs `compose(redirect(), cache())` with a shared store; miniflare has neither. qrxm needs a
  hostile TLS 1.2 endpoint: miniflare's `Pool`s are local, but its `cf.json` fetch from
  `workers.cloudflare.com` uses the global dispatcher, so a compromised endpoint could crash the
  local Workers tooling (plausible, unverified). npm's 6.29.0 serves node-gyp only, which the
  playground build never runs; the SDKs and the app ship neither copy. Exploitability beyond
  these traces is unknown; 2026-11-30 caps the waiver, not the exposure.
- **Smoke change.** An empty dir on a throwaway runner; no privilege, signature check or feed
  changes, and the tampered-AppImage `negative` leg is untouched.
- **Supply chain.** `bun.lock` does not change; the 7-day gate and frozen lockfile hold.

## Phase 1: the Linux smoke creates the cache dir ✓

Assumptions: Facts 1-3, Inferences 1-2.

1. Add `"${XDG_CACHE_HOME:-$HOME/.cache}"` to the `mkdir -p "$SERVE_DIR" "$APP_DIR"` line, with a
   comment: the plugin aborts the swap when that dir is missing.
2. In `release-contract.test.ts`, find the uncommented `mkdir -p "$SERVE_DIR" "$APP_DIR"` line of
   the Linux script. Assert that it and the line that sources `updater-smoke-modes.sh` both exist,
   that it carries the operand, and that it comes first.
3. Remove the operand, see the test fail, put it back.

**Validation gate.** `bun test packages/presto/scripts/release-contract.test.ts` (green; red in
step 3); `docker run --rm -v "$PWD:/mnt" -w /mnt koalaman/shellcheck:v0.9.0
packages/presto/scripts/updater-smoke-linux.sh` (exit 0); `bun run lint`; `bun run test`.

## Phase 2: accept the three undici advisories ✓

Assumptions: Facts 4-5, Ask 1.

1. After the GHSA-xjj6-f33q-929c entry, add GHSA-4w7w-5xrc-9h26, GHSA-2m5v-pch6-74hx and
   GHSA-qrxm-fqhp-jwvm: `npm`, `undici`, `expires` 2026-11-30, and that entry's `reason` and
   `upgrade` byte for byte. Set `reviewed` to the commit date.

**Validation gate.** `bun run audit:dependencies`: exit 0, `0 blocked, 17 accepted`, no `STALE
EXCEPTION` or `INVALID EXCEPTION` line. `bun test scripts/dependency-audit.test.ts`, `bun run
test`, `bun run lint:actions`. An advisory published after this plan is a new finding: report it.

## Audit

**Codex round 1** (gpt-6.1-sol, high): conditional approve. Accepted: (1) miniflare also fetches
`cf.json` remotely, so recon's "one local `Pool`" was wrong: recon and Security corrected, the
acceptance kept (worst traced case: tooling DoS). (3) "every desktop home has a cache dir" was
unproven: D1 and Inference 2 reworded; the known limit states a demonstrated path with unverified
prevalence. (4) Anchor the test on the `mkdir` line before `source`, not on five launch names.
(5) Trim. Rejected: (2) a literal `$HOME/.cache`, for D2's reason.

**Final fresh Codex pass** (new session): **approve**. Applied: "caps the waiver", not the
exposure; the test asserts both lines exist before it compares their order. It upheld D2's
rejection, the known limit, and the qrxm and 2m5v/4w7w risk statements.

## Delivery

One arc, one branch, one PR against `main`: the plan commit, Phases 1-2, the close-out. Title:
`fix(release): create the cache dir in the Linux updater smoke, accept 3 undici advisories`.
Body: what and why, each gate and its outcome, `Delivers ask11`, the Claude Code footer. Open it
only after the Codex loop converges; `Audit dependencies` must pass on the final head. The
orchestrator merges.

## Post-implementation

1. **Codex fix loop** over `git diff <plan commit>..HEAD`:
   `~/.claude/skills/codex/scripts/run-codex.sh <prompt> <worktree> high read-only gpt-6.1-sol`,
   with the diff, this plan, an adversarial ask and these two rules word for word. Check each
   claim, fix, commit, resume (`resume-codex.sh`) until a round finds nothing material; after 3,
   stop and report. Log rounds in `lessons/arc-1-review.md`.
   - *"Report bugs and small, targeted improvements only. Do not propose speculative abstractions,
     extra configuration surface, new layers, or rewrites — the smallest change that fixes each
     real problem. If code works and is clear, leave it alone."*
   - *"Audit the comments for value per character. Flag any comment that narrates what the code
     visibly does, restates its line, references implementation plans / phases / reviews, or
     spends a paragraph where a sentence works — and flag places where a non-obvious invariant or
     constraint deserves a comment it doesn't have. Comments are permanent context every future
     reader, human or LLM, pays to re-read: they must be few, dense, and exact."*
2. **Delivery** as above; watch checks in bounded foreground polls.
3. **Close-out**, the PR's last commits. Merge `origin/main`; read what changed in `lessons.md`
   and `archive/index.md`. File the known limit (`known-limit`, closed as not planned): "An
   AppImage update fails when /tmp is on another device and the XDG cache dir is missing"; path
   Fact 2, prevalence unverified, fix upstream; reopen on a user log with this error or a plugin
   change to the loop. Write `## Outcome` after the front matter (date, status, PR, `Known limits:
   #N`, `Open items: none`, seeds retired). Promote one line to `lessons.md` § CI and release,
   with a pruning pass. Open work goes to an issue, a suspected weakness to a private draft
   advisory. Delete `STATUS.md`; `git mv` this folder to `implementations-plan/archive/release-2`
   in its own commit; add one line to `archive/index.md`, none to `index.md`.
4. **Teardown** once the orchestrator merges and `git fetch -q origin main && git cat-file -e
   FETCH_HEAD:implementations-plan/archive/release-2/plan.md` succeeds: `agent-worktree done
   release-2 --merged`; relay a refusal, never force.

## Seeds (not run: orchestrator-owned)

`/goal` Phases 1-2 ✓ here with gates passing in the transcript; Codex loop converged (quoted); PR
against `main` with `Delivers ask11` and the archive commit; `bun run test`, `bun run lint`,
`bun run lint:actions`, `bun run audit:dependencies` exit 0.

`/loop 15m` Drive `implementations-plan/release-2`: read plan.md, do the next unchecked step, run
its gate, mark ✓, then Post-implementation in order; never merge.

Over the 150-line target (186 lines): the review rules must stay verbatim and the audit stays inline.

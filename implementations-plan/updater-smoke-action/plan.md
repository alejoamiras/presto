---
tier: light
driver: claude-code
eli5_mode: artifact
code_review: off
status: closed 2026-10-02 (PR #85)
created: 2026-10-01
worktree: .claude/worktrees/updater-smoke-action
branch: worktree-updater-smoke-action
base: main @ 87a4c8c
---

## Outcome

**Closed 2026-10-02.** Delivered as PR #85, squash-merged. This plan's `/goal` and `/loop` seeds are
retired; do not re-run them.

**Shipped:** `packages/presto/scripts/ephemeral-updater.sh` (`keygen`, `stamp`, `build`, `feed`)
replaces the duplicated key, stamp, build, hook-scan and feed steps of `smoke-updater-unix.yml` and
`smoke-updater-windows.yml`; Windows keeps only its barrier injection between the builds. The feed
contract test covers both workflows' call order; K5 executes the build's collection per OS × role with
a failing scanner stub; `ephemeral-updater.test.ts` covers `stamp` and input refusal; the presto filters
route the unix smoke and the script.

**Proof:** unix `positive` run 37022318517 (`darwin-aarch64`, `linux-x86_64`) and Windows `barrier` run
37022322243, all `success` at `42b3638`; later commits changed only comments, tests and one equivalent
guard. Codex (GPT-6 Astra, `high`) converged in three rounds, confirmed once more after the
SC2015 fix.

**Dropped:** the composite action from the follow-up's wording (rejected at planning: a script is
unit-testable and runs locally); re-proving every smoke mode (the dispatch covered extraction, as chosen
at Phase 0). Nothing promoted to `lessons.md`: the one gotcha that bit (CI's shellcheck 0.9 versus a
local 0.11) is already there, and the file is over budget.

# updater-smoke-action

Give the two ephemeral updater smokes (`smoke-updater-unix.yml`, `smoke-updater-windows.yml`) one
copy of the setup they duplicate step for step: the throwaway signing key, the version and pubkey
stamp, each end's build and artifact collection with the test-hook scan, and the signed local feed.
Closes the follow-up "Consolidate the ephemeral updater smoke setup" in
`implementations-plan/follow-ups.md`.

**Phase 0 answers:** scope is the two smokes only (the key code in `presto.yml` and
`release-presto.yml` stays); the gate is static checks plus one dispatch of each smoke on the branch
(unix `positive` on macOS and Linux, Windows `barrier`); merge when Codex converges and every gate is
green; `/code-review` off. No `/harden`: the change adds no trust relationship the smokes do not
already have (see Security).

## Outcome & Quality Bar

**For whom:** whoever next changes the updater or its smokes — editing one place instead of two
parallel copies that have already started to drift (`sed -i` on Windows, `sed -i.bak` on unix).

**Excellent looks like:**
- Both smokes build the same artifacts as before and pass, proven by dispatch, not by inspection.
- The shared logic is shellchecked by `bun run lint` and its riskiest transform (the stamp) is
  unit-tested, which inline YAML could not be.
- Each workflow still shows one step per build in the Actions UI, so a red 70-minute run names which
  end failed.

**Good enough:** no new modes, no change to the smoke scripts themselves, no touching the release or
PR-gate key code.

## Architecture & Implementation

**Shape.** One script, `packages/presto/scripts/ephemeral-updater.sh`, with four subcommands that
mirror the lifecycle. The workflows keep their own steps, each a one-line call:

```
ephemeral-updater.sh keygen
ephemeral-updater.sh stamp <version> <src-tauri-dir>
ephemeral-updater.sh build <n-1|n> <version> <out-dir>
ephemeral-updater.sh feed <version> <platform-key> <dir>
```

**Cwd and resolution policy.** The script finds the repo from its own path; every `bunx` runs from
`packages/presto` with `--no-install`, so a missing local CLI fails instead of being fetched; config
files are addressed under `packages/presto/src-tauri`.

- `keygen` — turn tracing off (`set +x`), install a trap that deletes the key files, then
  `bunx --no-install tauri signer generate --ci -p "" -w <file>` (with `-w` the CLI never prints the
  private key). Read the key into a variable, fail if empty, `::add-mask::` it, and only then append
  `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD=` and `EPHEMERAL_PUBKEY` to
  `$GITHUB_ENV`. Run outside Actions, the mask command prints the key: harmless for a throwaway, and
  the local gate discards that output.
- `stamp` — `sed -i.bak` the `^version = "…"` line of `Cargo.toml` (the form GNU and BSD sed both
  accept, so Windows' Git Bash and macOS share it), and rewrite `tauri.conf.json`'s `version` and
  `plugins.updater.pubkey` from `EPHEMERAL_PUBKEY` with the existing `bun -e` (2-space JSON plus
  trailing newline). Requires `EPHEMERAL_PUBKEY`. Its own subcommand so a unit test can run it on a
  temporary copy.
- `build` — for `n` only, remove the previous bundle output as today (unix the whole
  `<root>/bundle`, Windows `<root>/bundle/nsis`), `stamp`, then `bunx --no-install tauri build` with
  `--target "$TARGET"` when `TARGET` is set (unix) and without it otherwise (Windows), so `<root>` is
  `target/<triple>/release` or `target/release` as today. Then per `RUNNER_OS` and role, ending with
  `ls -la <out-dir>` (now on Windows N-1 too):

  | OS | `--bundles` | hook scan | `n-1` collects | `n` collects |
  |---|---|---|---|---|
  | macOS | `app` | `Presto.app` | `Presto-N1.dmg` (ditto + `hdiutil`, 3 tries) | `*.app.tar.gz` + `.sig` |
  | Linux | `appimage` | the copied AppImage | `*.AppImage` | `*.AppImage` + `.sig` |
  | Windows | `nsis` | `target/release/Presto.exe` | `*-setup.exe` | `*-setup.nsis.zip` + `.sig` |

  The scan is `assert-no-test-hooks.sh`, unchanged.
- `feed` — exactly one payload in `<dir>` (by OS), the current `jq -n` feed with `<platform-key>`,
  `sign-smoke-feed.sh`, then `update-manifest -- verify` against the stamped pubkey. Byte-for-byte the
  current logic, platform key as an argument.

Argument errors print a fixed message (never the rejected value: a crafted string could carry a `::`
workflow command) and exit 2.

**Workflows after the change.** Unix: Validate inputs → checkout → setup-presto → Linux deps and
display → `keygen` → `build n-1` → `build n` → `feed` → Updater smoke → summary. Windows: the same
calls, with the L8 barrier injection step left exactly where it is, between `build n-1` and `build n`,
so it still reaches N's installer only. Step names stay as they are. Arguments come from the job's
validated `env` (`N1_VERSION`, `N_VERSION`, `PLATFORM_KEY`, `TARGET`), never from `inputs`.

**File change map.**
- add `packages/presto/scripts/ephemeral-updater.sh`, `packages/presto/scripts/ephemeral-updater.test.ts`
- modify `.github/workflows/smoke-updater-unix.yml`, `.github/workflows/smoke-updater-windows.yml`
- modify `packages/presto/scripts/release-contract.test.ts` (the Windows feed test reads the script)
- modify `packages/presto/scripts/webdriver-only-hooks.test.ts`: K5 (`:106-119`) counts scanner calls
  inside each workflow build step; it moves to "each build step calls `ephemeral-updater.sh build`,
  and the script's build scans in every OS branch (macOS, Linux, Windows)"
- modify `.github/filters/presto.yml`: add `smoke-updater-unix.yml` and `ephemeral-updater.sh` to
  `updater_feed` and `release_tooling`'s workflow list, next to the Windows smoke (the unix workflow
  was never routed: a pre-existing gap on the files this change edits)
- docs: `CLAUDE.md` and `packages/presto/UPDATER_TESTING.md` mention the shared script in one clause
  where they describe the smokes

**Alternatives not taken.**
- *A composite action holding the logic inline* (the follow-up's own suggestion): its `run:` blocks
  escape `lint:shell` (`shellcheck packages/*/scripts/*.sh .github/scripts/*.sh`) and unit tests, and
  writing `$GITHUB_ENV` from a composite would be a first in this repo. A composite that only calls the
  script (the `bot-pr` pattern) adds a layer for typed `with:` inputs and nothing else.
- *One action or script running the whole chain*: collapses two 30-minute builds into one UI step, and
  needs a hook for the Windows barrier mid-chain.
- *Also folding `presto.yml`'s packaging-smoke key and `release-presto.yml`'s build key*: out of scope
  by Phase 0; they export differently, and `presto.yml:728` is pinned not to mutate `tauri.conf.json`.

## Security & Adversarial Considerations

- **Threat model.** Both workflows are dispatch-only, run with `contents: read`, and hold no secret;
  the only key is the run's own throwaway, which signs both ends and a feed nobody else trusts. The
  attack surface is the dispatch inputs (`mode`, `n-version`) and anything that could make the
  throwaway key leak or a production key appear.
- **Secretless invariant.** The script reads no `secrets` (a script has no such context) and the
  workflows gain none; `release-contract.test.ts` keeps scanning both workflow files for `secrets.`.
  The new contract test also asserts the script never names the production signing key's secret.
- **Key handling.** Order preserved: mask, then write `$GITHUB_ENV`, then delete the files. The key
  never reaches stdout. No bundle is uploaded (each carries the throwaway pubkey), so the existing
  "no `upload-artifact`" assertion still holds.
- **Input validation.** `mode` and `n-version` are still allowlisted in the first step, before
  checkout, and reach shell only through `env`. The script re-checks its own arguments (role in
  `n-1|n`, non-empty version and paths) and never echoes a rejected value.
- **Least privilege / supply chain.** No new action, dependency or permission. The builds run
  dependency code, build scripts and (in the scan) an extracted AppImage with the throwaway key in the
  environment: an existing trust relationship, unchanged. `bunx --no-install` from `packages/presto`
  pins the CLI to the one in `bun.lock` instead of allowing a fetch; `cargo run --locked` as before.
- **Secret scans are name-based.** A script could inherit a secret without naming it; what prevents
  that is the workflows supplying none, which this change keeps.

## Assumptions

**Facts (verified):**
1. The four duplicated blocks are at `smoke-updater-unix.yml:115-207` and
   `smoke-updater-windows.yml:87-221`; they differ in bundle type, output root, collected files, the
   hook-scan target, the platform key, `sed -i` vs `sed -i.bak`, the cleanup before N (unix the whole
   bundle directory at `:168`, Windows `bundle/nsis` at `:192`), and a missing `ls -la` on Windows N-1.
2. `release-contract.test.ts:105-120` asserts the Windows feed step's body by splitting the workflow
   source on step names; `:157-213` requires step 0 to be "Validate inputs", no `inputs` expression
   outside `name`/`env`, `permissions: {contents: read}`, no `secrets.`, no `upload-artifact`.
3. `lint:shell` is `shellcheck packages/*/scripts/*.sh .github/scripts/*.sh` (`package.json:29`).
4. `.github/filters/presto.yml` lists `smoke-updater-windows.yml` at lines 146 and 174, and does not
   list `smoke-updater-unix.yml`; `release_tooling` includes `packages/presto/**` (line 117).
5. Both smokes passed on 2026-10-01 (unix 36857605650, 36857602482; windows 36857608794) at
   `6d6fa40`; no smoke-relevant path (both workflows, `packages/presto/scripts`, `src-tauri`, `core`,
   `setup-presto`) differs between `6d6fa40` and `87a4c8c`.
6. `assert-no-test-hooks.sh` and `sign-smoke-feed.sh` are called from these two workflows only, plus
   `assert-no-test-hooks.test.ts` running the helper directly.
7. `webdriver-only-hooks.test.ts:106-119` (K5) requires each workflow build step to contain the
   scanner call (two in unix, one in Windows).
8. `bunx --no-install` exists in Bun 1.4.2 (`bunx --help`).

**Inferences (unverified):**
- GNU sed in Windows' Git Bash accepts `-i.bak` as BSD sed does — high confidence; Phase 2's Windows
  dispatch proves it.
- `workflow_dispatch` on a branch runs that branch's workflow file, so Phase 2 tests the new
  workflows — high confidence (the previous plan dispatched branch refs the same way); each run's
  `head_sha` is checked against the pushed commit.

**Asks:** none open. What Phase 2 proves was settled by the Phase 0 gate choice and is bounded under
Phase 2.

## Plan audit

Codex (GPT-6 Astra, `high`), 2026-10-01: **conditional approve** — "repair the missed contract,
complete the local round trip, specify key/cwd and cleanup invariants, and explicitly bound dispatch
parity claims". It judged the subcommand script the right shape over a composite action ("directly
shellchecked, locally testable, and preserves visible build steps").

Adopted (each verified against the repo first):
- **K5 contract missed by recon** (Medium): `webdriver-only-hooks.test.ts:106-119` counts scanner
  calls per build step. Added to the change map with the guarantee restated for the script.
- **Key handling** (Medium): tracing off, cleanup trap before generation, `-w` kept, empty-read check,
  mask before `$GITHUB_ENV`. Local runs print the mask line; the gate discards it.
- **Executable resolution** (Medium): every `bunx` from `packages/presto` with `--no-install`; the
  "no trust boundary" wording replaced with the existing trust relationship it actually is.
- **Local round trip incomplete** (Medium): the gate now loads the env file and stamps the config
  before `feed`, restores both files after, and says what a dummy payload cannot prove.
- **Parity bound** (Medium): Phase 2 now states what the dispatch proves and what it does not.
- **Fact corrections** (Low): cleanup differs per OS (kept exactly), Windows N-1 had no `ls -la`, the
  scanner has a test caller, the baseline ran at `6d6fa40` (smoke paths unchanged since). N-1 cleanup
  stays absent as today rather than resting on a cache inference. Dispatch `head_sha` is checked.

Rejected:
- **OS × role unit coverage of build arguments and collection** (Low): it needs a dry-run seam, a
  test-only surface in the script, to restate what Phase 2 runs for real on all six combinations; K5
  keeps the scan-per-OS guarantee statically.

## Phases

### Phase 1 — Shared script, rewired workflows, tests ✓

✓ 2026-10-02: gate passed; record in `lessons/phase-1.md`.

Write `ephemeral-updater.sh`; replace the duplicated steps in both workflows with its calls; move the
Windows feed contract test onto the script and extend it to both workflows (each calls `keygen`,
`build n-1`, `build n`, `feed` in that order before "Updater smoke", and the barrier injection sits
between the two builds on Windows); add `ephemeral-updater.test.ts`; update the filter and docs.

Assumptions for this phase: Facts 1-4, 6-8; the sed inference.

`ephemeral-updater.test.ts`, kept small:
- `stamp` on a temporary copy of the real `Cargo.toml` and `tauri.conf.json` sets the package version
  and the config's `version` and pubkey, and leaves every other byte of both files as it was.
- An unknown subcommand or role exits 2 and does not echo the value.

**Validation gate:**
- Commands: `bun test packages/presto/scripts/ephemeral-updater.test.ts packages/presto/scripts/release-contract.test.ts`
  (from `packages/presto`: `bun test scripts/ephemeral-updater.test.ts scripts/release-contract.test.ts`),
  then `bun run lint`, `bun run test`, `bun run lint:actions`.
- Local integration: `keygen` with `GITHUB_ENV` pointed at a temporary file (output discarded), load
  that file (`set -a; . <file>; set +a`), `stamp 9.9.9 packages/presto/src-tauri` so the config
  carries the throwaway pubkey `feed` verifies against, then `feed 9.9.9 linux-x86_64 <tmp>` over a
  dummy `x.AppImage` + `.sig` with `RUNNER_OS=Linux`; finally
  `git checkout -- packages/presto/src-tauri/Cargo.toml packages/presto/src-tauri/tauri.conf.json`.
  Exit 0. This proves the key, stamp, feed build, manifest signature and `verify` chain; the dummy
  payload's own signature is opaque to `verify`, so payload signatures are proven by Phase 2 only.
- Pass: every command exits 0.
- Layers: lint (biome, shellcheck, actionlint), unit, local integration.

### Phase 2 — Runtime proof by dispatch ✓

✓ 2026-10-02: unix `positive` 37022318517 (`darwin-aarch64`, `linux-x86_64`) and Windows `barrier`
37022322243, all `success` at `42b3638`; Codex loop converged; record in `lessons/phase-2.md`.

Push the branch (no PR yet) and dispatch
`gh workflow run smoke-updater-unix.yml --ref worktree-updater-smoke-action -f mode=positive` and
`gh workflow run smoke-updater-windows.yml --ref worktree-updater-smoke-action -f mode=barrier`.

Assumptions for this phase: Fact 5 (baseline green), the dispatch-ref inference.

**Validation gate:**
- Commands: `gh run watch <id>` for each run; `gh run view <id> --json jobs` to list the legs.
- Pass: both runs' `head_sha` equals the pushed commit; all three legs (`darwin-aarch64`,
  `linux-x86_64`, Windows `barrier`) conclude `success`; each leg's log shows the `keygen`, both
  `build` and the `feed` steps running the script.
- Layers: e2e (both ends built from the branch, real updater chain).
- **What this proves, and what it does not.** All six OS × role build paths, the key, the feed, the
  barrier's placement on N only, and a real update chain per OS in the dispatched mode. It does not
  re-prove every smoke mode: the smoke scripts are untouched, and e.g. Windows `positive`'s schedule
  assertion (`updater-smoke-windows.ps1:657`) lies past where `barrier` exits (`:637`). This is
  extraction coverage, as chosen at Phase 0.
- A red leg: compare with the baseline run's same step before touching code; three failed attempts on
  one step → stop and reassess.

## Post-implementation

1. `/code-review` is **off** for this plan; skip straight to Codex.
2. **Codex audit** (`/codex high`, GPT-6 Astra): the net diff from `87a4c8c`, this plan, `recon.md`,
   and the asks: adversarial/security (what could leak the throwaway key, smuggle an input into a
   workflow command, or make a production key appear), behavioral parity with the old steps, plus
   these two rules verbatim:
   - *"Report bugs and small, targeted improvements only. Do not propose speculative abstractions,
     extra configuration surface, new layers, or rewrites — the smallest change that fixes each real
     problem. If code works and is clear, leave it alone."*
   - *"Audit the comments for value per character. Flag any comment that narrates what the code
     visibly does, restates its line, references implementation plans / phases / reviews, or spends a
     paragraph where a sentence works — and flag places where a non-obvious invariant or constraint
     deserves a comment it doesn't have. Comments are permanent context every future reader, human or
     LLM, pays to re-read: they must be few, dense, and exact."*
3. **Fix loop.** Verify each finding against the repo, apply the accepted ones, commit, log the round in
   `lessons/phase-2.md`, resume the same Codex session with the fix diff. Repeat until a round reports
   no new material findings; still material after 3 rounds → stop and surface. A fix that changes the
   script's behavior or a workflow `run:` step re-runs Phase 2's dispatch for the affected workflow(s)
   before delivery; test-, comment- or doc-only fixes do not.
4. **Delivery** — single arc: `gh pr create` (first PR of the plan), body with the dispatch run ids and
   the Codex verdict.
5. **Close-out**, as the PR's final commits:
   - `## Outcome` after the front matter: date, status, PR number, the dispatch runs, what was dropped,
     and a line retiring this plan's `/goal` and `/loop` seeds.
   - Promote generalizable gotchas to `implementations-plan/lessons.md` (it is over its ~8 KiB budget:
     add only by replacing, or add nothing).
   - Delete the closed follow-up from `implementations-plan/follow-ups.md` (and its section header if
     it empties).
   - `git mv implementations-plan/updater-smoke-action implementations-plan/archive/updater-smoke-action`
     in its own commit, fix any link it breaks, move the index line to `archive/index.md`.
   - Then `gh pr checks --watch`. When green and no `release-presto` run is in progress, squash-merge
     (authorized at Phase 0) with `--match-head-commit`.

## Delivery

| Arc | Phases | Stacks on | `/code-review` |
|---|---|---|---|
| `worktree-updater-smoke-action` (one PR) | 1, 2, close-out | `main` | off |

Single arc: one branch, plain `gh pr create`, the close-out as its final commits. No stack.

## Seeds

ELI5 companion: https://claude.ai/artifact/P6yUURcMuDPVxfdMARfAqV (source
`implementations-plan/updater-smoke-action/eli5.html`, local only; redeploy the same file to keep the
URL).

Recommended — `/goal`:

```
/goal Phases 1 and 2 marked ✓ in implementations-plan/updater-smoke-action/plan.md, each backed by its validation gate reported passing in the transcript (Phase 2: the unix positive and Windows barrier dispatch run ids with all three legs success); LESSONS_FILE=implementations-plan/updater-smoke-action/lessons/phase-N.md printed for each phase; /code-review NOT run (code_review: off); the Codex fix loop converged with a resumed pass reporting no new material findings, quoted; a re-dispatch after any behavior-changing fix; then the PR created (gh pr view output), the close-out commits on it including the archive move (git show --stat), `bun run test` and `bun run lint:actions` exit 0, checks green, and the PR squash-merged with no release-presto run in progress.
```

Alternative — `/loop`:

```
/loop 15m Drive implementations-plan/updater-smoke-action forward. Each firing: read plan.md and lessons/ (if plan.md is gone, check origin/main for implementations-plan/archive/updater-smoke-action/plan.md: present → merged, stop; absent → babysit the PR's checks only). Pick the next unchecked step, run the fast gate after each edit, commit, push. Phase 2 waits on dispatched runs with gh run watch; a red leg is compared with the baseline before code changes. Stuck → /codex high, log the verdict in lessons/. After Phase 2: the Codex fix loop per Post-implementation, re-dispatching after behavior-changing fixes, then gh pr create, the close-out commits, gh pr checks --watch, and the squash-merge once green with no release-presto run in progress. Never touch release-presto.yml, presto.yml's key code, or any secret.
```

Use exactly one per session.

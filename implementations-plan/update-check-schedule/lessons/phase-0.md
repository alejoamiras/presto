# Phase 0 — Bootstrap PR

Branch `update-check-smoke-bootstrap`, squash-merged as PR #79 (`77b5f50`).

## What shipped

- `smoke-updater-unix.yml`: dispatch-only macOS (DMG) + Linux (AppImage) matrix that builds N-1 = 0.0.1
  and N from the dispatched ref with a throwaway key, signs and verifies a synthesised feed, and runs
  the existing platform smoke scripts. Modes `positive`, `negative`.
- `smoke-updater-windows.yml`: `mode` is now a free-form string (a dispatch validates `choice`
  options against the ref it runs, so a branch could not add a mode), behind a first-step allowlist.
- Both: canonical SemVer check on `n-version` (no build metadata, strictly above 0.0.1), throwaway
  key masked before it enters `GITHUB_ENV`, inputs reach shell only through `env:`.
- `release-contract.test.ts` pins L1/L2 and runs each validator script under bash against accepted
  and rejected inputs.

## 🧬 Mutations (13/13 red, then green)

| Row | Mutation | Failing test |
|---|---|---|
| L1 | `${{ inputs.mode }}` in a `run:` (unix, windows) | inputs reach shell only through env, after a first-step allowlist |
| L1 | allowlist step not first (unix) | same |
| L1 | a supported mode missing from the allowlist (windows) | same |
| L1 | validator `if: false` (unix) / `continue-on-error: true` (windows) | same |
| L1 | inputs in `working-directory:` (unix) | same |
| L1 | `${{ inputs['mode'] }}` bracket form in `run:` (windows) | same |
| L1 | allowlist accepts anything (unix) | the validator accepts exactly the supported modes and versions above N-1 |
| L1 | loosened version check (windows) | same |
| L2 | a `secrets.` reference (unix) | read-only, secretless, and uploads nothing |
| L2 | an `upload-artifact` step (unix) | same |
| L2 | `contents: write` (windows) | same |

## Codex (GPT-6 Astra, high) — session `01a0f3de-2b41-71b1-9e0f-44485a49764d`

- Round 1: **conditional approve**, four findings, all applied:
  1. the Linux display step wrote `DISPLAY` to `GITHUB_ENV` only, so `stalonetray` in the same step
     started without a display (its background failure does not fail the step) → `export DISPLAY=:99`
     first;
  2. the throwaway private key entered `GITHUB_ENV` unmasked → `::add-mask::` before the write;
  3. guard gaps: `if:`/`continue-on-error:` on the validator, inputs in `shell:`/`working-directory:`/
     `with:`, the `inputs['x']` form → the contract test now scans every step field but `name`/`env`;
  4. version validation accepted non-canonical SemVer and N ≤ N-1 → canonical regex plus a floor.
- Round 2 (resume): **approve** — "All four findings are resolved as written. No new issues found."

## Gotchas

- A plain YAML scalar containing `): ` breaks parsing (`actionlint` reports it as a mapping error);
  use a block scalar for step summaries with parentheses.
- `git switch -c <branch> origin/main` sets the new branch's upstream to `main`; unset it before the
  first push, or a bare `git push` targets `main`.

## Validation

- `bun run test` exit 0; `bun run lint:actions` exit 0; PR #79 checks green.
- Post-merge dispatch on `main`: `gh workflow run smoke-updater-unix.yml --ref main -f mode=positive`
  → run 36770652344, green on both legs (darwin-aarch64, linux-x86_64) at `77b5f50`.

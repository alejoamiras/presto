---
plan: presto-audit-fix
tier: light
driver: claude-code
eli5_mode: off
code_review: off
codex_model: sol
explainer: off
status: closed 2026-10-14 (PR #107); approved 2026-10-14 (director brief)
created: 2026-10-14
worktree: .claude/worktrees/presto-audit-fix
branch: worktree-presto-audit-fix
base: main @ 14c4085
---

## Outcome

Closed 2026-10-14 in PR #107 (`Closes #101`). Codex converged in 2 rounds (`lessons/codex-loop.md`).

**Shipped:**
- `sharp` 0.35.5, through an exact root override, because miniflare pins 0.35.4.
- `source-map-js` 1.2.2, through the lock.
- `quinn-proto` 0.11.19 in all three Cargo locks.
- The follow-ups expiry dates corrected.

No other dependency moved: `bun.lock` was spliced so that root `vite` stayed at 8.2.2. The local
`audit:dependencies` reports 0 blocked. Evidence is in `lessons/phase-1.md`.

**Known limits:**
- source-map-js has no npm provenance.
- sharp's provenance was checked by inspection, not by signature verification.

**Open items:**
- #106: drop the sharp override at the next wrangler bump.
- The two undici exceptions expire 2026-10-31 (`follow-ups.md`).

**Seeds:** none were issued, and none remain.

## Summary

The scheduled `Dependency Audit` on `main` has been red since 2026-10-12 (#101). Every
`release-sdk.yml` publish job requires it to succeed, so it blocks the Aztec 6.0.0-rc.3 npm release
(PR #105). This plan moves the three advisory-bearing packages to their fixed releases, and nothing
else.

## Scope

| # | Change | Advisory | How |
|---|---|---|---|
| 1 | `sharp` 0.35.4 → 0.35.5 | GHSA-wq5f-xc86-pv6w | `miniflare@5.20260918.0-alpha` (from `wrangler` 4.135.0) pins `sharp` at exactly `0.35.4`, so the lock cannot reach the fix. Use an exact root `overrides` entry, like the existing `ws` and `systeminformation` ones. Wrangler does not move. |
| 2 | `source-map-js` 1.2.1 → 1.2.2 | GHSA-68fv-2mgg-jv7q | Both dependents (`postcss`, `@tailwindcss/node`) ask for `^1.2.1`, so move it through the lock alone. No override. |
| 3 | `quinn-proto` 0.11.17 → 0.11.19 in `packages/presto/{core,server,src-tauri}/Cargo.lock` | RUSTSEC-2026-0338, -0340, -0343 | `cargo update -p quinn-proto --precise 0.11.19` per lock. |
| 4 | `follow-ups.md`: the two undici exceptions (GHSA-rfgv-xxqx-mfg5, GHSA-w293-vg96-wgc3) expire 2026-10-31, not 2026-11-30 | none | Docs only. The allowlist does not change. |

**Out of scope:** any other dependency move, any allowlist or `minimumReleaseAgeExcludes` change,
and undici.

**Stop conditions:**
- If a bump pulls in a release younger than 7 days, send `QUESTION`.
- If `audit:dependencies` still reports an advisory after the three bumps, send `QUESTION` with that
  advisory.

## Gates

Each commit must be green on its own. Before pushing:
- `bun install --frozen-lockfile`;
- `bun run test`, `bun run lint`, `bun run lint:actions`;
- `bun run audit:dependencies`, exit 0;
- the four TS builds (sdk-core, sdk, sdk-noir, playground), including the playground's licence step;
- `cargo test --locked` and clippy for core, server and src-tauri;
- `cargo check --target x86_64-pc-windows-gnu --lib` for src-tauri.

On the PR, the acceptance check is a green `Dependency Audit` workflow.

## Security & Adversarial Considerations

- **Provenance.** Check each new release against its registry metadata: npm integrity and
  attestations where they exist, and the crates.io checksum recorded in `Cargo.lock`.
- **sharp's prebuilt native binaries.** The `@img/sharp-*` platform packages ride along with
  `sharp`. Confirm the `@img/sharp-*` binaries are at 0.35.5 and the `@img/sharp-libvips-*` ones
  at 1.3.4, and that every one is older than the 7-day gate. Only miniflare's local image handlers
  import sharp. wrangler loads miniflare during deploys as well, so sharp reaches build hosts but no
  shipped artifact.
- **Lock drift.** The diff of each lock must touch only the target package and its own subtree.
  Anything else is a stop.

## Post-implementation

Run `/codex high` on `gpt-6.1-sol` over the diff, with an adversarial supply-chain ask and the two
standing rules. Stop at 3 rounds. Then open a PR with `Closes #101`, run `gh pr checks --watch`, and
send `DONE presto-audit-fix: <PR url>; CI <state>`.

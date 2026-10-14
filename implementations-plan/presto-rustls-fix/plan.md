---
plan: presto-rustls-fix
tier: light
driver: claude-code
eli5_mode: off
code_review: off
codex_model: sol
explainer: off
status: approved 2026-10-14 (director brief)
created: 2026-10-14
worktree: .claude/worktrees/presto-rustls-fix
branch: worktree-presto-rustls-fix
base: main @ af4ce18
---

## Summary

On 2026-10-14 RustSec published four `rustls` advisories (RUSTSEC-2026-0346, -0347, -0348, -0349).
All four name `>= 0.23.46` as patched. All three Cargo locks carry 0.23.45, so `Dependency Audit`
blocks 12 entries (4 ids × 3 locks) and nothing else. This plan moves `rustls` to 0.23.46, the
smallest fixed release, and nothing else.

## Scope

| # | Change | Advisories | How |
|---|---|---|---|
| 1 | `rustls` 0.23.45 → 0.23.46 in `packages/presto/{core,server,src-tauri}/Cargo.lock` | RUSTSEC-2026-0346 (GHSA-c8m5-c952-6cm4), -0347 (GHSA-vp88-798v-h67f), -0348 (GHSA-h2v8-394m-p7vv), -0349 (GHSA-w44r-93j7-qv28) | `cargo update -p rustls@0.23.45 --precise 0.23.46` per lock. The three locks move identically (one version line and one checksum line each), so this is one commit. |

**Out of scope:** any other dependency move, and any change to the allowlist or the audit script.

**Stop conditions:**
- If a lock moves anything besides `rustls`, stop.
- If `audit:dependencies` still blocks after the bump, send `QUESTION`.

## Provenance gate

0.23.46 was published to crates.io about six hours before this plan opened, so the brief adds one
gate before anything from it is compiled. Download both crates by checksum and diff 0.23.46 against
the upstream tag `v/0.23.46`, with packaging files excluded. Then diff it against the 0.23.45 crate
for the delta. Any file or code the upstream history does not explain blocks the plan. The result
is in `lessons/phase-1.md`.

## Gates

Before pushing:
- `bun install --frozen-lockfile`;
- `bun run test`, `bun run lint`, `bun run lint:actions`;
- `cargo test --locked` and clippy for core, server and src-tauri;
- `cargo check --target x86_64-pc-windows-gnu --lib` for src-tauri;
- `bun run audit:dependencies` with the CI-pinned cargo-audit 0.22.2, reporting 0 blocked.

On the PR, the acceptance check is a green `Dependency Audit` workflow.

## Security & Adversarial Considerations

- **Release age.** No release-age gate covers Cargo here (`minimumReleaseAge` is bun only). That is
  why the provenance gate exists. The crate must equal the tag, and its delta must trace to
  maintainer-reviewed upstream PRs.
- **Exposure.** `rustls` in these locks depends on aws-lc-rs, ring, webpki, pki-types, subtle,
  zeroize, log and once_cell, and not on `brotli`. So the `brotli` feature is off and -0348 cannot
  reach Presto. -0349 (client resumption state) reaches the reqwest downloads. -0346 needs a custom
  `ClientSessionStore` that formats values with `Debug`. -0347 needs `EchMode::Enable`.
- **Lock drift.** Each lock's diff may touch only the `rustls` entry.

## Delivery

One PR to `main` with the four ids and the acceptance check. #105 is being merged first. When it
lands, merge `origin/main` into this branch: never rebase, either before the PR opens or as its
last commit.

## Post-implementation

Run `/codex high` on `gpt-6.1-sol` over the diff and the provenance record. The adversarial ask
names the crate's age and the delta explicitly. Stop at 3 rounds. Then open the PR, run
`gh pr checks --watch`, and send `DONE presto-rustls-fix: <PR url>; CI <state>`.

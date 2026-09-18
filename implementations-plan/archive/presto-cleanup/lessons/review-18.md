# Review — PR #18 (`presto-cleanup-complexity`)

Independent review of the peer's Arc 3 by a second driver (Claude), with three same-family reviewers
(core crate, desktop crate, TypeScript) and Codex as the foreign reviewer. Scope: intent vs.
delivered, introduced bugs, unprompted CI changes.

## Original ask

Add cognitive-complexity and function-length rules for JavaScript/TypeScript (Biome) and Rust
(Clippy), refactoring existing violations without changing behavior.

## What the peer delivered

Prompted: Biome complexity rules over all handwritten JS/TS (root scripts newly covered), shared
`clippy.toml` plus per-crate `deny` for the two Clippy rules, `lint:clippy` and three-crate
`lint:rust`, the CI lint/test jobs switched to those scripts (the headless `server` crate is now
linted and tested in CI), routing for `clippy.toml` and `packages/presto/server/**`,
`docs/CODE_QUALITY.md`, and a policy contract test. Every `.github/**` hunk enforces the new rules;
none is unprompted.

Refactors: desktop startup split into helpers; core `bb`/`prove`/`auth`/`config`; SDK prover retry
path and transport body reader; a dozen root scripts and their tests. Twenty `biome-ignore` comments,
all on `describe()`/`test.skipIf()` callbacks in test files, none in production code.

## Findings

- No behavior drift. All three reviewers compared old and new control flow function by function:
  the desktop startup order is identical step for step (uninstall hooks, CryptoProvider, cert-gen,
  logging and panic hook, config, autostart reconcile, tray, state, HTTPS spawn, manage, onboarding,
  renewal, HTTP, pollers); `/prove` ordering, deny-by-default authorization, cancellation, lock
  scopes, and every fail-closed gate are preserved; the SDK never issues an automatic HTTP `/prove`
  and still validates the plaintext port before the witness leaves the client. No `#[cfg]` detached
  from its item. No test assertion dropped or made tautological.
- The Rust cognitive rule was mostly suppressed rather than satisfied: 39 `#[expect]`s, because
  Clippy scores expanded code and every `tracing!` call adds several branches. A clean build under
  both feature sets showed 26 of them unfulfilled at Clippy's default threshold of 25. Threshold
  raised to 25, those 26 removed; the 13 that remain guard long linear security transactions.
  `too_many_lines` keeps 80.
- `core/src/bb.rs` `log_bb_stderr` held the drain mutex across the tracing call; restored the
  snapshot-then-log shape.
- Two operator-facing SDK warnings had been reworded; original text restored.
- Accepted as-is: `/prove` now logs the requested version after the revocation check (refused
  versions emit only the warning); `update-manifest` example reports the first bad input in a
  different order (exit code unchanged).
- Rebased onto the reworked #17: the peer's edits to the dependency-age checker and Aztec scripts
  removed there were dropped; the restored scripts were formatted under the wider Biome scope.

## Validation

- `bun run lint`, `bun run lint:actions`, `bun run test` (489 tests): pass.
- `bun run lint:clippy` from a clean crate build, plus desktop clippy with `--features webdriver`:
  pass with no unfulfilled expectations.
- `cargo test --locked`: core 266, server 12, desktop 122 + 10 + 1: pass.
- `cargo check --target x86_64-pc-windows-gnu --lib`: pass.

## Codex

Round 1 (max effort): APPROVE WITH NITS, no correctness or security regression found; the 25/80
`deny` configuration judged defensible and the remaining expectations credible and correctly
attached. Three nits adopted: the policy test now asserts `--locked`, `--all-targets`, and
`-D warnings` per crate; a startup comment no longer claims managed state precedes both servers
(HTTPS receives its own clone); duplicate `rust-toolchain.toml` routing entries from the rebase
removed. Round 2 confirmed the delta.

Codex session `01a07db1-b308-7af3-87a0-5ed1179c2ba3`.

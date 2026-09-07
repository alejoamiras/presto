# Review — PR #17 (`presto-cleanup-dependencies`)

Independent review of the peer's Arc 2 by a second driver (Claude), with Codex as the foreign
reviewer. Scope: intent vs. delivered, introduced bugs, unprompted CI changes.

## Original ask

Bump dependencies to their latest versions, respecting the seven-day `minimumReleaseAge`.

## What the peer delivered

Prompted: npm and Cargo refreshes across all manifests and the three independent lockfiles
(every changed resolved entry verified at least seven days old, both by the peer's sweep and by
independent registry spot-checks), the rcgen 0.14 `Issuer` migration, the reqwest 0.13 rustls
switch with its CI consequences (no `libssl-dev` on headless legs, `tokio-rustls` permitted in the
headless tripwire), regenerated Wrangler types, and two resolved RUSTSEC allowlist entries.

Unprompted, reverted here:

- Revoked the owner-approved `@aztec/*` release-age exemption (bunfig.toml and setup-aztec, dated
  owner decisions) and made the Aztec update scripts fail closed on any release younger than seven
  days. That holds every Aztec bump red for a week and breaks nightly tracking. Restored the base
  scripts and the parity test.
- Added a 383-line registry-age checker, a composite action, and wiring into thirteen workflows,
  plus npm and cargo Dependabot version-update ecosystems. bunfig's `minimumReleaseAge` already
  enforces the floor at resolution time and this repo bumps dependencies by hand. All removed; the
  seven-day cooldown on the existing github-actions Dependabot entry stays.

Kept as defensible defect fixes: the Rust 1.98.0 pin (`rust-toolchain.toml` plus CI), exact Node
pins, and `--before` on the preview CLI install.

## Findings

- msgpackr was bumped to 2.1.0 while every `@aztec/*` package declares `^1.11.2`; the playground
  devDependency exists only to back the dev-server `#msgpackr` alias, so dev and production would
  have bundled different majors. Pinned to the 1.12.1 the Aztec graph resolves.
- Codex round 1 (max effort): two should-fix items, both verified against sources and adopted.
  tower-http 0.7 derives `Vary` from the CORS config and emitted nothing for this static layer,
  where 0.6 sent `Origin`; `/health` tiers its body by Origin, so an explicit `.vary([ORIGIN])`
  is now pinned and asserted. `rust-toolchain.toml` matched no routing group, so a compiler-only
  change would skip every Rust job; routed to the seven Rust-compiling groups.
- Codex round 2: App's own filter also needed the pin (its E2E builds presto-server); `windows_bb`
  never compiles Rust and was dropped from the set. Adopted.
- Codex round 3: approve, no material findings.

## Validation

- `bun run test`, `bun run lint`, `bun run lint:actions`: pass.
- `cargo test --locked` for core (266), server (12), desktop (122 + 10 + 1): pass.
- Windows cross-check (`cargo check --target x86_64-pc-windows-gnu --lib`): pass on the stack tip.

Codex session `01a07d98-a01d-7e92-abea-e7de456203e4`.

# Phase 4 — cumulative review and delivery

## Cross-arc review

Claude reviewed the completed cumulative human-authored diff after all three arc-specific loops.
Verdict: approve, with no material correctness, security, fail-open, behavioral, compression, or
indirection finding. Claude confirmed the stack was ready to open as three reviewable PRs.

Five low-severity improvements were accepted: correct the updater-candidate comment, tie every
explicit CI compiler pin to `rust-toolchain.toml`, restore the `ConfigState` startup-order invariant,
document the Aztec check's fail-closed exit, and remove a one-line dependency-predicate shim. Focused
tests, script typechecking, formatting, and all three Clippy gates passed. The resumed review approved
every fix without regression.

The two version-lease helpers remain separate because they return different error types and only the
request-serving path emits the operational warning. Combining them would obscure those contracts.
The accepted changes were distributed to their owning arcs; the cumulative reviewed tree remained
byte-for-byte identical after the stack was rebased.

Session: `0420e2a8-f1e5-4ec9-8db2-ec902ea93258`.

## Delivery notes

- Opened the reviewed stack as #16 (release baseline), #17 (dependencies), and #18 (complexity).
  Each PR targets the branch immediately below it; no branch was merged.
- The first #18 headless smoke run caught an overbroad dependency-tree assertion: reqwest 0.13
  legitimately brings client-side `tokio-rustls`, while the guard treated every rustls consumer as
  certificate-serving residue. The dependency arc now permits that client transport while retaining
  the GUI and certificate-serving bans, with a focused workflow-contract test. After cascading the
  fix, the full test suite, all three Clippy gates, actionlint, dependency audit, and the cumulative
  dependency-age check passed locally.
- A later #17 production smoke caught Vite 8 miscompiling the playground's Aztec sqlite-opfs path.
  Reverting msgpackr alone reproduced the failure; withholding playground Vite 8 while keeping the
  other upgrades made the same browser smoke pass. Vite 8 remains on the independently passing
  landing site, and the dependency evidence records the compatibility constraint.
- The regenerated Tauri Linux schema restores upstream `set-accelerator` command names; it is not a
  Presto brand regression.
- Dependency-age composites intentionally no-op on dispatch-only workflows without a comparison
  base. Those workflows execute reviewed `main`; pull-request installs are fail-closed gates.
- Windows/macOS compilation of the reqwest 0.13 rustls graph and opt-in live registry verification
  remain prepared CI evidence rather than claims based on local Linux execution.

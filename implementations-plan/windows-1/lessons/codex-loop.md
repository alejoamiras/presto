# Codex loop (arc a1)

Diff: `git diff origin/main -- . ':!implementations-plan'`. Codex `gpt-6.1-sol`, high, read-only.

## Round 1 (fresh) + same-family review (Opus, general-purpose)

Codex: `findings: 2`. Opus: 4 findings, two shared with Codex. All adopted.

1. **P2, demonstrated (both)**: `screen-fit.spec.ts` threw at collection on any Linux run without
   `WDIO_SCREEN`, including `scripts/run-webdriver-local.sh`. Fix: `linuxScreen()` returns `null` off
   CI when the variable is missing (the spec then only reports on Linux) and still throws in CI; the
   local script exports the geometry of the Xvfb it starts.
2. **P3, demonstrated (both)**: comments contradicted settled facts. `windows.rs` called Tauri's
   Windows fit "exact" (it estimates the title bar, KL-2) and said every page scrolls (the authorize
   and update popups do not). The spec said collapsed Settings fits the shrunk window (it overflows
   by 32 px). Fix: rewrite each to the fact; shorten the spec header; drop the line pointing at the
   PR body.
3. **Plausible (Opus)**: the macOS check assumed a usable height of at least 680. Fix: assert the
   configured height where it fits, containment otherwise. GitHub's macOS runners are tall, so the
   680 assertion still runs there.

Gates after the fixes: typecheck, `bun run lint`, `bun run test` (362 pass, 3 skip), `cargo fmt
--check`, `cargo test --bin Presto windows::tests` (5), local runs at 1280x672 (screen-fit 4, smoke
3, settings 3) and 1280x1024 (screen-fit 3).

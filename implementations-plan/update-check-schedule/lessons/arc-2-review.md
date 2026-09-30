# Arc 2 review loop (codex high, GPT-6 Astra)

Session `01a0f46c-b411-75f0-aa25-cd279e298d9f`, over `b5145d0..HEAD` with `plan.md`, `recon.md` and
the phase 3, 4 and 6 lessons.

## Round 1 — "fix K5's fail-open scan and one label-lifecycle bug"

No production deadlock, panic or consent bypass found. Codex also confirmed the three stated
inferences: a click during "Checking…" cannot produce a stale result, a failed post at shutdown
is harmless, and the WebDriver stub never returns `Available`.

| # | Finding | Verified | Disposition |
|---|---|---|---|
| 1 | **Medium.** K5 could pass without scanning anything. `if grep …` read a grep error (status 2) as clean, and `set -e` does not cover an `if` condition. An empty `.app`, an empty extracted payload or a zero-byte `.exe` also passed the existence check. | Yes, by reading `assert-no-test-hooks.sh`. | **Fixed.** Only grep status 1 counts as clean: 0 fails as a hit, anything else fails as `could not scan`. A file target must be non-empty. A directory, or an AppImage's extracted payload, must hold a non-empty regular file named `Presto`. The `.app` (`Contents/MacOS/Presto`, which `_e2e-packaged.yml` and `uninstall.sh` already rely on) and the AppImage's payload (the deb layout's `usr/bin/Presto`; the re-run unix smoke is what confirms it) both qualify. The hooked-bundle fixture gained its executable. New tests: a fake `grep` exiting 2, and five empty inputs (zero-byte `.exe`, empty `.app`, `.app` with an empty executable, `.app` without one, AppImage with an empty payload). 🧬 `if grep` → the grep-error test red. 🧬 no executable check → the empty-input test red. |
| 2 | **Low.** A full or closed channel wrote Failed inline and never scheduled the revert, so "Couldn't check" stayed until the next click. | Yes: `click` returned right after `apply`. | **Fixed.** The revert is now its own `revert(generation)` step: `settle` awaits it, and the inline failure spawns it. It still re-checks the generation, so a later click cancels it. I4 now advances `REVERT_AFTER` in both cases and expects Idle. 🧬 removing the spawn → I4 red (`("Couldn't check — try again", true)` vs `("Check for Updates…", true)`). |
| 3 | **Comments.** Redundant: the `Entry` doc, the menu-order half of `menu_layout`'s doc, the `TrayManualCheck` alias doc, `apply`'s doc and I13's doc. Missing: the serial-execution invariant that makes it safe for `apply` to release the lock before `show`. | Yes. | **Fixed.** Those docs are deleted or trimmed to the tooltip and log-access rationale. `UiThread::post` now states that jobs run one at a time on the thread `click` runs on. |

## Round 2 — one new low finding

Codex found the revert fix sound: the inline Failed write finishes before the spawn, the timer is
created inside the async body, and `apply` checks the generation inside the posted closure. It
also found that the grep-status fix closes the error bypass, that quoted arguments keep Windows
paths with spaces intact, and that a universal macOS binary needs no special handling.

| # | Finding | Verified | Disposition |
|---|---|---|---|
| 1 | **Low.** A clean artifact whose `Presto` entrypoint is a symlink (say `usr/bin/Presto → ../lib/presto-bin`) failed: `find -type f` does not follow the link. | Yes, as a fixture. Whether any shipped layout does this is unverified. It fails closed, so the cost was a spurious smoke failure, not a vacuous pass. | **Fixed:** `find -L` locates the entrypoint, and grep scans it by name alongside the tree (GNU `grep -r` follows symlinks only on the command line). A new test covers a symlinked entrypoint, clean (passes) and hooked (fails). 🧬 dropping `-L` → that test red. |

## Dispatches

Before the round 1 fixes, the arc's dispatches at `4909ce5` were green: presto.yml `36785186315`, with
`tray-update.spec.ts` passing on the Linux, macOS and Windows dev legs and on built-debug, and the
unix positive smoke `36785189946`. The fixes touch Rust and the K5 script, so Phase 4's dispatches
re-run on the fixed head.

---
plan: windows-1
tier: light
driver: claude-code
claude_model: opus
codex_model: sol
code_review: off
explainer: off
eli5_mode: skipped (orchestrator-owned)
quality_bar: production
status: draft, awaiting approval
worktree: .claude/worktrees/windows-1
branch: worktree-windows-1
base: main @ 9ecd90e
---

# windows-1: fit a too-tall window to the screen at creation; one PRIVACY.md sentence

## Summary

Presto's fixed-size windows run past a short screen's edge (#116). A new window that does not fit
the primary monitor's usable area is shrunk to fit: Tauri's `prevent_overflow()` on Windows and
macOS, a small fit in `windows.rs` on Linux. Settings, the wizard and renewal already scroll.
Unrelated: the approved `PRIVACY.md` sentence (P5-01). One arc, one PR, separate commits.

**UI impact** (the whole visible budget):
- P3-01 (owner, 2026-10-25, decision page 3, Window size on short screens): **Option A**. A Presto
  window taller than the screen's usable area is shrunk to fit at creation; its content scrolls.
  Normal screens are unchanged.
- P5-01 (owner, 2026-10-25, decision page 5, Privacy page sentence): **approved**. Add one sentence
  to the `PRIVACY.md` paragraph that begins "Presto never logs the witness itself": "An error a site
  receives names what failed, never a path on your computer; the detail stays in the log."

**Issues and asks**: #116 → arc a1 (`Closes #116`). No asks. `OWNER-ASKS.md`: none.

## Outcome & Quality Bar

- **For whom**: a Windows laptop user at 1280×720 logical (1920×1080 at 150 %, work area about
  672 px) opening Settings (680 + title bar) or the first-run wizard; short macOS and X11 screens.
- **Excellent**: (1) a window taller than the usable area opens with its whole frame inside it, and
  Settings' last row scrolls fully into view; (2) any other window opens exactly as today.
- **Good enough**: fit at creation only (P3-01); Linux uses an approximate title-bar height and does
  not fit under Wayland (Known limits).

## Assumptions

**Facts** (lines in `recon.md`):
1. All five windows go through `open_or_focus_window` (`windows.rs:113-180`): settings 500×680,
   onboarding 520×592, renewal 420×320, authorize 400×360, update-prompt 420×280.
2. Locked: tauri 2.11.5, tauri-runtime-wry 2.11.4, tao 0.35.3; 2.12.2 has the same fit code.
3. `prevent_overflow()` reads the primary monitor's work area inside window creation, on the main
   thread. It shrinks the inner size by the excess, and `.center()` centres the same box in the work
   area. **macOS**: Tauri's default `TitleBarStyle::Visible` makes the frame equal the inner size, so
   the fit is exact. **Windows**: the box adds a title bar estimated by `AdjustWindowRect`.
4. **Linux**: the window manager's title bar (D) lies outside the inner size, and Tauri centres the
   inner size, so the frame sits D/2 low. With margin M a clamped frame ends at H − M/2 + D. A margin
   of D leaves it D/2 past the edge. A margin of 2D also shrinks windows that fit by height (the band
   I + D ≤ H < I + 2D). So Linux needs its own size and its own placement.
5. `AppHandle::primary_monitor()` reads on the calling thread (`lib.rs:2787`), and GDK is
   main-thread only. The auth popup is built from a server task, the update prompt from the update
   task, and the rest on the main thread. `run_on_main_thread` runs inline on the main thread
   (`send_user_message`, `lib.rs:235-249`). Off it, `build()` only queues creation (`lib.rs:301-365`),
   so the hop's `recv()` is a new wait. No wait cycle exists: the auth callback runs after `request()`
   has returned and holds no lock (`server/auth.rs:118-126`), and the main thread never awaits either task.
6. `windows.rs` is in the `Presto` bin. `bun run test` runs no Rust tests; CI runs `cargo test` for
   `src-tauri` on ubuntu.
7. WebDriver CI: `presto.yml` runs `_e2e-webdriver.yml` as `dev` on three OSes and as `built-debug` on
   Linux; `release-presto.yml` also calls it. Linux uses Xvfb 1280×1024 with no window manager. On
   1280×672 the shots lead measured Settings at outer 701, viewport 680.
8. P5-01 is true on `main` (#180). The one body built from an error's text, `PayloadTooLarge(e.to_
   string())` (`prove.rs:239`), prints a fixed description: hyper 1.11.1's `Display` writes only
   `description()`, axum-core forwards it, and the limit error is "length limit exceeded".

**Inferences**:
- The macOS frame is 680 for Settings (the macOS lane asserts it).
- `.position()` puts the frame's top-left where asked on X11, through `gtk_window_move` with NorthWest
  gravity (the short Linux lane checks it).
- Linux title bars run from 21 px (Xvfb) to about 37 px (GNOME on X11). D = 32 leaves at most 5 px
  under the edge, inside Settings' 20 px bottom padding.
- Windows: Tauri estimates for a resizable frame, but this window has no sizing frame. A clamped frame
  then fits with a few px to spare, and a window within a few px of fitting may shrink by that much
  (KL-2). The Windows lane logs the numbers.

**Asks** (working assumption in force): A1, where the after shot lives. Assumption: commit
`implementations-plan/windows-1/after-settings-1280x672.png` (archived with the plan) and embed it in
the PR body by commit-SHA permalink.

## Architecture & Implementation

`open_or_focus_window` keeps its chain; only the size-and-place step differs:

```rust
#[cfg(not(target_os = "linux"))]
let builder = builder.inner_size(w, h).center().prevent_overflow();
#[cfg(target_os = "linux")]
let builder = match primary_work_area(app)
    .and_then(|area| fit_to_work_area(LogicalSize::new(w, h), area, LINUX_TITLE_BAR_HEIGHT))
{
    Some((size, frame)) => builder.inner_size(size.width, size.height).position(frame.x, frame.y),
    None => builder.inner_size(w, h).center(),
};
```

All under `#[cfg(target_os = "linux")]`:
- `LINUX_TITLE_BAR_HEIGHT: f64 = 32.0`, an allowance (window managers differ).
- `primary_work_area(app) -> Option<(LogicalPosition<f64>, LogicalSize<f64>)>`: in
  `app.run_on_main_thread`, read `primary_monitor()` and convert `work_area()` with its
  `scale_factor()`. Send the result on a one-slot `sync_channel`, and `recv()` it. It returns `None`
  when there is no monitor (GDK on Wayland) or the event loop is gone.
- `fit_to_work_area(size, area, title_bar)` is pure. It returns `None` when `h + title_bar ≤ area.h`
  and `w ≤ area.w`, or when `area.h ≤ title_bar`. Otherwise it returns the inner size
  `(min(w, area.w), min(h, area.h − title_bar))` and the frame's top-left. The left edge is centred;
  the top is `area.y + max(0, (area.h − h' − title_bar) / 2)`, flush with the work area when the
  height was cut. Width is fitted too, as the lane scope says ("taller (or wider)").
- Comments, one line each: the hop (GDK is main-thread only, and this getter reads on the caller);
  the explicit placement (Tauri would centre the inner size and hang the frame half a title bar low).

**Tests** (`windows.rs` `mod tests`, Linux): (1) Settings in an area exactly `680 + 32` tall gives
`None`. (2) Settings in a 1280×672 area at y = 25 gives 500×640 with its frame at (390, 25). (3) An
area no taller than the allowance gives `None`.

**Rejected**: bare `prevent_overflow()` on Linux (the frame overruns, Fact 4); its 2D margin (X:
three lines and thread-safe, but it also shrinks band windows, D2); Y on macOS (it would shrink
fitting windows, Fact 3); building inside `run_on_main_thread` (the auth and update callers lose
`build()`'s synchronous result); fitting after `build()` (the window visibly jumps).

## Security & Adversarial Considerations

No trust boundary moves: the navigation guard, `on_new_window`, the init script and the per-window
capabilities stay as they are. The e2e reads geometry through WebDriver only and adds no core grant.
The new workflow input reaches the shell only through `env:`, and the step checks it against
`^[0-9]{3,4}x[0-9]{3,4}x24$`. It adds no permission, secret or action. The hop is a short wait for
the main thread with no cycle (Fact 5). The privacy claim was checked against every `ProveError` body (Fact 8). No
dependency is added.

## Phases (arc a1)

### Phase 1: the failing e2e (#116) ✓
- `_e2e-webdriver.yml`: add the input `screen` (default `1280x1024x24`). The Linux display step takes
  it through `env: SCREEN`, validates it, starts `Xvfb :99 -screen 0 "$SCREEN"` and exports
  `WDIO_SCREEN`. `presto.yml`'s `e2e-webdriver-builtdebug` passes `1280x672x24` (the issue's
  1280×720 less a 48 px taskbar); other callers keep the default.
- Add `packages/presto/e2e-webdriver/screen-fit.spec.ts`, listed after `smoke.spec.ts` in
  `wdio.conf.ts`. On Settings it logs `getWindowRect()`, `devicePixelRatio`, `screen.*` and the
  viewport on every lane. The assertions per lane:
  - **Linux**: `devicePixelRatio === 1`, a zero screen origin, and the screen size `WDIO_SCREEN`
    names.
  - **Linux, tall screen**: the viewport is 500×680.
  - **Linux, short screen**: the frame's top ≥ 0 and its bottom ≤ the screen height, and
    `innerHeight < 680`. `document.scrollingElement` overflows, and after
    `scrollIntoView({block: "end"})` the whole `#advanced > summary` is in the viewport.
  - **macOS**: `getWindowRect().height / devicePixelRatio === 680` (Fact 3, and "unchanged").
  - **Windows**: log only, because the rect includes invisible borders.
- **Validation gate**: `bun run lint`, `bun run test` and `bun run lint:actions` exit 0. The spec,
  run locally at 1280×672 against today's code, fails on the frame assertion. Layers: lint,
  typecheck, unit, e2e (red).

### Phase 2: fit at creation (#116) ✓
- `packages/presto/src-tauri/src/windows.rs` as above, with its three tests. No configured size
  changes. `CLAUDE.md`: one clause in the Presto bullet; the Testing line counts the new spec.
- **Validation gate**:
  - `bun run lint`, `bun run test` and `bun run lint:clippy` exit 0.
  - `cargo test --locked --manifest-path packages/presto/src-tauri/Cargo.toml windows::tests` passes.
  - From `packages/presto/src-tauri`, `cargo check --target x86_64-pc-windows-gnu --bin Presto` exits
    0. Create the empty, gitignored `binaries/bb-x86_64-pc-windows-gnu.exe` placeholder first.
  - Locally at retry 0, `screen-fit`, `smoke` and `settings` pass at 1280×672, and `screen-fit` passes
    at 1280×1024.
  - Take the after shot (A1).
  - Layers: lint, unit, Windows compile, e2e.

**Local WebDriver recipe**: follow `packages/presto/scripts/run-webdriver-local.sh`'s launch sequence
(build, feed, hook variables, `setsid` app, readiness), with four changes. (1) Claim ports 4445, 59833
and 59834 in `~/.agents/ports.md` under the `mkdir ~/.agents/ports.lock` lock; if a row exists or a
port is bound, skip the run and rely on the PR's CI. (2) Start an owned `Xvfb` on a free display at
the lane's geometry. (3) Give the app and wdio one scratch `HOME` (and `XDG_*`) under
`scratch/windows-1/`, with `PRESTO_HOME` unset. (4) Run only the named specs:
`DISPLAY=:N WDIO_SCREEN=<geometry> bunx wdio run wdio.conf.ts --spec <spec>`. Take the shot with `ffmpeg -f x11grab -video_size 1280x672 -i :N -frames:v 1 <png>`. Stop each owned
group with `kill -- -<pgid>`, then release the rows. Never stop another run's process.

### Phase 3: the PRIVACY.md sentence (P5-01, its own commit) ✓
- Append the sentence, verbatim, as the last sentence of the paragraph at `PRIVACY.md:39`. Placed
  after the first sentence, it would make the next sentence's "It does capture" read as if "It" were
  the error. Rewording that sentence is outside the decision.
- **Validation gate**: `bun run lint` exits 0; `git diff main -- PRIVACY.md` adds exactly that sentence.

## Deviations

- The scroll assertion opens Advanced and scrolls to the end, the page's tallest state, instead of
  scrolling the collapsed `#advanced > summary` into view: it proves the end of the longest page is
  reachable. (At 640 px the collapsed page also overflows, by 32 px.)
- Fact 7's 701-px outer height did not hold on Xvfb without a window manager: there the frame equals
  the inner size (680 before, 640 after). The shots lead's figure included decorations.
- `origin/main` (b85134c) was merged in before Phase 1, and the plan commit was amended with its
  `STATUS.md` line before any push (138e947, not 1be908d).

## Delivery

One arc, one PR from `worktree-windows-1` against `main`:
`fix(presto): fit a window taller than the work area at creation`. Body: what changed and why, the
after shot, the per-OS numbers the spec logs, each lane's WebDriver wall-clock before and after
(estimate +2 s), `Closes #116`. Open it only after the gates pass and the Codex loop converges. If the macOS lane's frame is not
680, stop and report: Fact 3 is then wrong on that macOS. No parallel lanes.

## Post-implementation

1. Codex audit: `~/.claude/skills/codex/scripts/run-codex.sh <prompt> <worktree> high read-only
   gpt-6.1-sol` over the diff from 9ecd90e, with this plan, the adversarial ask and these two rules
   verbatim. Triage, fix, commit, log in `lessons/codex-loop.md`, then `resume-codex.sh` until a
   round has nothing new and material; stop and report after 3 rounds. One same-family review
   (`Agent`, `model: "opus"`, `general-purpose`) runs alongside round 1.
   - *"Report bugs and small, targeted improvements only. Do not propose speculative abstractions,
     extra configuration surface, new layers, or rewrites — the smallest change that fixes each real
     problem. If code works and is clear, leave it alone."*
   - *"Audit the comments for value per character. Flag any comment that narrates what the code
     visibly does, restates its line, references implementation plans / phases / reviews, or spends
     a paragraph where a sentence works — and flag places where a non-obvious invariant or
     constraint deserves a comment it doesn't have. Comments are permanent context every future
     reader, human or LLM, pays to re-read: they must be few, dense, and exact."*
2. Delivery: `gh pr create`, then `gh pr checks <n> --watch` with a bounded timeout. The orchestrator
   merges.
3. Close-out, as the PR's final commits:
   - Merge `origin/main`. Read what changed in `lessons.md` and `archive/index.md`.
   - Write `## Outcome` after the front matter: date, status, PR, `Known limits:`, `Open items:`, and
     the seeds retired.
   - File KL-1 to KL-3 as `known-limit` issues, closed as not planned.
   - Promote general gotchas to `lessons.md`, with a pruning pass. Delete `STATUS.md`.
   - In its own commit, `git mv implementations-plan/windows-1 implementations-plan/archive/windows-1`.
     Add one line to `archive/index.md` and no row to `index.md`.
4. Teardown after the merge: `git fetch -q origin main && git cat-file -e
   FETCH_HEAD:implementations-plan/archive/windows-1/plan.md`, then `agent-worktree done windows-1
   --merged`. Report a refusal; never force.

**Known limits to file**:
- **KL-1, Linux**: under Wayland GDK reports no primary monitor, so no window is fitted (plausible).
  On X11 a title bar taller than 32 px leaves the difference under the edge. Reopen on a Linux report.
- **KL-2, edges that stay as Tauri leaves them**: on Linux, a window that fits by height still gets
  Tauri's centring, which can hang the frame up to 16 px past the edge, as it does today. On Windows,
  a window within a few px of fitting may shrink by that much (plausible). Reopen if Tauri centres
  the frame on Linux, or on a measurement or report.
- **KL-3, declared minimum**: the usable work area must be at least 520×424 logical px. Below it a
  window may also be narrowed, and the two non-scrolling popups can clip. Reopen on a report.

## Audit record

Every consult, finding and disposition: `lessons/phase-0.md`. Size: over light's 150-line target;
the verbatim review rules, the per-OS geometry facts and this ledger are the excess.

- **Codex r1** (fresh, `gpt-6.1-sol`, high): **reject**. All adopted. (1) High, demonstrated: Tauri
  centres the inner box, so a margin M covers a title bar only up to M/2 (Fact 4). (2) The "unchanged"
  claim. (3) Fact 8 missed `PayloadTooLarge`. (4) One coordinate space per assertion. (5) Keep a Linux
  normal-screen control. (6) Isolate the local run.
- **Codex r2** (resumed, X or Y): **conditional approve**, preferring Y. Adopted: a monitor-only
  main-thread read, `env:` plus validation, `document.scrollingElement`. Rejected: a code change to the
  413 body for P5-01, because hyper prints only `description()` (Fact 8).
- **Opus lens** (Plan agent): the macOS frame equals the inner size (verified, Fact 3), so bare
  `prevent_overflow()` fits macOS; it preferred X on Linux. macOS adopted; Linux X rejected (D2).
- **Codex final** (fresh): **reject**, then **approve** on resume. Width fitting was rejected as a
  change: the lane scope says "taller (or wider)", and the path needs a work area under 520 px (KL-3).
  "Windows exact" was adopted as an inference (KL-2). After D2 changed: **conditional approve**
  (correct "`build()` already blocks"); done in Fact 5. Final: conditional approve, condition met.
- **D1**: Windows and macOS use bare `prevent_overflow()`. **D2**: Linux uses Y, not X. X also
  shrinks windows that fit by height, which is a visible choice outside P3-01's text, and the panel
  may not make it. Y leaves them as today (KL-2) and needs no owner ask. **D3**: one short Linux lane,
  the Linux dev lane as control, a macOS frame check, Windows log-only. **D4**: P5-01 needs no code.
- **Post-implementation loop** (`lessons/codex-loop.md`). Round 1, Codex plus Opus: a Linux run
  without `WDIO_SCREEN` threw at collection (fixed: null off CI, mandatory in CI); comments that
  contradicted Facts 3 and 7 and KL-2 (rewritten); the macOS check now asserts containment on a screen
  shorter than Settings. All adopted.
  Round 2 (resumed): `clean`. Converged in two rounds.

## Seeds (draft; orchestrator-owned, none will be run)

- `/goal` Phases 1-3 marked ✓ in implementations-plan/windows-1/plan.md, each gate reported passing;
  the Codex loop converged; the PR exists with the close-out commits; `bun run test`, `bun run lint`
  and `bun run lint:actions` exit 0.
- `/loop 15m` Drive implementations-plan/windows-1 forward per its Post-implementation section.

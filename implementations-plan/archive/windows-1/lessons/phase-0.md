# windows-1 phase 0: planning consults

## Codex plan audit, round 1 (gpt-6.1-sol, high, fresh session)

Verdict: **reject**. Blocking: (1) High, demonstrated by source algebra: on macOS/Linux Tauri centres
the inner height and macOS then applies `set_outer_position`, so a margin M only contains a title
bar D <= M/2; the 40-px allowance left the clamped frame 8 px past the bottom. (2) The "unchanged"
claim and the allowance band were misstated. (3) Fact 7 missed `PayloadTooLarge(e.to_string())`.
(4) The rect oracle mixed physical and CSS spaces and ignored Windows invisible borders. (5)
Shrinking the whole Linux lane loses its normal-screen control. (6) The local recipe left wdio on the
real `HOME`, `PRESTO_HOME` inherited, and ports checked rather than claimed.

Checked: (1) confirmed in `tauri-runtime-wry-2.11.4/src/lib.rs:4571-4632`. (3) the forwarding is real.

## Codex round 2 (resumed): design fork X (margin 2D) vs Y (own fit + explicit position)

Verdict: **conditional approve** with Y. Conditions: read the monitor on the main thread (confirmed:
`WryHandle::primary_monitor` at `lib.rs:2787` calls `window_target.primary_monitor()` on the calling
thread; GDK and AppKit are main-thread only); never apply `.center()` on the fitted branch; record the
decoration constant as an approximation; drop the outer==inner assertion (outer is 701 on Linux CI);
validate the new workflow input through an env var; fix P5-01's body-read exception in code.

Rejected with evidence: the P5-01 code condition. hyper 1.11.1 `Display for Error` writes only
`description()` (`hyper-1.11.1/src/error.rs:574-578`), axum-core 0.5.6 forwards the inner `Display`,
and the limit error is "length limit exceeded". The body names the failure kind; the cause chain never
reaches it, so the sentence is true as written.

## Same-family lens (Opus 5.5, Plan agent) on the X/Y fork

Recommendation: neither as written. Bare `prevent_overflow()` on Windows **and macOS**, the 2D margin
(X) on Linux only. Verified: tauri-runtime-wry defaults macOS windows to `TitleBarStyle::Visible`
(`lib.rs:841-849`), which sets the full-size content view (`lib.rs:1202-1205`), so the macOS frame is
the inner size; recon Fact 6 was wrong. Also adopted: Y's monitor read would run off the main thread
from the auth and update paths (confirmed); `.position()` places the frame top-left on macOS and X11;
the overflow check must read `document.scrollingElement` (body overflow propagates to the viewport);
the Linux control asserts only the viewport; `inputs.screen` goes through `env:`; under GDK Wayland the
primary monitor is usually NULL, so Tauri skips the fit (plausible, unverified).

## Codex final pass (fresh session, gpt-6.1-sol, high)

Round 1: **reject**: `prevent_overflow` also narrows width (rejected as a change: the lane scope says
"taller (or wider)", and the path needs a work area under 520 px wide → KL-3); Windows "exact"
overstated (adopted as an inference, KL-2). Resumed: **approve**.

Then D2 was reversed to Y on Linux: the 2D margin would also shrink windows that fit by height, a
visible choice outside P3-01's text that the panel may not make. Resumed check: **conditional
approve**: Y sound; `build()` off the main thread only queues (`lib.rs:301-365`, verified), so the
hop is a new wait. Wording corrected; no wait cycle (the auth callback holds no lock).

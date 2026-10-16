# Arc 2 review (Codex, gpt-6.1-sol, high, read-only)

Branch `rc-update-channel-client`, reviewed at `f411c06`. The host runs Codex's sandbox in its
approve-for-me mode. Round 1 found nothing in the channel core, the admission points, the IPC
surface or the smoke.

## Round 1: fix (2)

1. **Medium: overlapping failed saves show Stable.** Verified. On a stable version with rc
   effective, pick Stable and then RC before either save answers, and let both fail. The older
   failure is superseded. The newer one restores its `before`, which is the older save's unsaved
   Stable view, while the disk still says rc.
   - Fix: a failed save marks the view unsure. Once the last overlapping save settles, the view
     reads `get_config` and `get_system_info` back. The immediate rollback stays as feedback.
   - Test: `failed overlapping saves show what is saved`. Without the read-back it is red.
2. **Low: confirming during a reload leaves the controls disabled.** Verified. A reload disables
   the switch and the channel control. A save confirmed from the still-open leave check moves
   `revision`, so the reload returns without repainting, and nothing enables the controls again.
   - Fix: the last save to settle hands the controls back, or reads back first after a failure.
     This covers every save, not only the confirmation buttons.
   - Test: `a save confirmed during a reload leaves the controls usable`. Without the hand-back it
     is red.

Playwright had 108 tests after round 1.

## Round 2: fix (1)

Codex confirmed both round 1 fixes.

1. **Medium: overlapping successful saves can land out of order.** Plausible, not reproduced on a
   real app. Tauri runs each async command as its own task, so two saves sent close together take
   the config lock in either order. If the older RC save lands last, the disk holds rc while the
   view shows the newer Stable choice. Neither save failed, so nothing read back. The window is the
   gap between IPC dispatch and taking the lock, much shorter than a human double click, but the
   fix is one line.
   - Fix: a save that starts while another is in flight marks the view unsure, so the read-back runs
     once the last one settles.
   - Test: `overlapping saves that reach the disk out of order show what is saved`. Without the
     line it is red.

Playwright now has 109 tests.

## Round 3: clean

Codex verified the round 2 fix and re-read the whole arc: `VERDICT: CLEAN` at `ac5810f`.

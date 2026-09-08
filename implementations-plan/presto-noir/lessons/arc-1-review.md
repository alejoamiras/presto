# Arc 1 — codex fix loop

Codex session `01a07e7d-c2ae-7ae3-9c79-45a6ab362d39` (GPT-6 Astra, `high`, read-only), over
`git diff 667da60..de6f792` with the arc map, the adversarial ask, and the two standing rules.

## Round 1 — 2026-09-08

No blocker. Ten findings, all verified against the code before acting; every one accepted.

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | Medium | Evicting the 257th revocation could revive a stale grant | `revocation_floor`: any grant older than a forgotten removal counts as revoked; unit test over the eviction |
| 2 | Medium | Cancellation SIGKILLs bb but releases guards before the reap is confirmed | Inherited runner behaviour shared with chonk (`Guard::drop` runs before the tokio `Child` is reaped, so a confirm-wait there can only time out). Not changed in this arc; the doc comments no longer claim more than the code does. Logged as an owner-visible residual below |
| 3 | Medium | Workspace writes and output reads ran on the async runtime | `UltraHonkJob` is owned; `UltraHonkWorkspace::create` and `read_outputs` run under `spawn_blocking` |
| 4 | Medium | `PRESTO_HOME=~/.presto --port N` passed the isolation check | `isolated_presto_home()` rejects an override that resolves (incl. via symlink) to `~/.presto`; test |
| 5 | Medium | SIGTERM to the headless server orphaned an in-flight bb (own process group) | `terminate_bb_on_shutdown_signal`: SIGTERM/SIGINT → `terminate_and_confirm(5s)` → exit |
| 6 | Low | The composite action could declare a foreign listener "ready" | Pre-launch `/health` occupancy check; readiness now requires the launched pid alive AND its own `listening on` log line |
| 7 | Medium | Inflate-cap test never exceeded the cap; disconnect test never touched the real path | `inflate_dry_run` takes the cap; the test trips it and counts two members; the disconnect test drives the real `decode_on_worker` (now generic over the held guard) and observes release after the drop |
| 8 | Low | `"/vk"` suffix assertion fails on Windows (`\vk`) | `Path::file_name()`; this was the `Cert Trust (windows)` red on run 34174258877 |
| 9 | Low | Fixture tripwire not connected | `noir-fixture.test.ts` passes the installed bb.js version to `verifyManifest`, so `test:scripts` fails after an Aztec bump until regeneration |
| 10 | Nit | README filed a wrong-circuit key under `500`; workflow-history comments | README states the 200-with-unverifiable-proof behaviour; comments trimmed in `noir-fixture.ts`, `ultra-honk-smoke.ts`, `prove.rs` |

Codex's unverified concern — multi-member gzip — was probed: bb 5.2.0 proves a witness made of two
concatenated members (`cat witness.gz witness.gz`) and produces the same proof, so it tolerates
trailing members. The dry-run now uses `MultiGzDecoder`, which is conservative either way.

Also in this round: the WebDriver lane's app log moves from `/tmp/tauri.log` to `$RUNNER_TEMP`,
because the Node upload action cannot see Git Bash's `/tmp` on Windows and the failed Windows run
shipped no log; the UltraHonk spec now includes the response body in its failure message.

### Open: Windows desktop returns 500 on the UltraHonk prove

Run 34174258877, `E2E WebDriver (windows)`: the consent flow works, the prove returns 500 within
~1.2 s. bb.exe (the pinned v5.2.0 release asset) carries the same `ultra_honk` / `verifier_target`
/ `--write_vk` CLI (checked with `strings`), and the workspace writer is the chonk `write_witness`.
No lane has ever run a native prove on Windows (the WebDriver suite never proved before this arc;
the Windows smokes run `bb.exe --version` only), so this may be a pre-existing Windows proving gap
rather than a route bug. Diagnosis needs the app log the next dispatch will now upload.

### Residual (owner-visible)

Finding 2: on client disconnect the bb tree is SIGKILLed immediately but the prove permit / lease /
origin slot are released before the kill is confirmed, so a new prove can start while the old bb is
still dying. Same as `/prove` today. A confirmed-kill cancellation path means moving the guards into
a spawned task with a cancel signal threaded through `run_bb`; deferred as beyond a fix-loop change.

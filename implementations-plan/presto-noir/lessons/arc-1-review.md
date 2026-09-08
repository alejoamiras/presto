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

## Round 2 — 2026-09-08 (resumed session, `response-1.md`)

Two new material findings, one test race, one isolation hole, two wording nits; all accepted.

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | Medium | Round-1's `spawn_blocking` for workspace writes / output reads left the admission guards in the handler, so a disconnect released the permit and slots under a still-writing worker | One generic `on_worker(held, work)` carries the guards through all three blocking stages (decode, workspace create, output read); `bb` exposes `UltraHonkWorkspace::create`, `run_ultra_honk`, and `read_outputs` so the handler drives the stages, while `prove_ultra_honk` stays the single-call form for callers without guards |
| 2 | Medium | Headless shutdown killed the registered bb without quiescing, so a queued request could spawn a new bb that shutdown then orphaned | `begin_quiesce()` guard held before `terminate_and_confirm`, reusing the pre-update latch |
| 3 | Low | Disconnect test assumed timing (20 ms, "not yet released") | Barrier channels: the worker signals entry, parks until released, and reports the cancel flag it observed; no elapsed-time assumptions |
| 4 | Low | `PRESTO_HOME=.presto` (relative, not yet created) escaped the isolation check | `resolve_directory(path, cwd)`: absolute against `cwd`, longest existing prefix canonicalized, remainder folded lexically; tests cover relative, `..`, symlink, and a missing leaf under a symlinked parent |
| 5 | Nit | README overclaimed ("verifies against no key"); smoke header kept "first real HTTP consumer" | Reworded to "may return 200 with a proof that fails verification against the circuit's real key"; sentence dropped |

Codex confirmed the deferred cancellation-confirm item (round 1 #2) is defensible to keep open and
saw no UltraHonk-specific Windows failure path in the Rust code.

### Resolved: Windows desktop returned 500 on the UltraHonk prove (F-26)

Run 34174258877 failed without a log; run 34181934669 (with the `$RUNNER_TEMP` upload) shows bb's
stderr: `verification key has wrong size: expected 3680, got 983`. Byte 983 of the fixture key is
0x1A — bb.exe reads the `-k` file in text mode and stops at Ctrl-Z (CRLF folding would corrupt it
too). `Proving key computed` preceded the error, so bytecode (which also contains 0x1A at offset
841) is read in binary mode; the witness is not implicated. Workaround: on Windows the client key
is set aside and bb runs `--write_vk`; the response shape is unchanged (no `vk` when the client sent
one). No CI lane had ever run a native prove on Windows before this arc. Upstream report is an
owner follow-up.

### Residual (owner-visible)

Finding 2: on client disconnect the bb tree is SIGKILLed immediately but the prove permit / lease /
origin slot are released before the kill is confirmed, so a new prove can start while the old bb is
still dying. Same as `/prove` today. A confirmed-kill cancellation path means moving the guards into
a spawned task with a cancel signal threaded through `run_bb`; deferred as beyond a fix-loop change.

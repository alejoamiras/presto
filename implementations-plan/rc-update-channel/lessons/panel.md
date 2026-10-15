# Planning panel: Opus 5.5 + Codex (GPT-6.1 Sol, high)

Each entry: the question, each reviewer's position, the driver's call. Round 1 is the
three independent drafts (driver, Codex, Opus; not kept); round 2 a targeted consult on
P1/P2 after the director put the accident case.

## P1 Feed shape and max(stable, rc)

- Driver, Opus: Worker serves `/releases/latest-rc.json` as the higher of KV `latest.json` and
  `latest-rc.json`. Opus added the client fallback: RC clients use `[latest-rc.json, latest.json]`
  with a 12 s per-request timeout, since the plugin skips non-2xx answers.
- Codex, round 1: client fetches both feeds, verifies each, takes the max; Worker stays a byte
  router. Its reason: the Worker selects before authentication.
- Round 2: Codex accepted Worker max + fallback, provided the docs never call it "max of verified
  feeds". Fallback covers non-2xx and transport errors only. A parseable RC body that fails
  verification stops the plugin, so stable is never asked.
- Call: Worker max + fallback. Known limit: a corrupt or hostile RC key shadows stable updates for
  opted-in clients until withdrawn. A KV writer can already freeze every client.

## P2 Keeping RCs from stable clients (envelope)

- Round 1: Codex and Opus wanted a distinct `rc-v1` schema for every prerelease (Opus also: new
  clients reject v1 prereleases on both channels). The driver leaned to no schema change, because
  strict schema breaks the release smoke of the first channel RC (its N-1 is pre-channel).
- Director's case: accidents (RC feed into the stable key, a route swap) reach every pre-channel
  install irreversibly; add Worker and promote guards if the envelope is dropped.
- Round 2, both: option Y. Production RC feed signed `rc-v1` (pre-channel clients reject it at
  `update_manifest.rs:167-169` whatever the Worker or an operator does). Smoke feeds stay v1, and
  per Opus D1 every prerelease also gets an `rc-v1` smoke feed, so release smokes exercise the real
  RC bytes on channel-capable baselines with no capability probe and no sequencing rule. Z dropped:
  it blocks the first channel RC and guards no reachable path. Worker and promote guards (a) and
  (b) go in regardless.
- Call: Y + (a) + (b). Opus D2 (pin the 404 on `/releases/download/*`) and D3 (only
  `make_smoke_feed` may sign a v1 prerelease; the signer asserts the production schema matches the
  version) adopted.

## P3 Signing gate

- All: keep `release-signing` (no reviewer, `main` only); the owner's dispatch is the approval.
  Owner confirmed 2026-10-15.

## P4 When the RC feed moves

- All: `promote-only` only, key derived from the version, RC pre-flight mirrors stable's.
  Rollback = re-promote an older RC; withdraw = delete the RC key (new `withdraw-rc` mode). Refuse
  `bump_source` on a prerelease (Opus R8).

## P5 Client semantics

- All: channel read per check; admission at check, act and install time; clear the pending slot and
  close the prompt on an effective change; `decide()` unchanged.
- Codex, round 1: reject setting changes while an install holds the gates. Driver and Opus: the
  install-time re-check after the download and before `record_pending` covers it with no new
  coordination. Call: re-check; the window between that check and `install()` is consent-adjacent
  and stays a known limit.
- Codex, round 1: join check as `Manual { live: false }`. Verified false: `run_updates` skips a
  request whose receiver is closed (`update_schedule.rs:592-593`). Codex retracted; join check is
  live (presents with focus, never installs).
- Codex: a read-only (newer-schema) config resolves to Stable. Adopted.

## P6 Config contract

- All: `developer: DeveloperSettings { enabled, update_channel }`; off resets the block in the same
  save. Opus: lenient deserializer (a strict enum error drops the whole config to read-only
  defaults, `config.rs:377-385`). Adopted, plus a pin that `CONFIG_VERSION` stays 2.

## P7, P8

- Tests and delivery consolidated in plan.md. The director's testing mandate turned P7 into the
  transition matrix and the `rc-lifecycle` smoke mode.

## Contradiction check (Codex + a fresh Opus, on plan.md and the ledger)

Every finding was verified against the code before it was applied. None was rejected.

- **Join feedback.** Both reviewers found that the promised "up to date" had no way to reach the
  screen. The join reply was dropped, and Settings has no event grant. Codex also found that a
  full queue skipped the join check silently.
  - Call: `set_update_channel` sends the request with `send().await`.
  - It waits for the reply under the tray's 90 s limit and returns the `ManualCheckResult`.
  - The IPC table row was amended to match, so it stays inside A1.
- **Leg B overclaimed.** Codex: a seeded launch with Auto-Update on proves the automatic install
  (Q4), not the present-only join.
  - Call: T4 is split. The join is proven by the unit layer, Playwright and WebDriver (stub
    counter), with no real-binary leg. T4b (B) proves the automatic install.
- **Headless.** Both found that headless never loads `config.json` (`server/src/main.rs:90-105`).
  - Call: no reset step is needed. A test pins the default block.
- **Install residual.** Codex: the gap is up to about 5 s, not milliseconds, and it covers
  automatic installs (`updater.rs:539,568`). Call: the text is corrected; it stays a known limit
  (L2).
- **Pre-channel rejection of rc-v1 had no test anywhere** (Opus).
  - Call: every RC release smoke gets a refusal leg on the published N-1 before the positive leg.
  - The expected path comes from N-1's own `channel=` log line, so there is no sequencing rule.
- **Smaller fixes:**
  - The owner protocol is rebuilt around rc.1 → rc.2, because no channel stable exists at the
    first channel RC.
  - The WebDriver lane needs `gh workflow run presto.yml`, which is added to A3.
  - The Phase 7 gate re-dispatches the smokes.
  - Arc 0 became Phase 0.
  - Known limits L1–L4 are listed in Outcome.
  - The read-only rule moved to `ConfigStore::effective_channel()` so core can test it.
  - Corrected: the developer-mode IPC row, the wdio order (autostart last), the leave copy (no
    stable version is available), "no setting lost", the count of nine manifests and the
    `config.rs:356-360` citation.

## Double audit (Codex + a fresh Opus): both conditional

Both reviewers attacked the transition matrix. Every claim was verified against the code. No
finding was rejected; two became Asks or known limits instead of mechanisms.

- **Compromised Worker deploy** (both reviewers).
  - Path: Workers Scripts Edit is account-wide, so a redeployed release-feed Worker can serve a
    future RC's v1 smoke manifest on the stable route and proxy its `presto.build` artifact URL.
    Pre-channel clients would install it.
  - Call: all smoke feeds name `updater-smoke.invalid` (RFC 6761), with a second SAN and a second
    hosts line in the smoke scripts.
  - This lands in arc 0 under A4. T20 pins it. The CLOUDFLARE_DEPLOYMENT worst-case sentence gets
    corrected.
- **Second desktop instance** (both reviewers).
  - Path: on macOS and Linux an instance that loses the port stays resident and keeps its own
    update task (`main.rs:488-522`).
  - Call: install-time admission re-reads `config.json` from disk under the updater lock.
  - Codex's residual becomes L5: a stale save from that instance writes the channel back. It is an
    existing property of every setting; reconciling it would be a coordination protocol.
- **Stale RC after a stable rollback** (Opus).
  - Path: a GA hides an RC; rolling stable back makes that RC the higher key again.
  - Call: Ask A5, recommended yes. The stable promote deletes a lower RC key.
- **The health probe could not see L1** (both). Call: the RC probe binds the served bytes to the
  release asset's digest, as #123's resolver does. It needs no Rust build and no secret.
- **The plugin fallback is narrower than stated** (both).
  - 204 ends the check, and a body that is not JSON returns an error.
  - Call: corrected the Fact; the Worker never answers either (tested).
- **The real-binary legs overclaimed.**
  - Old C1 proved only the comparator; old C2 repeated `positive`.
  - New C1 serves a higher rc-v1 to the left state. New C2 proves RC → GA through the fallback.
  - B now pins the endpoint order. A1, A2 and C1 seed `auto_update: true`, so "no download" means
    something.
- **Smaller fixes:**
  - Admission before the prompt window opens.
  - `verify --channel` is required.
  - Channel clients refuse every v1 prerelease (Opus's round-1 position; nothing needs one).
  - One 90 s bound covers both enqueue and reply.
  - A failed save has no side effects.
  - Settings drops a superseded result.
  - `get_system_info` returns `effective_channel`.
  - The withdraw read-back polls past the 60 s KV cache.
  - A broken-RC runbook step: withdraw first, because a reinstalled stable keeps the RC setting.
  - The debug-build log line is renamed.
- **Exact WebDriver call count** (Codex, low). Call: kept in the unit test. The stub reports its
  counter only once, and adding a test hook is not worth it.

## Final fresh Codex pass: conditional, then resolved

- **Verifier conflict** (high, demonstrated): `admits` refuses the v1 prerelease smoke twin on both
  channels. A `verify` that always applied admission would make the signer abort every RC publish.
  - Call: `verify` gets two modes. `--channel` applies admission. `--smoke` applies none and
    accepts only `https://updater-smoke.invalid/` artifact URLs.
  - Only the smoke signer, the ephemeral script and the `updater-feed-e2e` harness may call
    `--smoke`.
- **Missed callers** (medium): `presto.yml:393,399` and `ephemeral-updater.sh:187` also call
  `verify`.
  - Call: every caller migrates in one commit, so the tamper check fails on the signature and not
    on usage.
  - A real round trip runs in `updater-feed-e2e`: the real signer and the real tool with a
    throwaway key, through every mode.
- **Resumed check** (same session): it asked to stage T20 across Phases 3 and 7, because the
  rc-v1 outputs exist only after arc 3, and to allow the CI harness on the `--smoke` list. Both
  were applied. No condition is open.

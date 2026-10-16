---
plan: rc-update-channel
tier: deep
status: approved 2026-10-15; implementing
base: 7153556 (#123)
driver: claude-code
eli5_mode: file (published by the director session)
code_review: off
claude_model: opus
codex_model: sol
explainer: off
harden: decided later
delivery: three stacked arcs + close-out layer
---

# Opt-in release-candidate update channel

A Presto desktop install can turn on **Developer mode** in Settings, then choose **Updates from:
Release candidates**. It then receives release candidates (RCs) through the production feed and the
production signing key, so a real install tests paths such as `1.2.1 → 1.3.0-rc.1` before stable
ships. A client that has not opted in is never offered an RC. Developer mode is also the shared entry
point for the sibling custom-bb plan.

Owner decisions (2026-10-15): the channel ships in the release after 1.2.0; #122 is a known limit;
RC signing keeps `release-signing` with no reviewer; RCs auto-install when Auto-Update is on;
joining checks at once; UX entry point A, channel control B without the version chip, prompt A.

Approved 2026-10-15: A1 by the owner; the remainder by the orchestrator under owner delegation.
Answers: A2 keep 680 px and let the default view scroll; A3 yes; A4 yes (arc 0); A5 yes. Deep tier
and delivery as planned; harden is decided later.

## Outcome & Quality Bar

**For whom.** Release testers (the owner first) who run Presto daily and want the next version
early, and every other user, who must notice nothing.

**Excellent looks like:**
1. A user who never opens Advanced runs byte-for-byte the same update path as today: same endpoint,
   same decisions, same prompt copy. A config written by the new build loads in the previous stable,
   and the reverse, and no setting both builds understand is lost. The older build drops the
   `developer` block on its next save, so developer mode reads as off: the safe direction.
2. Every transition in the transition matrix (below) has a named test at the cheapest layer that
   really proves it, and the three that matter most run on real installed binaries on macOS, Linux
   and Windows.
3. Joining shows the result at once (an RC prompt, or "up to date"). Leaving, or turning developer
   mode off, tells the tester in one sentence that Presto stays on the RC until a newer stable
   exists. After that it installs no RC, except in the few-second window of limit L2 (#125).
4. Every RC feed movement is a deliberate owner dispatch with a dry run, a live read-back and a
   one-dispatch withdrawal.

**Good enough:** no RC notes in the prompt, no tray indicator of the channel, no in-app downgrade,
no per-tester RC targeting.

**Known limits** (closed `known-limit` issues; Security has the paths): #122 legacy v1
prerelease manifests and pre-channel clients; L1 #124 a corrupt or hostile RC key shadows stable for
opted-in clients until withdrawn; L2 #125 a leave in the last seconds before `install()` still
installs the RC; L3 #126 `PRESTO_HOME` selects the config file; L4 #127 withdrawing an RC does not
revoke copies opted-in clients hold; L5 #128 a second desktop instance can write its stale channel
back with an unrelated settings save.

## Scope

In: the developer-mode contract and Settings entry point; the RC channel in config, client, Settings
and prompt; the release-feed Worker RC route; `release-presto.yml` RC signing, staging, promote,
withdraw and read-back; feed health; ephemeral and release updater smokes; docs.

Out: the custom-bb feature itself (sibling plan); the release-smoke live-stable baseline (#123,
merged as `7153556`, reused here); any reviewer on release environments; mobile; the headless
server.

## Architecture & Implementation

`T` = `packages/presto/src-tauri`, `C` = `packages/presto/core/src`, `S` = `packages/presto/scripts`.

### Shape

```
Settings (Advanced ▸ Developer mode ▸ Updates from)            owner dispatch: promote-only <rc>
        │ set_developer_mode / set_update_channel                         │ key from version
        ▼                                                                 ▼
config.json  developer{enabled, update_channel}           KV latest.json   KV latest-rc.json
        │ effective channel (Stable unless enabled)                │                 │
        ▼                                                          ▼                 ▼
check: Stable → [latest.json]            Worker /releases/latest.json   /releases/latest-rc.json
       Rc     → [latest-rc.json, latest.json]   (refuses prerelease)    (higher of the two keys)
        ▼
Layer A (signature, envelope v1 | rc-v1) → admits(channel, kind, version) → Layer B floor
        ▼
act_on: admits again → decide() unchanged → prompt / auto-install
        ▼
perform_update: download → admits again (fresh config) → record_pending → install
```

### Developer-mode contract (shared with custom-bb)

```rust
// C/config.rs
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UpdateChannel { #[default] Stable, Rc }

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeveloperSettings {
    #[serde(default)] pub enabled: bool,
    #[serde(default)] pub update_channel: UpdateChannel,
    // custom-bb adds its own field here; it resets with the struct.
}

// PrestoConfig
#[serde(default, deserialize_with = "de_developer_lenient")]
pub developer: DeveloperSettings,

impl PrestoConfig {
    /// Stable unless developer mode is on. Crate-private: callers use `ConfigStore::effective_channel`.
    pub(crate) fn update_channel(&self) -> UpdateChannel;
    /// Off replaces the whole block with its default in the same save.
    pub fn set_developer_mode(&mut self, on: bool) -> ChannelTransition;
    pub fn set_update_channel(&mut self, ch: UpdateChannel) -> Result<ChannelTransition, DeveloperModeOff>;
}
pub struct ChannelTransition { pub before: UpdateChannel, pub after: UpdateChannel }
```

- Persists in `config.json` (`C/config.rs:150`), additive, **`CONFIG_VERSION` stays 2**: a bump would
  make every older build open the config read-only (`C/config.rs:356-360`). A test pins it.
- `PrestoConfig` has no `deny_unknown_fields`, so an older build loads a config carrying `developer`
  and drops the key on its next save. Developer mode then reads as off: the safe direction.
- `de_developer_lenient`: any error inside the block yields the default block and a warning. A strict
  error would fail the whole `from_value` and drop every setting to read-only defaults
  (`C/config.rs:377-385`).
- `ConfigStore::effective_channel()` is the only read path: Stable when the config is read-only
  (`cap: None`) or developer mode is off. A wiring test fails if `developer.update_channel` is read
  outside `C/config.rs`.
- Name is `developer`, never `dev_mode` (`T/src/main.rs:31` is the debug-build switch; rename its
  log line "Developer mode enabled" at `:1122` to "Debug build").
- Settable only through the two Settings commands below. No HTTP route, CLI flag, environment variable
  or headless path writes it. Headless never loads `config.json`: it builds its config from
  `Default` plus environment origins with `cap: None` (`packages/presto/server/src/main.rs:90-105`),
  so `developer` is always the default there; a test pins it.
- Custom-bb computes `active = cfg.developer.enabled && cfg.developer.custom_bb.is_some()`; turning
  developer mode off clears it with no extra hook.

### IPC commands and grants (owner approval required)

| Command | Window | Arguments | Changes | Why existing commands cannot |
|---|---|---|---|---|
| `set_developer_mode` (new) | `settings` only (capability + `require_label`) | `enabled: bool` | `developer.enabled`; off resets the whole `developer` block in one save; on an effective channel change clears the pending update and closes the update prompt; when the effective channel becomes `rc` (only from a hand-edited block) runs and returns the join check like `set_update_channel` | No command writes developer state; `get_config` is read-only |
| `set_update_channel` (new) | `settings` only | `channel: "stable" \| "rc"` | `developer.update_channel`, refused while developer mode is off; same change effects; joining RC sends one manual check and returns its result (`up-to-date`, `presented`, `failed`, `installing`), otherwise `null` | Same; the tray check path has no channel input, and no separate check command is added |
| `get_system_info` (changed) | `settings` only, unchanged | none | Returns `app_version` and `effective_channel` in addition to `platform`, `cpu_count` | The status line needs the running version, and the channel the updater really uses when the config is read-only |

Grants: `allow-set-developer-mode` and `allow-set-update-channel` in `T/capabilities/settings.json`
only. No grant to `update-prompt`, `authorize`, `onboarding` or `renewal`. The prompt's RC copy reads
the version already in its URL. Registration touches `T/src/commands.rs`, `T/src/main.rs`
`generate_handler!`, `T/build.rs`, `T/capabilities/settings.json`,
`S/tauri-trust-boundary.test.ts` (count 20 → 22) and `packages/presto/e2e/tauri-mock.js`.

### Feed and envelope

- **Routes.** `/releases/latest.json` → KV `latest.json`, unchanged except a final guard: the Worker
  parses the outgoing body and returns 503 if its `version` has a prerelease part (whatever key
  supplied it). `/releases/latest-rc.json` → reads both keys and serves the bytes of the higher SemVer
  over a strict `X.Y.Z(-rc.N)` grammar: stable bytes when the RC key is absent or lower; 503 on a KV
  error, a missing stable key or a bad grammar. Neither route ever answers 204 or a non-JSON 200
  (tested), because the plugin treats 204 as "no update" and a bad body as a hard error, with no
  fallback. `/releases/download/*` keeps returning 404 (test pinned, with the reason).
- **Envelope schemas.** `presto-update-manifest-v1` (stable, unchanged) and new
  `presto-update-manifest-rc-v1`. `verify_manifest` accepts both, requires rc-v1 ⇒ prerelease
  version, and returns `kind: ManifestKind::{Stable, Candidate}`. Pre-channel clients reject rc-v1
  at their schema check (`C/update_manifest.rs:167-169`).
- **Who signs what.** The production feed of a prerelease is signed rc-v1 and staged as release
  asset `latest-rc.json`; a stable's stays `latest.json` v1. For each prerelease the release signer
  also emits two smoke feeds per platform: `smoke-latest.json` (v1) and `smoke-latest-rc.json`
  (rc-v1). Every smoke feed, stable or prerelease, carries artifact URLs on
  `https://updater-smoke.test/releases/download/*`, a reserved name that public DNS never resolves
  and no public CA certifies (RFC 6761; D23). The ephemeral smokes use the same name, so the release and ephemeral paths share it. The smoke scripts add it as a second certificate SAN and a second hosts line, next to
  the `presto.build` ones they already add. Only `make_smoke_feed` may sign a v1 prerelease
  (`--schema v1`); a contract test pins it, and the signer asserts the production feed's schema
  matches its version.
- **No usable v1 prerelease manifest.** After this plan a prerelease run produces one production
  manifest, `latest-rc.json` (rc-v1, GitHub URLs; the `signed-update-feed` workflow artifact and
  the 17th release asset), plus two smoke manifests per platform (nine in all) whose artifact URLs
  name `updater-smoke.test`. No v1 prerelease manifest names a host a public server can serve,
  even with the Worker or Cloudflare account compromised, so #122's exposure stops growing. Proven
  by the behavioural release-contract tests in T20, not a comment. Before arc 0 every prerelease
  uploaded two usable kinds, each with the default 90-day retention: the GitHub-URL v1
  `signed-update-feed` (`release-presto.yml:502-507`, read only by the stable release job at
  `:976-987`) and the per-platform v1 `smoke-latest.json` on `presto.build` (`:474-500`), which only
  the Worker's 404 kept unusable. Arc 0 stops both before the next RC instead of waiting for arc 3.
- **Client admission**, one pure function in `C/update_channel.rs`:

| Channel | v1, no prerelease | v1, prerelease | rc-v1 (prerelease) |
|---|---|---|---|
| Stable | admit | refuse `PrereleaseNotCandidate` | refuse `CandidateOffChannel` |
| Rc | admit | refuse `PrereleaseNotCandidate` | admit |

Nothing a channel client is served needs a v1 prerelease (release smokes give channel-capable
baselines the rc-v1 twin), so on every channel client "prerelease ⇔ rc-v1" holds, and #122's legacy
manifests are refused on both channels.

### Client: check → verify → act → install

1. `check_for_update` reads the effective channel once through `ConfigStore::effective_channel()`
   in core (Stable when `cap` is `None`, i.e. read-only); `current_channel(app)` adds Stable when
   config state is missing.
2. Stable: plain `app.updater()` (today's path). Rc: `app.updater_builder().endpoints([rc_url,
   stable_url]).timeout(12 s).build()`. `rc_url` is derived from the bundled endpoint
   (`endpoints[0].join("latest-rc.json")`) and never added to `tauri.conf.json`, where stable clients
   would fall through to it. The plugin moves to the next endpoint only on a non-2xx answer, a
   transport error or a JSON body that is not a release; it stops at a 204 ("no update") and returns
   an error on a body that is not JSON or stalls past the timeout (plugin `updater.rs:527-563`).
3. `verify_and_gate(update, channel)`: Layer A → `admits` → Layer B. A refusal logs
   `SECURITY: update refused on channel <c>: <refusal>` and returns `Rejected` (→ `Decision::Clear`).
4. `act_on`: re-run `admits` against the current channel before `decide`; a refusal becomes
   `(Rejected, None)`. `decide()` is unchanged (`T/src/updater/decision.rs:71-92`).
5. `perform_update`: after the download and signed-size check, under the cross-process updater
   lock and before `record_pending`, re-read `config.json` from disk (`load_with_cap`; unreadable or
   read-only ⇒ Stable) and re-run `admits`; refuse with a log and leave no state. The disk read
   covers a second desktop instance: on macOS and Linux an instance that loses the port stays
   resident with its own update task and cached config (`T/src/main.rs:488-522`).
6. Before presenting, re-run `admits` beside the existing `should_present` re-check
   (`T/src/main.rs:409`), so a leave between act time and the window call opens no RC prompt.
7. Log `channel=<c> endpoint=<path>` on every check; the smokes assert it.

### Channel changes

`set_developer_mode` / `set_update_channel` save through `mutate_config`, then on an effective
change (`before != after`): `slot.clear()`, close the `update-prompt` window, and when `after == Rc`
send one manual request on the managed `ManualCheckSender` (`T/src/main.rs:1130-1153`) with
`send().await`, not the tray's `try_send` (queue of 4, `T/src/updater.rs:60`), and **hold its
receiver**; one 90 s bound (the tray's, `T/src/update_menu.rs:28`) covers the enqueue and the
reply. A command that changes nothing sends no check. A failed save changes nothing else: no slot
clear, no prompt close, no check. The command returns the
`ManualCheckResult`; Settings shows "Checking…", then "Up to date", "Couldn't check — try again"
(failed, timed out or closed channel), "Installing an update…" (busy), or nothing more when the
prompt opened. The save stands either way. Settings drops a result whose request a newer change
superseded.
`run_updates` skips a request whose receiver is closed (`C/update_schedule.rs:592-593`), so the
join check is `Manual { live: true }`. "Live" means only that a caller waits for the answer:
`decide` maps every manual check to `SetAndPresent { focus: live }` (`T/src/updater/decision.rs:84`),
so the join check opens the prompt with focus and **never installs, whatever Auto-Update says**.
That is what the owner confirmed (present-only; no Ask). Separately, per owner answer Q4: with
Auto-Update on, a later launch or scheduled check that finds the RC installs it with no prompt,
exactly as a stable update does today (`decision.rs:86-88`), unless the tester pressed Later (24 h
snooze → `SetOnly`). Present-only covers the join request itself, not an automatic check that
happens to run right after joining, or after a failed join check. Response to a broken RC:
withdraw it first. A tester who reinstalls stable by hand keeps `developer {enabled, rc}` and gets
the RC back at the 5 s launch check (`C/update_schedule.rs:40`), so the runbook and README say to
leave the channel or withdraw first.

### UI

- Settings (entry point A): a folded `<details class="disclosure">Advanced</details>` at the end
  holds the Developer mode switch; on reveals a Developer section with the "Updates from: Stable |
  Release candidates" segmented control (B), a status line ("You run 1.3.0-rc.2.", no chip) and an
  empty slot for custom-bb. Leaving while the running version is a prerelease, or turning developer
  mode off while the channel is Rc and the running version is a prerelease, shows the same inline
  check: "Presto stays on <v> until a newer stable release exists. It does not go back to an
  older version." (`<v>` is `app_version`; no command supplies the stable version.)
- Copy follows the UX pages; the controls ship disabled until hydrated, like the theme control.
- Height (A2): Settings stays 680 px (`T/src/windows.rs:182-200`), so #116 does not grow. The
  default view uses 637 of 648 px, so the folded Advanced row (about 34 px plus a gap) sits below
  the fold and the default view scrolls by that row only. The no-scroll test
  (`packages/presto/e2e/settings.spec.ts:678-700`) becomes: the speed section is wholly in view, the
  overflow is at most the Advanced row and its gap, and Advanced is reachable by scrolling.
  `e2e/window-sizes.ts` is unchanged; no WebDriver spec pins the Settings size.
- Prompt (A): when the version has a prerelease part, title "A release candidate is ready" and note
  "A test build of the next version. It can have bugs." in place of the rename note; same size,
  buttons and checkbox.

### Release pipeline

- `sign-updater-artifacts`: schema from the version for the production feed; prerelease output file
  `latest-rc.json`, stable `latest.json`; smoke feeds as above. `update-manifest` example gains
  `envelope --schema` and prints the kind. `verify` takes exactly one mode, and with none it is a
  usage error:
  - `--channel stable|rc` checks the signature and the envelope, then applies `admits`. Promote,
    `verify-live-feed`, the signer's production feed and CI's happy path use it.
  - `--smoke` checks the signature and the envelope, applies no admission, and requires every
    artifact URL to start with `https://updater-smoke.test/`. It exists because `admits` refuses
    the v1 prerelease smoke twin on both channels. Only `make_smoke_feed`, `S/ephemeral-updater.sh`
    and the secretless `updater-feed-e2e` harness in `presto.yml` may call it (contract-pinned).
  Every caller migrates in the same change: `release-presto.yml:1341,1476`,
  `.github/workflows/presto.yml:393,399` (the tamper check must fail on the signature, not on usage),
  `S/sign-release-updater-artifacts.sh:109` and `S/ephemeral-updater.sh:187`.
- `release`: stage the signed feed for both kinds; every release has 17 assets (the 17th is
  `latest.json` or `latest-rc.json`). Existing 16-asset prereleases are not promotable.
- `validate`: a prerelease must match `X.Y.Z-rc.N`; `bump_source=true` with a prerelease fails.
- `promote` (mode `promote-only`): `KEY` and the expected `isPrerelease` derive from the version, never
  from an input. RC pre-flight: published, not draft, `isPrerelease == true`, exact 17 assets,
  `verify --channel rc` reports Candidate, four platforms and exact GitHub URLs, assets answer, and
  the RC is above the live stable (read and verified from `/releases/latest.json`). Immediately
  before `wrangler kv key put`, a guard fails on `KEY=latest.json` with a prerelease or
  `KEY=latest-rc.json` with a stable.
- `withdraw-rc` (new mode, `release-feed` environment): delete KV `latest-rc.json`; `dry_run`
  supported.
- `verify-live-feed`: for an RC promote, poll `/releases/latest-rc.json` for the RC (production
  verifier, `--channel rc`) and assert `/releases/latest.json` still serves the version read in
  pre-flight. After `withdraw-rc`, poll with a deadline (KV reads cache 60 s,
  `packages/release-feed/src/index.ts:29`) until the RC route's bytes equal the stable route's.
- Stable promote (per A5): after the `latest.json` put, delete `latest-rc.json` when its version is
  below the new stable, then poll until the RC route serves the new stable. Without it, rolling
  stable back with `promote-only <previous>` makes a stale RC the highest key again.
- `update-feed-health.yml`: the stable probe fails on any prerelease version. A new RC probe
  requires 200 and that the served bytes' SHA-256 equals the digest of the claimed release's own
  feed asset (`latest-rc.json` for a prerelease, `latest.json` for a stable), the binding #123's
  resolver already uses. It needs no secret and catches a well-formed body with a bad signature.
- Release updater smokes (`S/updater-smoke.sh`, `S/updater-smoke-linux.sh`,
  `S/updater-smoke-windows.ps1`), built on the separate "current stable → candidate" baseline PR.
  For a prerelease N, two legs on the published N-1:
  1. Refusal: seed the fixture with developer disabled; serve `smoke-latest-rc.json` on both paths;
     assert no download for 60 s and a refusal line. A pre-channel N-1 logs `update-manifest
     verification failed` (schema, `T/src/updater.rs:248`); a channel-capable one logs
     `CandidateOffChannel`. This is the only real-binary proof that pre-channel installs reject
     rc-v1.
  2. Positive: re-seed with developer enabled and `rc`; serve `smoke-latest.json` on
     `/releases/latest.json` and `smoke-latest-rc.json` on `/releases/latest-rc.json`; expect N. The
     expected path comes from N-1's own log: a `channel=rc` line means `/releases/latest-rc.json`,
     no `channel=` line means a pre-channel N-1 and `/releases/latest.json`.
  For a stable N, seed developer disabled and keep today's single leg. Every leg asserts that
  neither N-1's nor N's log contains `running read-only`.

### Ephemeral smokes: `rc-lifecycle` mode

Builds from the dispatched ref: N-1 `0.0.1`, `R = <n-version>-rc.1`, `N = <n-version>`, all signed with
the run's throwaway key (three builds instead of two). Legs, one installed app, in order:

| Leg | Config | Feed served | Must happen |
|---|---|---|---|
| A1 refuse rc-v1 | no `developer` block, `auto_update: true` | R's rc-v1 feed on both paths | fetched `latest.json` only; `CandidateOffChannel` line; no download; N-1 alive 60 s |
| A2 refuse v1 prerelease | same | R's v1 feed on both paths | `PrereleaseNotCandidate` line; no download; alive 60 s |
| B opted-in launch | fixture `developer {enabled, rc}`, `auto_update: true` | R rc-v1 on `latest-rc.json`; on `latest.json` a parseable feed that is not newer (0.0.1) | fetched `latest-rc.json` first (a reversed order would stop at 0.0.1); download; `/health` = R; config still has the block |
| C1 left, higher RC | default block (developer off), `auto_update: true` | an rc-v1 `rc.2` signed with the run key over R's artifacts, on both paths | fetched `latest.json` only; `CandidateOffChannel`; no download; still R after 60 s |
| C2 GA through fallback, still Rc | `developer {enabled, rc}` | `latest-rc.json` 503; N v1 on `latest.json` | fetched `latest-rc.json` then `latest.json`; download; `/health` = N; config loads with capability |

C1 proves leaving refuses a newer RC on real binaries; C2 proves RC → GA and the plugin's fallback
on the pinned plugin. Windows runs the same legs through `updater-smoke-windows.ps1`, plus its
existing marker checks on B and C2. A one-time mutation run (admission removed on a scratch branch)
must turn A1, A2 and C1 red on their download assertions, not only on log lines.

### File-level change map

| Area | Files |
|---|---|
| Core | `C/config.rs`, `C/update_channel.rs` (new), `C/update_manifest.rs`, `C/lib.rs`, `packages/presto/core/examples/update-manifest.rs`, `packages/presto/core/tests/fixtures/updater/*` (rc-v1 and v1-prerelease fixtures, throwaway key), `packages/presto/core/tests/fixtures/config/*` (compat fixtures) |
| Headless | `packages/presto/server/src/main.rs` |
| Desktop | `T/src/updater.rs`, `T/src/main.rs`, `T/src/commands.rs`, `T/build.rs`, `T/capabilities/settings.json` |
| Frontend | `T/frontend/settings.html`, `T/frontend-src/settings.js`, `T/frontend-src/update-prompt.js`, `T/frontend/style.css` (only if a token-built class is needed) |
| UI tests | `packages/presto/e2e/{settings,update-prompt,window-fit}.spec.ts`, `e2e/tauri-mock.js`, `e2e-webdriver/developer.spec.ts` (new), `e2e-webdriver/trust-boundary.spec.ts`, `wdio.conf.ts` (order) |
| Worker | `packages/release-feed/src/index.ts`, `index.test.ts` |
| Pipeline | `.github/workflows/release-presto.yml`, `presto.yml` (`updater-feed-e2e`), `update-feed-health.yml`, `_e2e-updater*.yml`, `smoke-updater-{unix,windows}.yml`; `S/sign-release-updater-artifacts.sh`, `S/sign-smoke-feed.sh`, `S/ephemeral-updater.sh`, `S/updater-feed-server.ts`, `S/updater-smoke*.sh`, `S/updater-smoke-windows.ps1` |
| Script tests | `S/release-contract.test.ts`, `S/ephemeral-updater.test.ts`, `S/updater-feed-server.test.ts`, `S/update-wiring.test.ts`, `S/tauri-trust-boundary.test.ts`, `scripts/presto-domain.test.ts` |
| Docs | `docs/RELEASE_RUNBOOK.md`, `docs/CLOUDFLARE_DEPLOYMENT.md`, `packages/presto/UPDATER_TESTING.md`, `docs/SECURITY_MODEL.md`, `packages/presto/README.md`, `CLAUDE.md` |

## Transition matrix (testing mandate)

Each row names the cheapest layer that really proves it. "Real" = installed release binaries on
macOS, Linux and Windows through a local feed.

| # | Transition | Proof (layer → test) |
|---|---|---|
| T1 | Pre-channel stable → channel stable (old config) | core unit `config::tests::config_without_developer_loads_with_capability`, `config_version_stays_two`; Real: release update-smoke N-1 → first channel release, N log has no `running read-only` |
| T2 | New config → previous stable (downgrade) | core unit `developer_fixture_matches_writer_output`; Real: release update-smoke seeds the fixture into the published N-1; N-1 log has no `running read-only` / `Malformed config`, and N-1 updates |
| T3 | Damaged developer block | core unit `malformed_developer_block_keeps_other_settings` (number, wrong types, unknown channel) |
| T4 | Stable → join RC: one immediate check, presents, never installs, result shown | src-tauri unit `join_sends_one_live_manual_check_and_returns_its_result` (incl. a full queue); existing `e_decide_invariants` (manual never installs); Playwright `joining shows checking, then the result`; WebDriver `developer.spec`: join shows the stub's "Up to date" and the choice persists on disk (the exact request count stays in the unit test; the stub's counter is reported only once, `T/src/e2e_tray.rs:139-150`). No real-binary leg: the smokes cannot drive Settings |
| T4b | Opted in, Auto-Update on, automatic check finds an RC → installs it (Q4) | Real `rc-lifecycle` B (launch check via the RC route) |
| T5 | RC → next RC (incl. `rc.9 → rc.10`) | src-tauri `verify_and_gate_rc_fixture_passes_floor` (signed rc-v1 fixture through Layer A, `admits`, Layer B with a live higher pending); existing `prerelease_and_build_metadata_precedence`; Worker `rc route serves the higher rc` |
| T6 | RC → GA stable that passes it, still on Rc | Worker `rc route serves stable when stable is higher` (and equal); core `admits(Rc, v1 stable)`; Real `rc-lifecycle` C2 |
| T7 | RC → leave: stays on the RC, refuses a newer RC, takes the next stable above it | src-tauri `channel_change_clears_pending_and_closes_prompt`; Playwright `leaving on a release candidate asks first`; Real `rc-lifecycle` C1 |
| T8 | RC → developer mode off (same as leave) | core `developer_off_resets_block_in_same_save`; Playwright `developer mode off on a release candidate uses the leave check`; WebDriver `developer.spec` off resets on disk; Real C1 uses the off state |
| T9 | Stable channel refuses an RC at check time | core `admits` 2×3 table; Real `rc-lifecycle` A1, A2 + mutation run; release-smoke refusal leg on the published N-1 (the only proof that pre-channel installs reject rc-v1) |
| T10 | Refuses at act time and before the window (left during a check) | src-tauri `act_time_admission_drops_candidate_after_leave`, `present_time_admission_opens_no_rc_prompt` |
| T11 | Refuses at install time ("Update Now", an automatic install or the proof wait after leaving; a second instance) | src-tauri `install_admission_reads_config_from_disk` (temp path: cached Rc, disk Stable ⇒ refuse; unreadable ⇒ refuse; no `record_pending`); wiring guard: admission precedes `record_pending` |
| T12 | Worker refuses a prerelease on the stable route | Worker `stable route refuses a prerelease body`, incl. RC bytes in the stable key |
| T13 | Promote refuses cross-key writes, both directions | release-contract `promote key derives from the version`, `stable promote refuses a prerelease`, `rc promote refuses the stable key and a v1 manifest`, `pre-put guard` |
| T14 | RC route down → RC client still gets stable | Worker 503 cases and `routes never answer 204 or non-JSON 200`; src-tauri `rc_endpoints_are_rc_then_stable` (12 s each); Real `rc-lifecycle` C2 |
| T15 | Withdraw, or a stable promote over a lower RC → RC clients get stable | Worker `rc route serves stable when the rc key is absent`; release-contract `withdraw-rc deletes only latest-rc.json`, `stable promote deletes a lower rc key` (A5), `withdraw read-back polls` |
| T16 | Commands outside Settings, channel while off, failed save, repeated or superseded join | WebDriver `trust-boundary`: auth popup denied both; src-tauri `set_update_channel_refused_while_developer_off`, `failed_save_has_no_side_effects`, `unchanged_channel_sends_no_check`; Playwright `a superseded join result is dropped` |
| T17 | Headless and read-only configs stay stable | server unit `headless_config_has_default_developer`; core `effective_channel_table` (enabled × channel × capability, malformed and newer configs); Playwright `read-only config shows the effective channel` |
| T18 | "Later" on an RC; tray check on Rc; join while an install runs | existing per-version snooze tests (a8, a9) and `e_decide_invariants` (every Auto-Update × snooze × busy input); tray uses the same check path; Playwright `join during an install shows installing` |
| T19 | RC prompt copy and fit | Playwright `update prompt shows release-candidate copy for a prerelease`; `window-fit` prompt 420×280 |
| T20 | A prerelease run emits no v1 manifest with working URLs | release-contract `release signer: prerelease feeds` runs the real `S/sign-release-updater-artifacts.sh` against a temp repo root (copied `tauri.conf.json`, stub Tauri CLI) and a recording manifest tool, for `9.9.9-rc.1` and `9.9.9`. Arc 0: the prerelease still signs every payload with the production key and emits no `latest.json`; every smoke URL starts `https://updater-smoke.test/releases/download/`; the stable run keeps its GitHub-URL `latest.json`; the `signed-update-feed` upload is stable-only; every smoke producer and consumer names the reserved host. Arc 3 adds: the prerelease's GitHub-URL output is `latest-rc.json` with schema rc-v1. Worker `download paths stay 404`. Real round trip in `presto.yml` `updater-feed-e2e` (`S/release-signer-roundtrip.sh`, arc 0): the real signer and the real `update-manifest` tool with a throwaway key, for `9.9.9-rc.1` and `9.9.9`; Phase 3 passes the outputs through their `verify` modes and Phase 7 adds the rc-v1 feed and twin (rc-v1 passes `--channel rc` and fails `--channel stable`; the v1 twin fails both channels and passes `--smoke`; a `presto.build` URL fails `--smoke`) |
| T21 | Rollback, reinstall, downgrade (feed and floor state retained) | release-contract T15 (A5); existing floor and pending-expiry tests (`updater_state`); runbook steps; O3 drill |

Runtime: ephemeral `positive` today is macOS 7 min, Linux 12 min, Windows 18 min (runs
38480726761, 38480732482). `rc-lifecycle` adds one build and four launches: estimated macOS 12,
Linux 18, Windows 28 min; measured numbers go in the PR body. Release smokes add one seeded config
and one feed path per run, plus a refusal leg of about 1.5 min per baseline (#123 runs every leg
once per baseline). WebDriver gains one spec: about 1 min per OS.

## Security & Adversarial Considerations

Threats, with paths (D demonstrated in source, P plausible, U needs unsupported conditions):

- **Feed-writer or operator error serves an RC on the stable route (P).** Production RC feeds are
  rc-v1, which pre-channel clients reject; the Worker refuses a prerelease on that route; promote
  derives the key and guards the write; new stable clients refuse any prerelease at three points.
  Residual: legacy v1 prerelease manifests and pre-channel clients (#122).
- **Compromised Worker deploy (P).** Workers Scripts Edit is account-wide, so any Workers Build on a
  repository branch could redeploy `presto-release-feed`. Such a deploy serves any production-signed
  manifest and proxies any `presto.build` path. Today's v1 smoke feeds name `presto.build`, so a
  pre-channel client would install a future RC from them. Fix (arc 0): smoke feeds name
  `updater-smoke.test`, which no server on public DNS with a publicly trusted certificate can answer
  (T20); `docs/CLOUDFLARE_DEPLOYMENT.md`'s worst case now names the #122 manifests.
  Residual: the legacy manifests in #122.
- **Corrupt or hostile RC key (P).** A well-formed body with a bad signature shadows stable for
  opted-in clients until withdrawn (availability only, L1 #124). `verify-live-feed` at promote and the
  daily digest-bound RC probe detect it.
- **Stale RC after a stable rollback (D, closed by A5).** Rolling stable back below an RC that a GA
  had hidden would serve that RC again; the stable promote deletes a lower RC key.
- **Withdrawal does not revoke (D).** An open prompt or a running download still installs a
  withdrawn RC, and its manifest stays valid (L4 #127). Same class as a stable rollback today.
- **Second desktop instance (P).** On macOS and Linux an instance that loses the port keeps its
  own update task and cached config. The install-time disk read stops it installing an RC after a
  leave in the other instance. Residual: an unrelated settings save in that instance writes its
  stale channel back (L5 #128), an existing property of every setting.
- **Opt-out races (P).** Check in flight: act-time admission. "Update Now" or an automatic
  install after leaving: the install-time re-check after the download. Residual: a change landing
  between that re-check and `install()` still installs the RC (L2 #125). The window is up to about 5 s
  (`record_pending`, then `terminate_and_confirm(5 s)`, `T/src/updater.rs:539,568`) plus the Windows
  marker section, and covers automatic installs too. The RC was offered while the tester was opted
  in. Known limit; a later check takes the next stable above it.
- **Web origin or other window sets the channel (D, closed).** Settings-only capability plus
  `require_label`; no HTTP route reads or writes `developer` (routes `C/server.rs:402-405`); a wiring
  test fails if `packages/presto/server/src` or `C/server*` writes it.
- **Environment (U).** `PRESTO_HOME` selects which `config.json` the desktop reads
  (`C/config.rs:150-159`); controlling the launch environment already equals writing that file.
  Known limit L3 (#126); no channel environment variable exists (wiring guard).
- **Borked config (D, closed).** Lenient block deserializer, `CONFIG_VERSION` pinned, compat fixtures
  and real-binary loads both ways.
- **Least privilege.** No new secret, token or environment. `withdraw-rc` and the RC promote reuse
  `release-feed` and `CLOUDFLARE_RELEASE_FEED_API_TOKEN`; signing reuses `release-signing`. New jobs
  default to `contents: read`.
- **Crypto.** No new primitive: `minisign-verify` (pinned `=0.2.5`) and the plugin's verifier.
- **Supply chain.** No new dependency. The Worker's SemVer compare is about 20 lines over a strict
  grammar, not a package.
- **Frontend.** New text renders with `textContent`; the CSP is unchanged; no inline style or script.

## Assumptions

**Facts**
- One configured endpoint, `https://presto.build/releases/latest.json` (`T/tauri.conf.json:33-36`),
  pinned by `scripts/presto-domain.test.ts:15,46`.
- Plugin 2.11.0: `updater_builder().endpoints()` overrides the list (plugin `updater.rs:224-232`);
  the loop moves on only after a non-2xx, a transport error or a JSON body that is not a release; a
  204 ends the check with no update, and a body that is not JSON ends it with an error
  (`:527-563`); the default comparator is SemVer `>` (`:576-579`).
- `verify_manifest` requires `schema == presto-update-manifest-v1` (`C/update_manifest.rs:167-169`).
- `PrestoConfig` has no `deny_unknown_fields`; a deserialize error yields read-only defaults
  (`C/config.rs:91-123,377-385`); `CONFIG_VERSION` is 2.
- `run_updates` skips a manual request whose receiver is closed (`C/update_schedule.rs:592-593`);
  `ManualCheckSender` is managed state (`T/src/main.rs:1153`).
- Before arc 0, `sign-updater-artifacts` signed a v1 `latest.json` for every version; only stable stages it
  (`release-presto.yml:502-507,977-988`); it also uploads per-platform v1 `smoke-latest.json`
  (`:474-500`). Promote refuses prereleases and requires 17 assets (`:1296-1332`).
- Before arc 0, release smoke feeds pointed at `presto.build/releases/download/*`, which the Worker
  answers with 404 (`packages/release-feed/src/index.ts:1-4,18-21`); arc 0 moves them to
  `updater-smoke.test`.
- On macOS and Linux a desktop instance that loses the port stays resident and keeps its update
  task; only Windows exits (`T/src/main.rs:488-522`). `perform_update` holds a cross-process updater
  lock (`T/src/updater.rs:407-413`).
- #123 (`7153556`) runs every release-smoke leg once per baseline: the greatest lower same-key
  release and the release whose own `latest.json` the live feed serves byte for byte.
- The Settings default view must fit without scroll (`e2e/settings.spec.ts:678-700`); 637 of 648 px
  used (`T/src/windows.rs:189-195`). A2 relaxes it by the Advanced row only.
- `presto-v1.2.0-rc.3` is published (2026-10-15); `release-presto.yml` releases from `main`
  (`:63-68`).

**Inferences**
- Any release dispatched from `main` after arcs 1–2 merge carries the channel; so arcs 1–2 merge only
  after 1.2.0 is published.
- The WebDriver stub answers any manual request from its queue (`T/src/e2e_tray.rs:55-69`), so
  `developer.spec` must run after `tray-update.spec`.
- Until a stable with the channel ships, #123's live-stable baseline is pre-channel, so every RC's
  refusal leg re-proves on real binaries that installed users reject rc-v1.
- No release may be dispatched while `main` holds only part of the arc 1–2 stack; the ruleset may
  land one level at a time (O1).

**Asks (answered 2026-10-15)**
- A1. Approve the IPC table (two new Settings-only commands, one changed). **Approved by the owner.**
- A2. Settings height: raise to the measured fit (about 712–720 px; worsens #116), or keep 680 and
  accept that the default view scrolls (rewrite the no-scroll test). **Keep 680; the default view
  scrolls** (orchestrator): growing the window worsens #116.
- A3. May the implementing session dispatch `smoke-updater-unix.yml`, `smoke-updater-windows.yml`
  and `presto.yml` (all secretless, on its own branch)? `UPDATER_TESTING.md` requires them before merging updater changes.
  If not, they move to Owner steps. **Yes** (orchestrator): client-arc branches are pushed without
  a PR for the dispatches; arc 0's branch only after 1.2.0 publishes.
- A4. Arc 0 (recommended): a separate pipeline-only PR from `main` that skips signing and uploading
  the GitHub-URL v1 feed for prereleases (smoke feeds are built from the unsigned feed) and moves
  every smoke feed's artifact URLs to `updater-smoke.test` (second SAN and hosts line in the
  three release smoke scripts), with T20 in its first form. Its first real run is the next RC's
  publish, whose smokes fail closed if the hosts change is wrong. It merges after the 1.2.0 stable
  publish completes, so that publish runs on an unchanged pipeline, and before the next RC of any
  version. No further 1.2.0 RC is planned and a stable run emits no prerelease manifest, so nothing
  forces it earlier. Without it, every prerelease until arc 3 merges adds usable v1 manifests to
  #122's exposure. **Approved by the owner**; implemented as arc 0.
- A5. Rollback semantics (recommended yes): a stable promote also deletes `latest-rc.json` when its
  version is below the new stable, so a later `promote-only <previous>` cannot bring back an RC that
  the GA had hidden. This makes the stable promote touch the RC key, which changes what a promote
  and a rollback do. **Yes** (orchestrator).

## Owner steps (the implementing agent never performs these)

- O0. Optional, irreversible: delete the `signed-update-feed` artifacts of past prerelease runs
  (`gh api repos/alejoamiras/presto/actions/artifacts --paginate`, match the run to a prerelease
  tag), or let them expire. #122 covers them either way.
- O1. Merge arcs only in order; merge arcs 1–2 only after 1.2.0 is published, and dispatch no
  release while `main` holds only part of arcs 1–3.
- O2. After arc 3 merges: dispatch `deploy-release-feed.yml` (Worker with the RC route and the stable
  guard). Check `curl -s https://presto.build/releases/latest-rc.json | jq .version` equals the stable.
- O3. First live RC protocol. The release after 1.2.0 is the first with the channel, so no installed
  stable can join yet.
  1. Publish its rc.1 (`mode=publish`). Both release-smoke legs must pass on the pre-channel N-1.
  2. Run `release-presto.yml mode=promote-only version=<rc.1> dry_run=true`. Read the pre-flight log.
  3. Run it again without `dry_run`. `verify-live-feed` must show rc.1 on `latest-rc.json` and the
     stable unchanged on `latest.json`.
  4. On one machine per OS, install rc.1 by hand. Turn on Settings → Advanced → Developer mode.
     Choose Updates from: Release candidates. Expect "Up to date".
  5. Publish and promote rc.2 the same way. Expect the rc.2 prompt, or with Auto-Update on the
     install at the next automatic check. Confirm Settings shows rc.2.
  6. Choose Stable. Confirm the leave text and that no update is offered. Turn developer mode off.
     Confirm `config.json` holds the default `developer` block.
  7. On a machine that never opted in, use tray → Check for Updates…. Expect "Up to date".
  8. Drill the withdrawal: `mode=withdraw-rc`, `dry_run` first. `verify-live-feed` must show the
     stable on both routes.
  9. When the GA ships, confirm after its promote that `latest-rc.json` serves the GA (A5).
  10. When that release's stable ships, repeat steps 4–6 from it at the next release's rc.1.
- O5. A broken RC: run `withdraw-rc` first, then tell testers to choose Stable before reinstalling
  stable by hand (a reinstall keeps the RC setting).
- O4. Not needed: A3 is yes.

## Phases

Each phase ends with its gate. Run the fast layers after each meaningful step.

### Phase 0 (A4 approved): stop usable v1 prerelease manifests ✓

Implemented at `ed9dffc`; Codex loop clean in round 2. Not pushed: the push, the dispatches and the
PR wait for the director's word that 1.2.0 has published.

1. Create `rc-update-channel-stop-v1-prerelease-feed` from `main`.
2. In `S/sign-release-updater-artifacts.sh`, skip `sign_feed … latest.json` for a prerelease. Keep
   the smoke feeds, which the signer builds from the unsigned feed.
3. In `make_smoke_feed` and `S/ephemeral-updater.sh`, write artifact URLs on
   `https://updater-smoke.test/releases/download/` (D23).
4. In the three release smoke scripts, add `updater-smoke.test` as a second SAN and a second
   hosts line, and remove both on cleanup.
5. In `release-presto.yml`, upload `signed-update-feed` only for a stable version.
6. Add T20 in its first form: a prerelease run emits no manifest with GitHub URLs, still signs
   every payload with the production key, and every smoke feed names only `updater-smoke.test`.
7. In `presto.yml` `updater-feed-e2e`, run the real signer against a temp repo root with a throwaway
   key and the real `update-manifest` tool, for a prerelease and a stable version.

**Validation gate:** `bun run test`, `bun run lint`, `bun run lint:actions`, shellcheck through
`koalaman/shellcheck:v0.9.0`; per A3, `updater-feed-e2e` through `gh workflow run presto.yml --ref
<branch>` and `positive` on both ephemeral smoke workflows. Pass: T20, the release-contract pins
and the dispatched runs green. Layers: lint, unit (contract), real binaries. Then run the Codex
loop; push and open the PR on the director's word that 1.2.0 has published. The owner merges it.

### Phase 1: developer-mode contract (core, headless) ✓

1. Add `UpdateChannel`, `DeveloperSettings`, `de_developer_lenient`, the `PrestoConfig` methods,
   `ChannelTransition` and `ConfigStore::effective_channel()` in `C/config.rs`.
2. Add compat fixtures: a pre-v2 config, a v2 config without `developer`, and the new writer's output
   with `developer`. A test fails if the writer's output changes.
3. Add a server test that the headless config has the default `developer` block and resolves
   Stable. Keep its `Default`-based construction.
4. Add the T1, T3, T8 (core) and T17 (core) tests and `config_version_stays_two`.

**Validation gate:** `cargo test --locked --manifest-path packages/presto/core/Cargo.toml`,
`cargo test --locked --manifest-path packages/presto/server/Cargo.toml`, `bun run lint:clippy`,
`bun run lint`. Pass: exit 0; the named tests are present and green. Layers: lint, unit.

### Phase 2: developer mode in Settings ✓

1. Add `set_developer_mode` in the six registration places. Set the trust-boundary count to 21.
2. Build the folded Advanced row and the Developer section with its empty custom-bb slot. Keep
   the Settings height at 680 (A2) and rewrite the no-scroll test as under UI.
3. Add Playwright tests: hidden by default, the default view overflows by the Advanced row only,
   the toggle calls the command, an error reverts.
4. Add WebDriver `developer.spec.ts`: on and off persist on disk; the auth popup is denied. Put it
   between `tray-update.spec.ts` and `autostart.spec.ts` in `wdio.conf.ts` (autostart stays last).

**Validation gate:** `cargo test --locked --manifest-path packages/presto/src-tauri/Cargo.toml`,
`bun run --cwd packages/presto test:e2e:ui`, `bun run test`, `bun run lint`; the WebDriver lane
green on three OSes through `gh workflow run presto.yml --ref <branch>` (per A3; `presto.yml` runs
only on PRs and dispatch). Layers: lint, typecheck, unit, UI e2e, WebDriver.

**Arc 1 boundary** (custom-bb may stack on this arc).

### Phase 3: envelope and admission (core) ✓

1. Add `presto-update-manifest-rc-v1`, `ManifestKind`, the rc-v1 ⇒ prerelease check and the `kind`
   return in `C/update_manifest.rs`. Add a schema parameter to `build_signed_envelope`.
2. Add `C/update_channel.rs` with `admits` and `Refusal`. Test the whole 2×3 table.
3. Add rc-v1 and v1-prerelease fixtures signed with a fresh throwaway key. Commit only its pubkey.
4. Extend the `update-manifest` example: `envelope --schema`, the two `verify` modes, and the kind
   in its output. Migrate every caller listed under Release pipeline in the same commit.
5. Extend the `updater-feed-e2e` round trip with the signed fixtures through every `verify` mode,
   and the signer's current outputs (stable feed, v1 smoke twins) through theirs. Phase 7 adds the
   production rc-v1 feed and the rc-v1 twin.
6. Make `S/sign-smoke-feed.sh` derive the schema from the version, with an explicit `--schema v1`.

**Validation gate:** `cargo test --locked --manifest-path packages/presto/core/Cargo.toml`,
`bun run lint:clippy`, `bun run lint`, `bun run test`, `bun run lint:actions`; `updater-feed-e2e`
green through `gh workflow run presto.yml --ref <branch>` (per A3). Pass: a mutation
that makes `admits` admit `(Stable, Candidate)` turns a test red (record it in lessons). Layers:
lint, unit.

### Phase 4: client channel wiring ✓

1. In `T/src/updater.rs` and `T/src/main.rs`, implement the per-check endpoints, the derived RC
   URL, `current_channel` and the `channel=` log line.
2. Add the four admission points: check, act, before the window, and install time (disk re-read
   under the updater lock).
3. Add `set_update_channel` in the six places and set the count to 22. Add the change effects and
   the join check. Add `app_version` and `effective_channel` to `get_system_info`. Rename the
   debug-build log line.
4. Add the src-tauri tests named in T4, T5, T7, T10, T11, T14 and T16.
5. Extend `S/update-wiring.test.ts`: the RC URL is absent from `tauri.conf.json`; admission precedes
   `record_pending` and sits inside `act_on`; channel code reads no environment variable; server
   code never writes `developer`; only `C/config.rs` reads `developer.update_channel`.
6. Extend `scripts/presto-domain.test.ts` for the derived RC URL.

**Validation gate:** `cargo test --locked --manifest-path packages/presto/src-tauri/Cargo.toml`,
`cargo test --locked --manifest-path packages/presto/core/Cargo.toml`, `bun run lint:clippy`,
`bun run test`; from `T`: `cargo check --target x86_64-pc-windows-gnu --lib` (CLAUDE.md
placeholder). Layers: lint, typecheck, unit, Windows compile.

### Phase 5: channel control, prompt copy, real-binary lifecycle ✓

1. Build control B with the status line (no chip), the leave and developer-off checks, the join
   result line and the RC prompt copy (A).
2. Add the Playwright tests named in T4, T7, T8, T16, T17, T18 and T19, and the window-fit cases.
3. Extend WebDriver `developer.spec` (join shows the result and persists `rc`; off resets on disk;
   the channel is refused while off) and `trust-boundary.spec`.
4. Add mode `rc-lifecycle` to `smoke-updater-unix.yml` and `smoke-updater-windows.yml`, their
   allowlists and the `release-contract.test.ts` pins. `S/ephemeral-updater.sh` builds R and signs
   the C1 `rc.2` feed. The feed server gains the RC path, per-path status and a path column in its
   log.
5. Dispatch per A3: `smoke-updater-unix.yml -f mode=rc-lifecycle -f n-version=9.9.9`,
   `smoke-updater-windows.yml -f mode=rc-lifecycle -f n-version=9.9.9`, and `positive` on both.
   Then run the mutation once.

**Validation gate:** `bun run --cwd packages/presto test:e2e:ui`, `bun run test`, `bun run lint`,
`bun run lint:actions`, shellcheck through `koalaman/shellcheck:v0.9.0`; the WebDriver lane green
(dispatched as in Phase 2); `rc-lifecycle` and `positive` green on macOS, Linux and Windows with
run IDs in lessons; the mutation run red on A1, A2 and C1. Layers: all, including real binaries.

**Arc 2 boundary.**

### Phase 6: feed Worker ✓

1. In `packages/release-feed/src/index.ts`, add the stable-route guard, the RC route with the
   SemVer max, and the `/releases/download/*` 404 pin.
2. Test T5, T6 (higher and equal), T12, T14 (503 cases; never 204 or a non-JSON 200) and T15. Test
   HEAD and trailing-slash requests, and that the stable route never reads the RC key.

**Validation gate:** `bun run --cwd packages/release-feed test`,
`bun run --cwd packages/release-feed typecheck`, `bun run test`. Layers: lint, typecheck, unit.

### Phase 7: release pipeline and docs ✓

1. Signer: schema by version, prerelease file names, the two smoke feeds on
   `updater-smoke.test`, the schema assertion. Skip whatever Phase 0 already landed.
2. `release-presto.yml`: the `validate` checks, staging, RC promote, the pre-put guard,
   `withdraw-rc` with its polled read-back, the `verify-live-feed` RC branch, and per A5 the
   lower-RC delete after a stable promote. `update-feed-health.yml`: the digest-bound RC probe.
3. Release smokes: the refusal leg and the positive leg per #123 baseline, the path rule, the
   no-`read-only` assertion.
4. `release-contract.test.ts`: T13, T15, T20 (behavioural), the v1-override pin, the `verify`
   mode allowlist, the `bump_source` refusal, asset counts. Extend `updater-feed-e2e` to the
   production rc-v1 feed and the rc-v1 twin (T20's last assertions).
5. Docs: rewrite `RELEASE_RUNBOOK.md:70` ("RCs never enter the stable feed"); add RC promote,
   withdraw, rollback (A5), the broken-RC response (O5) and the first-live-RC protocol (O3).
   Correct `CLOUDFLARE_DEPLOYMENT.md:67-71` (worst case) and `:115`. Add `rc-lifecycle` to
   `UPDATER_TESTING.md` and the channel boundary to `SECURITY_MODEL.md`. Add joining and leaving to
   the README. Update the CLAUDE.md release and Presto bullets, and fix the stale `sign-update-feed`
   job name there.

**Validation gate:** `bun run test`, `bun run lint`, `bun run lint:actions`; per A3,
`updater-feed-e2e` through `gh workflow run presto.yml --ref <branch>`, and re-dispatch
`positive` and `rc-lifecycle` on both smoke workflows, because step 3 edits scripts they run
(`UPDATER_TESTING.md:36`). Pass: release-contract pins green; smokes green with run IDs in lessons.
Layers: lint, unit (contract), real binaries. Release dispatches stay with the owner.

**Arc 3 boundary**, then the close-out layer.

## Delivery

| Arc | Branch | Phases | Stacks on | `/code-review` |
|---|---|---|---|---|
| 0 (per A4) no prerelease GitHub-URL v1 feed | `rc-update-channel-stop-v1-prerelease-feed` | signer + T20 | `main`, separate PR; merge after the 1.2.0 publish, before the next RC | off |
| 1 developer mode | `worktree-rc-update-channel` | 1–2 | `main` | off |
| 2 RC client | `rc-update-channel-client` | 3–5 | arc 1 | off |
| 3 RC feed and pipeline | `rc-update-channel-feed` | 6–7 | arc 2 | off |
| close-out | `rc-update-channel-close-out` | Outcome, lessons, archive | arc 3 | off |

`gh stack` (confirm with `gh extension list`). The ruleset may force landing one level at a time
(`implementations-plan/lessons.md`, CI and release). Merge order and timing: O1. Parallelism: phase 6
(Worker) is file-disjoint from phases 1–5 and could run as a lane, but saves under 30% of the
critical path, so no lanes.

## Post-implementation

1. **No `/code-review`** (`code_review: off`).
2. **Codex fix loop per arc**, at each arc boundary, before the next arc starts:
   - `~/.claude/skills/codex/scripts/run-codex.sh <prompt> <worktree> high read-only gpt-6.1-sol`.
   - Prompt: the arc's diff, this plan, the decision ledger, the arc map ("arc N of 3, plus arc 0; later arcs
     add …"), an adversarial and security ask, an ask to attack the transition matrix for missing
     transitions, and the two rules below verbatim.
   - Verify each claim against the repo; apply accepted fixes as new commits; re-run the gate; log
     the round in `lessons/arc-<n>-review.md`. A fix that adds persistent state, a lifecycle, a
     coordination protocol, a recovery policy or a public contract is a plan change: stop and ask.
   - Resume with `resume-codex.sh <session> <prompt> <codex-dir> high` until a round has no new
     material finding. Material findings after 3 rounds: stop and surface.
3. **Final cross-arc pass:** a fresh Codex session over the net diff from `7153556`, asking about
   seams between arcs, duplication and drift from this plan; same loop.
4. **Delivery:** only now open PRs: `gh stack sync` if `main` moved, `gh stack submit --auto`, then
   `gh pr edit` each body (runtime before/after for WebDriver and the smokes; smoke run IDs).
5. **Close-out** (top layer `rc-update-channel-close-out`, docs only):
   - `## Outcome` after the front matter: date, status, PRs, what was dropped, `Known limits: #122`
     plus any filed here, `Open items:`, a line retiring the seeds.
   - Promote general gotchas into `implementations-plan/lessons.md` (8 KiB budget; dedupe; retire
     superseded lines; date-stamp tool-version advice).
   - File open items: actionable work → GitHub issue (dedupe with `gh issue list --state all
     --search`); a known limit → closed `known-limit` issue; a suspected exploitable weakness →
     private draft advisory, never public text. Do not migrate `follow-ups.md` here.
   - `git mv implementations-plan/rc-update-channel implementations-plan/archive/rc-update-channel`
     in its own commit; repair links (`git grep -n rc-update-channel`); move the `index.md` line to
     `archive/index.md`.
   - `gh stack submit --auto`; `gh pr checks --watch` on every PR; report and stop. The owner merges.
6. **Teardown after the merge:** once `git fetch -q origin main && git cat-file -e
   FETCH_HEAD:implementations-plan/archive/rc-update-channel/plan.md` succeeds: `ExitWorktree` with
   `keep` if this session entered through `EnterWorktree`, then `agent-worktree done
   rc-update-channel --merged`. It refuses rather than forces; relay a refusal and stop. A `/loop`
   session checks on every firing; a `/goal` session arms one background wait after its wrap-up:
   `until <that check>; do sleep 300; done`.

**No-over-engineering rule** (verbatim in every post-implementation Codex prompt): *"Report bugs and
small, targeted improvements only. Do not propose speculative abstractions, extra configuration
surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and
is clear, leave it alone."*

**Comment-quality rule** (verbatim): *"Audit the comments for value per character. Flag any comment
that narrates what the code visibly does, restates its line, references implementation plans / phases /
reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant
or constraint deserves a comment it doesn't have. Comments are permanent context every future reader,
human or LLM, pays to re-read: they must be few, dense, and exact."*

While implementing: comments to that bar as you write; log attempts in `lessons/phase-N.md`;
`agent-worktree status rc-update-channel "phase N green: <next>"` at each gate; stop after 3 failures
on one step (5 under `/loop`).

## Decision ledger

| # | Decision | Source | Rejected | Status |
|---|---|---|---|---|
| D1 | Separate RC route; Worker serves the higher key | driver, Opus | client max of verified feeds (Codex r1: more selection logic in the security path for an availability fault); `?channel=rc` (one code path where a Worker bug serves RC to stable); pipeline dual write on every promote | settled r2 |
| D2 | RC clients fall back to the stable endpoint (12 s each) | Opus | single RC endpoint | settled |
| D3 | rc-v1 for production RC feeds; smoke feeds v1 + rc-v1 | Codex/Opus r2 (Y), Opus D1 | X (pre-channel clients on server guards alone); Z (blocks the first channel RC's smoke, guards no reachable path) | settled r2 |
| D4 | Worker refuses a prerelease on the stable route; promote key from version | director | — | settled |
| D5 | Admission at check, act and install | Opus, Codex | install-gate claim on setting change (Codex r1) | settled |
| D6 | Join = held-receiver live manual check | Opus (code-verified) | non-live (Codex r1, retracted) | settled |
| D7 | `developer` block, lenient, reset on off, `CONFIG_VERSION` 2 | all | remember-on-off (Opus A1) | settled (director contract) |
| D8 | promote-only only; `withdraw-rc`; refuse `bump_source` on prerelease | all | move on publish | settled |
| D9 | Three-build `rc-lifecycle` real-binary mode | driver (testing mandate) | per-transition modes (cost) | settled; legs per D20 |
| D10 | Client arcs merge after 1.2.0 | driver | — | owner step O1 |
| D11 | Settings stays 680 px; the default view scrolls by the Advanced row only | A2, orchestrator | grow to about 716 px (worsens #116) | settled |
| D12 | Join check present-only; later automatic checks follow Auto-Update (Q4) | director check 1, `decide` | — | settled |
| D13 | No v1 GitHub-URL manifest for any prerelease, test-proven (T20) | director check 2 | comment-only assurance | settled; arc 0 (A4) |
| D14 | Smoke feeds name a reserved host (`updater-smoke.test`, D23) | Opus + Codex audit | known limit only | settled; arc 0 |
| D15 | Install-time admission re-reads `config.json` from disk | Opus + Codex audit | cross-instance reconciliation | settled; residual L5 |
| D16 | Stable promote deletes a lower RC key | Opus audit; A5, orchestrator | leave stale key | settled |
| D17 | RC health probe binds bytes to the release asset digest | Opus audit | verifier in the probe job; structural only | settled |
| D18 | Channel clients refuse every v1 prerelease | Opus audit (its round-1 position) | admit legacy on Rc | settled |
| D19 | Admission also before the window; `verify --channel` required | Opus + Codex audit | — | settled |
| D20 | `rc-lifecycle` C1 serves a higher RC, C2 proves GA through fallback; B pins endpoint order | Opus + Codex audit | C1 older stable, C2 left channel | settled |
| D22 | `verify` has two modes: `--channel` (admission) and `--smoke` (no admission, `updater-smoke.test` URLs only); every caller migrates at once; real round trip in CI | final Codex pass | one mode (would abort every RC publish on the v1 twin) | settled |
| D21 | Rejected outright | panel | a signed `channel` field (a schema split in disguise); a separate RC key (a new secret); the plugin's `version_comparator` (checks unsigned fields); moving the RC key on publish (Cloudflare credentials in the publish path); refusing setting changes during an install (new coordination, Codex r1) | settled |
| D23 | The reserved smoke host is `updater-smoke.test` | driver at arc 0; director accepted; arc 0 Codex review concurred | `updater-smoke.invalid`: RFC 6761 §6.4 lets resolver APIs answer NXDOMAIN before the hosts file, which can defeat the smokes' hosts line. `.test` must not be special-cased (§6.2); both are undelegated and no public CA issues for either | settled |

## Audit verdicts

| Round | Reviewer | Verdict | Outcome |
|---|---|---|---|
| Contradiction check | Codex (Sol, high) | 7 findings (1 high) | all verified and applied |
| Contradiction check | Opus | 16 findings (6 medium) | all verified and applied |
| Double audit | Codex (Sol, high) | conditional | applied; multi-instance → disk re-read + L5 |
| Double audit | Opus (fresh) | conditional | applied; rollback → A5 |
| Final pass | Codex (fresh) | conditional: the v1 smoke twin fails every `--channel` (it would abort RC publishes); `presto.yml` and `S/ephemeral-updater.sh` call `verify` without the new flag | applied as D22 |
| Final pass, resumed | Codex (same session) | conditional: stage T20 across Phases 3 and 7; let the CI harness call `--smoke` | applied; no open condition |
| Approval gate | owner (A1), orchestrator (rest) | approved 2026-10-15 | answers above |
| Arc 0 fix loop | Codex (Sol, high) | r1 fix (3 low: doc scope, ephemeral URL pin, stale comments); r2 clean | applied in `ed9dffc`; `lessons/arc-0-review.md` |

Size: about 810 lines against the 600 target. The testing mandate (matrix, real-binary legs,
owner protocol) and the IPC table account for the excess; restatement was cut.

## Seeds

```
/goal All phases marked ✓ in implementations-plan/rc-update-channel/plan.md, each backed by its validation gate reported passing in the transcript, including the rc-lifecycle smoke run IDs on macOS, Linux and Windows; for each phase `LESSONS_FILE=implementations-plan/rc-update-channel/lessons/phase-N.md` printed; /code-review NOT run; the Codex fix loop converged at arc 0 and at each of the 3 arc boundaries and in the final cross-arc pass, each evidenced by a resumed Codex pass with no new material findings quoted in the transcript; the arc 0 PR and the stacked PRs (3 arcs + close-out) exist, created only after all loops converged and after the director's word that 1.2.0 has published (`gh stack view` output in the transcript), the close-out archived the plan (`git show --stat` of the archive-move commit); `bun run test` and `bun run lint:actions` exit 0 in the transcript.
```

```
/loop 15m Drive implementations-plan/rc-update-channel forward per its plan.md (read plan.md, lessons/ and the Outcome & Quality Bar each firing; on a stack read them from the top layer). If plan.md is gone, check `git fetch -q origin main && git cat-file -e FETCH_HEAD:implementations-plan/archive/rc-update-channel/plan.md`: merged → ExitWorktree (keep) if entered via EnterWorktree, then `agent-worktree done rc-update-channel --merged`, report, clear this loop and stop; not merged → babysit CI only. Otherwise take the next pending step, run the fast layers after each edit, commit, push with `gh stack push`. Decisions: consult `/codex high` on gpt-6.1-sol and log them; never merge, publish, deploy or dispatch release workflows; never expand scope. Phase green = its gate as written. At an arc boundary run the Codex loop first. All phases ✓ → final cross-arc pass, Delivery, close-out, `gh pr checks --watch`, wrap-up report, stop. Same step failing 5 times → reassess with Codex.
```

Recommended: `/goal` (completion is visible in the transcript). Use exactly one per session.

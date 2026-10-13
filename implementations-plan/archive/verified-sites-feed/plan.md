---
plan: verified-sites-feed
tier: deep
status: completed 2026-10-13
base: 3ebb19b
driver: claude-code
eli5_mode: artifact
code_review: off
claude_model: opus
codex_model: sol
harden: none (declined by the owner at the gate)
delivery: two sequential PRs (publishing path, then client)
---

## Outcome

- **2026-10-13: completed.** PR 1 #92 (`34784d2`) shipped the publishing path. The first signed
  record landed through release-bot PR #93 (`14c4085`) and is live at
  `https://presto.build/releases/verified-sites.json` (publish run 38480207618). PR 2 #100 is the
  client, and this close-out rides as its final commits.
- **Shipped in PR 1:**
  - the strict list parser and minisign verifier in core;
  - the signer CLI and its round trip;
  - `sign-verified-sites.yml`, behind the owner's approval of `verified-sites-signing`;
  - append-only history, PR-gated by the `verified-sites-feed` job;
  - `publish-verified-sites.yml` with its KV guard, and the daily health probe;
  - the Worker route.
- **Shipped in PR 2:**
  - **Core:** the verified, locked, never-backwards cache (`store.rs`) and the bounded HTTPS fetch
    (`fetch.rs`).
  - **App:**
    - `build.rs` embeds the newest record;
    - the registry replaces whole, persists before it swaps, and re-judges under its write lock;
    - the refresh runs on the update check's cadence through the production `run_updates`;
    - the 25-case integration test runs on every OS.
  - **WebDriver:** the feed, the spec, and the hook in `e2e_tray.rs`.
  - **Release:** the `PRESTO_E2E_` scan over every bundle in `release-presto.yml`'s `build` job (D22).
  - **Docs:** `VERIFIED_SITES.md`, `PRIVACY.md` and `CLAUDE.md`.
- **Evidence:** `lessons/pre-pr.md` has the CI run IDs, `lessons/pr-1-review.md` and
  `lessons/pr-2-review.md` the Codex loops (both converged), and `lessons/phase-*.md` each gate
  with its mutations.
- **Changed or dropped, each recorded in the ledger or lessons:**
  - O1b (a narrowed agent token) was skipped by the owner (A3 reversed).
  - `start_background_tasks` gained `spawn_production_refresh(app)`, not a literal `spawn_refresh`
    line, because the pinned key parses into an `Option`.
  - Case 19: a FIFO at the cache path is replaced by the save; only a directory fails it.
  - The skip-the-refresh mutant fails at step 2, not step 4.
  - `autostart-test.sh` copies `LICENSE`, fixing a breakage already on `main`.
  - Each "rebase on `origin/main`" became a merge of `main`, because PR 1 landed as a squash.
  - Open follow-ups went to GitHub issues instead of `follow-ups.md`.
  - The PR 2 review's case-19 subprocess harness was declined, since the core FIFO test is
    deadline-bound.
  - tauri-plugin-webdriver's early-returning `refresh()` is harmless noise, noted only.
- **Open items:** #94 (no expiry), #95 (the approval gap, a second approval factor), #96 (Firefox
  extensions), #97 (the O8 canary, after the first release with the client), #98 (auth-flow's
  `afterEach`). **Known limits:** #99 (a same-user symlink at `~/.presto`). Owner steps O6 (merge
  PR 2) and O7 (release and promote) are the delivery itself.
- **This plan's `/goal` and `/loop` seeds are retired.** This file is a record of what was decided,
  not instructions.

# Signed, remotely fetched verified-sites list

Move `packages/presto/verified-sites.json` out of the build into a list signed in CI with a dedicated
Ed25519 key and served by the release-feed Worker, so recognised sites can be added or removed
without an app release. The badge stays display-only: it never grants authorization.

## Outcome & Quality Bar

**For whom.**
- A Presto user deciding whether to click Allow in the authorization popup. The friendly name and ✓
  must be current (a dead or abandoned origin loses it within hours), and no one but the curator may
  be able to add one.
- The owner, the only maintainer, publishing a change: one merge plus one approval, with the exact
  change in front of him when he approves.
- A future maintainer: the client's trust rules fit on one screen, and every failure mode has a test.

**Excellent looks like.**
1. **One merge plus one approval.** The approval page shows the source commit, the version and the
   previous one, the SHA-256 of the exact bytes to be signed (with a command that reproduces it), the
   unified diff and the origins and names added, removed or renamed, and every signing-path file
   changed since the last signed list.
2. **Clients follow without a release.** A client checks about 5 s after launch and then whenever 6 h
   have passed (sampled every 15 min). On a healthy network a change reaches it at its first check
   after the live write has propagated (KV propagation and the Worker's 60 s KV read cache, usually about a
   minute; Worker responses are not edge-cached), with no app release.
3. **Without the signing key, nothing changes a badge.** A network attacker, a Cloudflare KV or Worker
   holder, or a local file can withhold or replay an older signed list, never forge one. Bad input
   (tampered, wrong-key, older, same-version-different, malformed, schema-violating or oversized
   lists; slow, hung, 404, 5xx or absent servers; corrupt or forged local state) changes nothing, and
   never crashes Presto or delays startup, the popup or the update check. A named test proves each case.
4. **Removals win.** A signed list that drops an origin removes its badge, including one the built-in
   copy lists, from the first popup after the fetch, and after a restart whenever the cache could be
   written (otherwise from the launch check, about 5 s after a restart).
5. **The updater is untouched.** Its source files and workflow steps are byte-identical, and its tests
   and the three updater smokes pass while the list fetch fails (their feed server answers the list's
   path with 404).
6. **No release binary carries a test hook.** The hooks compile only with the `webdriver` feature,
   which no release build can enable and only the WebDriver gate (which uploads logs, never binaries) builds with
   (K3, K4). The release workflow scans what ships for the `PRESTO_E2E_` prefix before upload (D22), as
   every updater-smoke build already is, and the WebDriver build proves the scan fires.
7. **Every signed list is public before it is live**, as a release-bot commit on `main` that stock
   `minisign -V` can check, and the next app build embeds the newest one.

**Good enough stops at.** No freshness guarantee: a withheld list keeps the last good one. One trusted
key at a time. No Settings UI for names, no Firefox identity, and an already-open popup keeps the badge
it showed (popups close after 60 s).

## Scope

**In:** list format, validator and verifier; CI signer and keyed-run key provisioning; client fetch,
verification, rollback floor, persistence and registry swap; built-in copy from the newest signed
record; Worker path; sign and publish workflows with the history bot PR; daily live probe; WebDriver
E2E and the failure-mode matrix; list content changes; docs.

**List content (delivered in PR 1):**
- The "Nulo Wallet" entry becomes **"Nulo"**, with `https://nulo.sh` and
  `chrome-extension://jlmiaokmjoicmclelpiiocdhncddkdmc` (the Nulo Chrome extension; its listing is
  updated in place and keeps this ID). Description: "Wallet for the Aztec network".
- Remove `https://faucet.nulo.sh` (no longer resolves) and
  `https://presto-playground.alejo-amiras.workers.dev` (no longer the canonical address).
- Keep `https://playground.presto.build` ("Presto Playground") and `https://yacana.network` ("Yacana").
- No version labels for any product in the list or the docs.

**Out:** Firefox identity (see Rejected), a Settings UI for names, the headless server (it never used
the registry), the updater key and its code and workflow steps, new IPC commands or ACL grants.

## Architecture & Implementation

### Decisions

| # | Decision | Source |
|---|---|---|
| D1 | The signed bytes are **exactly `packages/presto/verified-sites.json` at the source commit**, as humans edit it. Nothing is canonicalized; history stores the same bytes. | Codex, Opus |
| D2 | The curator bumps `version` in every list PR. A PR-gate test requires `version > H` (H = newest record) unless the bytes equal record H, and `version ≤ H + 100` (a typo cannot burn the counter). CI never invents a number. | Codex, Opus; bound from Opus |
| D3 | The source keeps `schemaVersion: 1` and gains `version`. Domain separation comes from the dedicated key, the fixed trusted comment and the envelope schema, so PR 1 needs no loader change. | Opus (driver had an in-payload `schema` string) |
| D4 | Signatures are minisign **`ED`** (Ed25519 over BLAKE2b-512) with the fixed trusted comment `presto-verified-sites-v1`, which the client requires byte for byte. Key ID = the first 8 bytes of SHA-256(public key). Verified with the pinned `minisign-verify =0.2.5`, `allow_legacy = false`. | all; comment and key ID from Opus |
| D5 | **History** is `history/<N>.json` (the exact signed bytes) plus `history/<N>.json.minisig` (a stock minisign signature file): readable diffs, and checkable with `minisign -Vm <N>.json -p key.pub`. | Opus (driver and Codex stored envelopes) |
| D6 | The **served document and the client cache** are one envelope: `{"schema":"presto-verified-sites-envelope-v1","list":"<b64>","signature":"<b64>"}`. Every published envelope is built by the Rust CLI. The E2E feed's Bun wrapper is held to the same bytes through one committed fixture envelope: a core test asserts `document(list, sig)` equals it, and the feed's test asserts the feed produces it. One request carries list and signature. | all |
| D7 | **CI stores the raw 32-byte seed** (hex), not a minisign secret-key file. The signer is a dependency-free Bun script. | all three |
| D8 | **No separate floor file.** The floor is the version inside the verified cached envelope; a forged or corrupt cache cannot raise it and is simply replaced by the next accepted list. | all three |
| D9 | Effective list = the higher version of {built-in, verified cache}; a fetched list replaces it whole (no union). Identity is the signed list bytes, never the envelope or the signature file (minisign's first line is unauthenticated): equal version with identical list bytes is a no-op; equal version with different list bytes is equivocation, refused and logged `SECURITY:`. Gaps are allowed. | all |
| D10 | The list check runs in **its own `run_updates` task**: memory-only `ScheduleStore`, closed manual channel, `busy = || false`, under the same `should_poll_for_updates()` gate. The update task is not touched. | all (Codex first) |
| D11 | The built-in copy is **the newest history record**, chosen by `build.rs`; the build fails if there is none, so there is **no unsigned bootstrap** and the client ships only after the first signed list exists. The runtime does not re-verify it: compiled-in bytes gain nothing from it, and it would deadlock a key rotation. PR-gate tests verify every record. | Opus (driver had a version-0 bootstrap) |
| D12 | The pinned key is `packages/presto/verified-sites/key.pub` (stock minisign public-key file), `include_str!`'d by src-tauri. Core takes keys as parameters; the CLI takes a path. | Opus |
| D13 | **History before live.** `sign-verified-sites.yml` (prepare → sign → verify-signed → record) ends in a release-bot PR; its merge triggers `publish-verified-sites.yml` (verify → publish → verify-live), which writes KV only from a record on `main`. | Codex, driver. Opus's draft wrote KV first; both contradiction checks and the Codex audit chose history first (it alone delivers Excellent #7 and approval-free KV restores) |
| D14 | **Secret-holding jobs install, build and verify nothing.** Secretless jobs before them compute the hash and after them verify the output. The signer runs from `$RUNNER_TEMP` (no repo `bunfig.toml`, `.env` or `node_modules`). The KV write is `curl` to the Cloudflare API with compare-before-write, not wrangler. | Opus, extending the driver's |
| D15 | Test keys: committed fixtures use the **RFC 8032 §7.1 TEST 1 and TEST 2** public vectors (deterministic, regenerated byte for byte in the PR gate); the E2E feed signs with TEST 2 as well; only the CI round trip generates a throwaway seed, inside the job. No key of any kind is generated on a workstation, and no production key outside the keyed run. | consolidation (driver: in-memory throwaways; Opus: labelled-hash seeds; Codex: CI-only fixtures) |
| D16 | Stricter schema: origins `https` or `chrome-extension` only, canonical, unique; `displayName` 1–64 printable ASCII; no backtick, `<` or `>` in any string field, so nothing can break the approval summary's fenced diff. | driver, Opus; confirmed at the gate (A4) |
| D17 | Keep the popup's per-origin badge latch: new popups read the swapped registry; an open one keeps its badge for at most 60 s. | driver, Opus (Codex: remove it) |
| D18 | Persist, then swap. A failed cache write is logged and still swaps memory; disk only moves forward. | driver, Opus (Codex: refuse the swap) |
| D19 | WebDriver hooks live in the existing `e2e_tray.rs` (one `cfg` site, K1–K2 unchanged in shape); the scan needle becomes the `PRESTO_E2E_` prefix. | Opus (driver had a new module) |
| D20 | **Two sequential PRs**: PR 1 the publishing path (no client code), PR 2 the client, branched from `main` after the first record merges. Close-out rides as PR 2's final commits. | Opus (driver: 3 stacked arcs; Codex: 1 PR); approved at the gate (A2) |
| D21 | `update_schedule.rs` and every updater file stay byte-identical: the capped non-blocking reader is mirrored (about 20 lines), not generalized, so the regression proof is a plain `git diff --exit-code`. | Opus (driver generalized it) |
| D22 | `release-presto.yml`'s `build` job gains one secretless step, after the bundles exist and before upload, running `assert-no-test-hooks.sh` over what ships: macOS `*.app.tar.gz` (the `.app` the DMG also packs), Linux `*.AppImage` and `*.deb`, Windows `Presto.exe` (the installer is LZMA-compressed; this is the binary it packs). The script learns `.tar.gz` and `.deb`. No other line of the workflow changes, and `sign-updater-artifacts`, the only job that reads the updater key, is untouched. | Codex F8, accepted by the owner at the gate |

### Formats

**Source file** (`packages/presto/verified-sites.json`, bytes signed as-is):
```json
{
  "$schema": "./verified-sites.schema.json",
  "schemaVersion": 1,
  "version": 1,
  "entries": [
    {
      "origins": ["https://nulo.sh", "chrome-extension://jlmiaokmjoicmclelpiiocdhncddkdmc"],
      "displayName": "Nulo",
      "description": "Wallet for the Aztec network",
      "curatedBy": "alejoamiras",
      "addedAt": "2026-05-28"
    }
  ]
}
```
(Presto Playground and Yacana entries stay. Biome never rewrites it: `biome.json`'s `*.json` include
matches the repository root only, so the list and its history copies stay byte-identical.)

**Validation** (one strict Rust parser in core, used by the app, the CLI, CI and every test):
- `deny_unknown_fields` at every level. List bytes ≤ 64 KiB.
- `$schema`: optional, exactly `./verified-sites.schema.json`. `schemaVersion`: exactly 1.
- `version`: integer, 1 ≤ v ≤ 2^53 − 1 (exact in JS and Rust).
- `entries`: 0–256 (empty is valid: it removes every badge). `origins`: 1–16 per entry, ≤ 256 bytes
  each, ASCII in raw form, scheme `https` or `chrome-extension`, already canonical
  (`canonicalize_origin(o) == o`), unique across the list.
- `displayName`: 1–64 printable ASCII (0x20–0x7E) without `<`, `>` or backtick, no leading or trailing
  space.
- `description`: optional, ≤ 200 bytes, no control, bidi or zero-width characters, no `<`, `>` or
  backtick (Yacana's "—" stays legal). Never shown.
- `curatedBy`: GitHub username grammar (1–39). `addedAt`: a real `YYYY-MM-DD` date (`time`, already a
  core dependency).
- `verified-sites.schema.json` and `VERIFIED_SITES.md` are updated to match; the schema stays editor
  documentation.

**Signature file** (`<N>.json.minisig`, minisign's format, exactly four `\n`-terminated lines, ≤ 1 KiB):
```
untrusted comment: presto verified-sites list version <N>
<base64("ED" ‖ key_id[8] ‖ Ed25519(seed, BLAKE2b-512(list)))>
trusted comment: presto-verified-sites-v1
<base64(Ed25519(seed, signature[64] ‖ "presto-verified-sites-v1"))>
```
Ed25519 is deterministic, so re-signing the same bytes yields the same file.

**Public key file** (`verified-sites/key.pub`):
```
untrusted comment: presto verified-sites public key <KEYID>
<base64("Ed" ‖ key_id[8] ‖ public_key[32])>
```
KEYID is displayed as minisign does: `{:016X}` of the little-endian key ID.

**Envelope** (served at `https://presto.build/releases/verified-sites.json`, KV key
`verified-sites.json`, and cached by the client): compact JSON, fixed field order,
`deny_unknown_fields`, standard base64. Caps checked before decoding: document ≤ 96 KiB, decoded list
≤ 64 KiB, decoded signature ≤ 1 KiB.

**Repository layout** (`packages/presto/verified-sites/`, CODEOWNERS):
- `key.pub`: the one pinned key.
- `retired-keys/<KEYID>.pub`: keys moved out at a rotation (absent until the first one).
- `history/<N>.json`, `history/<N>.json.minisig`: written only by the release bot, never edited.
- `signing-key.env.example`: the keyed-run template.

### Version rules

| Where | Rule |
|---|---|
| PR gate (`core/tests/verified_sites_repo.rs`, in `presto.yml`) | Source parses strictly; `version > H`, or `== H` with bytes equal to record H; `version ≤ H + 100`, with H = 0 before the first record (`prepare` applies the same bound). Every record parses, has `version == N`, pairs with a `.minisig`, and verifies under `key.pub` or `retired-keys/<its KEYID>.pub`; the first record is at most 100 and consecutive records differ by at most 100, so no record can jump the counter to an absurd value. File names match `^[1-9][0-9]*\.json(\.minisig)?$`, and no record, signature or `key.pub` contains `\r`. `key.pub` is neither a test-vector key nor the updater key. |
| PR gate (`verified-sites-feed` job) | No path that exists at the base under `history/` or `retired-keys/` is modified, deleted, renamed away or changed in type; additions are allowed (a rotation moves `key.pub` into `retired-keys/`). The base is the PR base, or `git merge-base origin/main HEAD` on a dispatch. |
| `prepare` | Sign iff the source differs from record H, or record H is not signed by the pinned key (rotation; then `version > H` is required). Fail if live is ahead of history or equal-but-different. |
| `publish` | Write only the newest record; skip if KV already holds it; refuse if KV (read through the API) holds a higher version, the same version with different list bytes, or a list signed by a different key than the record (so a key change, legitimate or not, needs the owner's KV delete first). |
| CI reading the live list (prepare, publish, probe) | A live document is checked against the record of its version: byte-equal list, and its signature verified under that record's key (`key.pub`, or `retired-keys/<KEYID>.pub` after a rotation). New signatures always use `key.pub`. The client trusts only `key.pub`. |
| Client `judge(current, candidate)` | Higher: Accept. Equal and identical: Unchanged. Equal and different: Equivocation (`SECURITY:` error). Lower: Older (debug log: normal right after an app update). |

### Client

**Core module** `presto_core::verified_sites` (strict lints of `update_schedule.rs`:
`deny(unwrap_used, expect_used, panic, indexing_slicing, arithmetic_side_effects)`):

| File | PR | Responsibility |
|---|---|---|
| `mod.rs` | 1 | Constants (schemas, trusted comment, caps, `MAX_VERSION`), `ListError`. |
| `list.rs` | 1 | `SiteList`: the strict parser and validator (moved and tightened from `src-tauri/src/verified_sites.rs::try_load`), `version()`, `display_name(origin)`. `parse_unsigned` names the trust decision at each call site. |
| `verify.rs` | 1 | `ListKey` (from a `.pub` document), `verify_list(bytes, sig, key)`, `document(list, sig)`, `verify_document(bytes, key)`, `judge`. The pattern of `update_manifest.rs` steps 1–3 is copied, the updater module is not refactored. No minisign types leak. |
| `store.rs` | 2 | `ListStore { load, save_if_newer }` (outcomes below): capped `O_NONBLOCK` regular-file read (mirrors `read_capped`), verify, `write_private_atomic` under `lock_exclusive_within` (1 s) on a blocking thread. `save_if_newer` re-reads and re-verifies the file under the lock, never lowers it, and returns the winner (the candidate, or a newer list another instance wrote), so memory can never go below a verified disk floor. |
| `fetch.rs` | 2 | `Feed { url, key, timeout, https_only }` with `Feed::production(key)` (the constant HTTPS URL, `https_only`; src-tauri passes the pinned key), `fetch_document`: reqwest, `redirect::Policy::none()`, 10 s connect / 30 s total, `User-Agent: presto`, no query, cookies or body, 200 only, `Content-Length` over the cap rejected early and a running byte counter after (the `downloader.rs` idiom), no retries. |

**src-tauri** (PR 2): `verified_sites.rs` is rewritten around
`VerifiedSites { current: RwLock<Arc<SiteList>>, store: ListStore }`:
- **Load before `.manage`** (synchronous, no network, no lock): parse the built-in, read and verify the
  cache under the pinned key, keep the higher version (D9). Any cache failure keeps the built-in and
  logs. A built-in that fails to parse (prevented by the repo test and a src-tauri test that parses the
  embedded copy) yields an empty registry and an error log, never a panic.
  Choosing here means a signed removal holds from the first popup after a restart.
- **`spawn_refresh(app, feed, manual_rx)`**, called from `start_background_tasks` under the existing
  gate: `run_updates` with `LAUNCH_DELAY` and `WAKE_TICK`, a private `ScheduleStore::new(None, …)`
  (never `.manage`d), `busy = || false`, `check = refresh`, `act` = answer the reply if any.
  `reached_feed()` is true for any 200 within the caps, valid or not (as the updater counts a refused
  candidate); anything else retries at the next 15-minute tick.
- **`refresh`**: fetch → `verify_document` → `judge` against the current list → on Accept,
  `save_if_newer` on a blocking thread, which answers `Saved`, `DiskNewer(list)`, `Equivocation` or
  `WriteFailed` → re-judge the winner against the current list and swap under the write lock.
  `Equivocation` (the disk holds a verified, different list at the fetched version) swaps nothing.
  Only `WriteFailed` (including `write_private_atomic` reporting an error after its rename,
  `updater_state.rs:383`) lets the candidate win in memory alone (D18), and never over a verified disk
  list it already read. No lock is held across the fetch.
- **`get_verified_info`** keeps its name, DTO and `require_auth_window` guard; its body calls
  `verified_info(&VerifiedSites, &str) -> Option<VerifiedSiteDto>`, which the integration test also
  calls. No IPC or ACL change.
- **Cache**: `~/.presto/verified-sites-accepted.json` (next to `update-schedule.json`), lock
  `verified-sites-accepted.json.lock`, 0600 in 0700. WebDriver builds keep it in memory.
- `should_poll_for_updates()` (`PRESTO_NO_UPDATE`, debug unless `PRESTO_FORCE_UPDATE_CHECK`) is the one
  knob for background calls to presto.build. The Auto-Update preference only decides install versus
  prompt (`main.rs:320`), so the list check runs exactly when update checks run.

**`build.rs`** (PR 2) replaces the JSON syntax check: pick the largest `history/<N>.json`, refuse
malformed names, a missing `.minisig` or any `\r` in the chosen record or `key.pub` (a CRLF checkout
would change the signed bytes), fail if none, emit `rerun-if-changed` on the directory, and
expose the chosen path through `cargo:rustc-env`; `verified_sites.rs` `include_bytes!`s it.

### Signing and provisioning (Bun, built-ins only)

**`packages/presto/scripts/verified-sites-signer.ts`** (exports `normalizeSeed`, `deriveKey`,
`publicKeyDocument`, `keyIdHex`, `signList`; reused by provisioning, fixtures and the E2E feed):
- Ed25519 via `node:crypto` `createPrivateKey` on PKCS#8 DER `302e020100300506032b657004220420 ‖ seed`;
  `Bun.CryptoHasher("blake2b512")` for the prehash.
- Reads the seed only from `PRESTO_VERIFIED_SITES_SIGNING_SEED`, normalizes it against
  `^(0x)?[0-9a-fA-F]{64}$` without echoing it, then deletes the variable.
- `sign --list <f> --pubkey <f> --expect-sha256 <hex> --out <f>`: refuses unless the derived public-key
  document equals `--pubkey`, the list is ≤ 64 KiB, its SHA-256 equals the expected one and its
  `version` is a safe integer; self-verifies with `crypto.verify`; prints only version, hash and KEYID.
- `pubkey`: prints the public-key document.

**`packages/presto/scripts/provision-verified-sites-key.ts`** (the keyed run; modes default,
`--restore`, `--rotate`):
0. Launched as `bun --no-install --no-env-file --config=/dev/null …`, so no `.env` file or bunfig
   preload runs beside the seed (`--config` needs the `=` form: `--config /dev/null <script>` exits 0
   without running the script).
1. Read and delete the seed and `GH_TOKEN`; on an invalid seed or a missing or multi-line token print
   a fixed message and exit 2. Every `gh` child gets `PATH`, `HOME`, `GH_TOKEN`, `GH_HOST=github.com`,
   an empty `GH_CONFIG_DIR` (no stored host, credential or alias applies) and the no-prompt and
   no-update-notifier switches; the token is never printed.
2. Read-only `gh api` preflight of `environments/verified-sites-signing`: exactly one required-reviewers
   rule naming exactly one reviewer, the user `alejoamiras` (GitHub accepts one approval from any
   listed reviewer), `can_admins_bypass: false`, custom branch policies exactly `[main]`. Refuse
   otherwise, so the secret never lands somewhere weaker.
3. Derive the key; refuse if it equals a test-vector key or the updater key, and refuse if the
   updater key in `tauri.conf.json` cannot be read as a well-formed minisign key.
4. Mode preconditions from `gh secret list --env verified-sites-signing` and the committed `key.pub`:
   default needs both absent; `--restore` needs `key.pub` equal to the derived key; `--rotate` needs it
   different.
5. `Bun.spawn(["gh","secret","set","VERIFIED_SITES_SIGNING_SEED","--env","verified-sites-signing","--repo","alejoamiras/presto"])`
   with the 64 lowercase hex characters on **stdin**, a child environment without the seed, and output
   captured; on failure a fixed message. Then confirm the name is listed.
6. Print **only** the two-line public-key document and `Key ID: <KEYID>`. No exception text that could
   carry input. Writes no files.

**Template** (`verified-sites/signing-key.env.example`, Keyed-Runs item `Presto-VerifiedSites`):
```
# Keyed-run template for scripts/provision-verified-sites-key.ts: the Ed25519 seed that signs the
# verified-sites list. op-remote generates it once; 1Password is its backup of record.
# op: generate hex32
PRESTO_VERIFIED_SITES_SIGNING_SEED=op://Keyed-Runs/Presto-VerifiedSites/PRESTO_VERIFIED_SITES_SIGNING_SEED
# A fine-grained token for this repository only: Actions read, Environments read and write.
# op: import
GH_TOKEN=op://Keyed-Runs/Presto-VerifiedSites/GH_TOKEN
```

**Why the seed and not a minisign secret-key file:** op-remote generates exactly `hex32`; the 1Password
value and the CI value are the same 32 bytes, so `--restore` is the whole recovery; a minisign secret
key means scrypt, a checksum and a password stored next to it, which protects nothing and adds a format
to hand-write; GitHub masks the exact secret string and env-exec masks its hex form. The in-app
verifier stays `minisign-verify`.

**CLI** `packages/presto/core/examples/verified-sites.rs` (hand-rolled arguments, as
`examples/update-manifest.rs`): `check` (PR mode, or `--publish` with `--live <doc>|--live-absent`,
writing outputs and the summary), `document <list> <sig>`, `verify --document <f> --pubkey <f>
[--expect-sha256] [--expect-version]`, `diff <old> <new>` (added and removed origins, renamed names),
`newest <history dir>`.

### Workflows

Both: `permissions: contents: read` at the top, per-job narrowing, no `inputs:`, a `main` assertion
first, existing SHA pins only, `cancel-in-progress: false`, every `$(…)` assignment in an `if`-checked
statement (lessons: `bash -e` gaps).

**`sign-verified-sites.yml`**: `push` to `main` on `packages/presto/verified-sites.json` or
`…/verified-sites/key.pub`; `workflow_dispatch` (retry). `concurrency: verified-sites-sign`.
1. **prepare** (no secrets): checkout (`persist-credentials: false`, full depth); refuse while a
   `chore/verified-sites-*` branch exists (a record still waiting: signing past it could leave a second,
   unrecorded signature for the same version; the failed run notifies the owner, who dispatches this
   workflow again once that record merges); build the CLI; fetch the live
   document (200 → verify; 404/503 → absent: a notice while history is empty, a warning otherwise,
   since publish restores it; anything else → fail); `check --publish`. The summary shows the source
   commit, version, previous (history and live), SHA-256 with
   `git show <sha>:packages/presto/verified-sites.json | sha256sum` (or `shasum -a 256` on macOS), the
   semantic diff (every
   curator-written value rendered as inline code, which the backtick ban makes unbreakable, so a name
   like `![Approved](https://…)` shows as text), the unified diff in a fence, and the tripwire: signing-path files (`*-verified-sites.yml`, the signer,
   the whole core crate (the CLI, its modules, manifest and lockfile), `rust-toolchain.toml`, a root
   `.cargo/`, `verified-sites/key.pub`, `retired-keys/`,
   `.github/actions/{bot-push,bot-pr,setup-presto}`, `.github/scripts/{bot-push,bot-pr}.sh`,
   `.bun-version`, `packages/release-feed/src`) changed since the
   commit that first gave `verified-sites.json` record H's bytes (found by blob hash, so a change merged
   between H's approval and its recording is still shown). Outputs `sha`, `version`, `sha256`, `sign`.
2. **sign** (`environment: verified-sites-signing`, `if: sign`, timeout 10 min): sparse checkout of
   `prepare.sha` (the list, `key.pub`, the signer, `.bun-version`); setup-bun; require the list's hash
   to equal `prepare.sha256`; `git fetch --depth=1 origin main` (git, never a CDN-cached raw URL) and
   require, by `git rev-parse origin/main:<path>`, its list and every signing-path file
   (the tripwire's set) to be the same blobs as at `prepare.sha`, else fail as "stale" (a re-run keeps
   its original commit, so this stops an old signer from meeting today's seed); copy the signer
   and list to `$RUNNER_TEMP` and run them there with `bun --no-install --no-env-file --config=/dev/null`
   (outside a `node_modules` Bun would otherwise fetch a bare import from npm), the seed only in that
   step's env; upload `list.json` and `list.json.minisig`.
3. **verify-signed** (no secrets): build the CLI; the list hash equals `prepare.sha256`; production
   `verify` with the pinned key and the expected version; output the artifact hashes.
4. **record** (`permissions: {}`): mint the release-bot App token (contents and pull requests); check
   out `main`; download into `$RUNNER_TEMP`; hashes equal `verify-signed`'s; if `history/<V>.json`
   exists, identical → stop, different → fail; copy both files; `bot-push` exactly those two paths to
   `chore/verified-sites-<V>` with `if-exists: skip`; if the branch already existed, its two files must
   equal the verified artifact (else fail); `bot-pr` with squash auto-merge, the run URL and hash in
   the body. Re-running this job is the recovery for an interrupted record.

**`publish-verified-sites.yml`**: `push` to `main` on `packages/presto/verified-sites/history/**`;
`workflow_dispatch` (republish after a KV loss; needs no signing approval because it only publishes
records from `main`). `concurrency: verified-sites-publish`.
1. **verify** (no secrets): build the CLI; newest record N verifies under the pinned key; build the
   envelope; read the live document (public URL); skip if identical; fail if live is ahead or
   equal-but-different; upload the envelope; outputs `version`, `document_sha256`, `write`, and the
   tree hash of `verified-sites/history` and blob hash of `key.pub` at this run's commit.
2. **publish** (`environment: release-feed`, `permissions: {}`, nothing installed): download, hash
   check; then, immediately before the write and in the same job (so re-running only this job cannot
   skip it), `git fetch --depth=1 origin main` into an empty repository (public, no token) and require
   the same history tree and `key.pub` blob, else fail as stale (a re-run keeps its old commit, and
   could otherwise restore an obsolete record into a deleted key). One step with
   `CLOUDFLARE_RELEASE_FEED_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, token passed to curl via a header
   file descriptor (never argv): GET the KV value through the API, then
   `.github/scripts/verified-sites-kv-guard.sh <kv value> <candidate>` (jq and base64 only) decides:
   absent (404 with error 10009) → write; identical list → skip; a higher version, the same version with
   different list bytes, or a different signing key (read from the signature's key ID, without trusting
   it) → refuse. PUT with 5 retries, require `success == true`. Output `write_attempted`.
3. **verify-live** (`always() && write_attempted`, no secrets): poll the public URL for up to 10 min
   until its SHA-256 equals `document_sha256`.

**`presto.yml` `verified-sites-feed` job** (new filter group; part of `presto-status`): append-only
check; the repo test; CI round trip with a throwaway seed (`openssl rand -hex 32`, step env only):
production `sign` → production `document` → production `verify`; negatives that must fail: the
production key (wrong key), a tampered list, an edited trusted comment, a same-version-different list
against history, an unknown field, a pin mismatch in the signer; then `check` writes the diff against
live to the summary (a failed fetch only warns).

**`verified-sites-health.yml`** (new, daily and on dispatch, `contents: read`, no secrets;
`update-feed-health.yml` stays untouched): verify the live list; fail if live is ahead of history or
equal-but-different in list bytes (KV written outside this flow), behind the newest record more than
an hour after its merge (a failed publish), or signed by a key other than `key.pub`'s (a key swap on
`main`, or a rotation not yet published); a notice while history is empty.

### Worker

`packages/release-feed/src/index.ts`: an exact path → key `Map` (no prototype lookups)
(`/releases/latest.json` → `latest.json`, `/releases/verified-sites.json` → `verified-sites.json`), the
same headers and the same 404, 405 and 503 (only 503 is `no-store`, as today). Tests cover both paths, a missing key, a trailing
slash, 405, and that the keys never cross. Deployed only by the owner through `deploy-release-feed.yml`.

### WebDriver hooks and E2E (PR 2)

- **Hooks in `e2e_tray.rs`** (D19): `PRESTO_E2E_VERIFIED_SITES_URL` (loopback `http://127.0.0.1:<port>/`
  only) and `PRESTO_E2E_VERIFIED_SITES_PUBKEY`. When both are valid, `start` calls the production
  `spawn_refresh` with that feed (`https_only` off) and a 1 s pump through its manual channel; otherwise
  no task. The production task never starts in WebDriver builds (they skip `start_background_tasks`).
- **Guards:** K2 also expects the two names in `e2e_tray.rs`; `assert-no-test-hooks.sh` scans for the
  `PRESTO_E2E_` prefix; `_e2e-webdriver.yml`'s teeth step proves its own binary carries all three names.
- **Feed** `packages/presto/scripts/verified-sites-e2e-feed.ts`: Bun server on `127.0.0.1:0`, lists
  signed by the production `signList` with the public RFC 8032 TEST 2 key and wrapped as the CLI does;
  modes `none` (404), `with`, `without`, `tampered`; `POST /control?serve=<mode>`, `GET /control`
  (serve counts); writes `{url, pubkey, control, pid}` to a state file. `_e2e-webdriver.yml` starts it
  before Launch app and kills it by PID; `run-webdriver-local.sh` starts it in an owned process group and
  also exports `PRESTO_E2E_TRAY_REPORT`, which it lacks today.
- **Spec** `e2e-webdriver/verified-sites.spec.ts` (after auth-flow, before ultra-honk; tray-update
  stays directly before autostart), one popup for `https://verified-sites-e2e.example.com`, the whole
  sequence under 45 s (the server's 60 s decision deadline does not restart on a refresh), with an
  explicit spec timeout above Mocha's 30 s default, each poll bounded at 5 s (the pump runs every 1 s),
  and the pending `/prove` request awaited and cleaned up at the end:
  1. `none`: no badge; if the newest record is not empty, its first origin answers with its name.
  2. `with` (version 9 000 000 001, adds the test origin and drops that built-in origin): poll
     `get_verified_info` until the name appears; the built-in origin, if any, now answers null;
     refresh; badge visible.
  3. `tampered` (9 000 000 003, bad signature): after ≥ 2 serves nothing changes; refresh; badge still
     visible.
  4. `without` (9 000 000 002): poll until null; refresh; badge hidden.
  5. Deny the popup.

### File-level change map

**PR 1, publishing path** (branch `worktree-verified-sites-feed`; app code changes only in tests):
- Core: `core/src/verified_sites/{mod,list,verify}.rs`, `core/src/lib.rs`, `core/examples/verified-sites.rs`,
  `core/tests/verified_sites_repo.rs` (Phase 3: it needs `key.pub` and the `version` field),
  `core/tests/fixtures/verified_sites/*`.
- Scripts: `verified-sites-signer.ts`, `provision-verified-sites-key.ts`, `verified-sites-fixtures.ts`,
  their tests.
- Data: `verified-sites/{key.pub,signing-key.env.example}`, `verified-sites.json`,
  `verified-sites.schema.json`.
- Pins of the old content: `src-tauri/src/verified_sites.rs` tests, `e2e/authorize.spec.ts`,
  `scripts/presto-domain.test.ts`.
- Worker: `packages/release-feed/src/index{,.test}.ts`.
- CI: `{sign,publish}-verified-sites.yml`, `.github/scripts/verified-sites-kv-guard.sh` and its test, `presto.yml` (new job, `changes` output, `presto-status`),
  `verified-sites-health.yml`, `.github/filters/presto.yml` (a `verified_sites_feed` group; the two
  new workflows also in `release_tooling`, as `bot-pr.test.ts` requires of every bot-pr user; and
  `packages/release-feed/**` routed to `release_tooling`, whose `lint` job gains explicit release-feed
  `typecheck` and `test` steps and a longer timeout), `.gitattributes` (`-text` for the list,
  `verified-sites/**` and `core/tests/fixtures/verified_sites/**`, so Windows checkouts keep LF),
  `ci-filter-contract.test.ts`,
  `scripts/cloudflare-deployment.test.ts` (KV writes only in `release-presto.yml` and the publish job,
  by API, no wrangler there), `scripts/bot-pr.test.ts` (new bot-pr user), new
  `scripts/verified-sites-workflows.test.ts`, `.github/CODEOWNERS`.
- Docs: `VERIFIED_SITES.md`, `docs/RELEASE_RUNBOOK.md` (the environment as a stated exception to "no
  reviewers", publishing, recovery, restore, rotation, the emergency, confirming a `key.pub` change
  before a release, and the stuck-record cases: a list merged while a record PR waits (dispatch signing
  again after it merges), a record PR failing its checks (bump the version, update the branch), or a
  closed record branch (delete it)), `docs/SECURITY_MODEL.md` (trust boundary and the
  accepted approval gap), `SECURITY.md`, `CLAUDE.md`.

**PR 2, client** (branch `verified-sites-feed-client` from `main` after `history/1` merges):
- Core: `store.rs`, `fetch.rs` and their tests.
- src-tauri: `build.rs`, `src/verified_sites.rs`, `commands.rs`, `main.rs` (load before `.manage`; one
  `spawn_refresh` line), `e2e_tray.rs`, `tests/verified_sites_feed.rs`.
- E2E: the feed and its test, `verified-sites.spec.ts`, `helpers.ts`, `wdio.conf.ts`,
  `_e2e-webdriver.yml`, `run-webdriver-local.sh`, `assert-no-test-hooks.sh` and test,
  `webdriver-only-hooks.test.ts`, `autostart-test.sh` (copies `verified-sites/` into its tree).
- Release scan (D22): one step in `release-presto.yml`'s `build` job, pinned by
  `packages/presto/scripts/release-contract.test.ts`. `scripts/cloudflare-deployment.test.ts` pins only
  the KV write and the `release-feed` environments there, so it needs no change.
- CI: `presto.yml`'s `platform` matrix runs `cargo test --test verified_sites_feed`. Filters: records
  (`history/**`) stay in the `verified_sites_feed` group only, whose job runs the repo test (the same
  core parser and verifier the app uses, and the record rules `build.rs` relies on), so a history PR's checks, and
  so publishing, stay short (D13); `key.pub` (rare, and compiled in) joins `rust_platform`,
  `desktop_runtime` and `windows_packaging`; the source list leaves the desktop lanes (no longer
  compiled in). The WebDriver spec reads the newest record at run time.
- Docs (`VERIFIED_SITES.md`, `PRIVACY.md`: the list request beside the update check, and that check's
  real cadence, launch then every 6 h, which the file still gives as 12 h) and the close-out.
- **Untouched in both:** the updater key, `core/src/{update_schedule,updater_state,update_manifest,file_lock}.rs`,
  `src-tauri/src/{updater.rs,updater/,update_menu.rs,update_marker.rs}`, `tauri.conf.json`,
  `release-presto.yml` (apart from D22's one added step), `update-feed-health.yml`, the updater jobs in `presto.yml`, and `packages/presto/scripts/{sign-release-updater-artifacts.sh,ephemeral-updater.sh,updater-smoke.sh,updater-smoke-linux.sh,updater-smoke-modes.sh,updater-smoke-windows.ps1,updater-feed-server.ts,sign-smoke-feed.sh,assert-update-schedule.ts}`.
  (`assert-no-test-hooks.sh`, which the smokes call, does change: its needle widens and it learns
  `.tar.gz` and `.deb`; the targets the smokes pass behave as before.)

### Key rotation (an app release)

1. Point the template at a new item `Presto-VerifiedSites-<yyyymm>` (the old item stays as the retired
   key's backup) and push.
2. File the `--rotate` keyed run; the owner runs `op-remote create` and `op-remote`. From here signing
   fails closed until step 4, because the signer refuses a seed that does not match `key.pub`.
3. A PR moves the old key to `retired-keys/<OLDKEYID>.pub`, writes the new `key.pub` and bumps `version`.
4. The owner merges and approves; a new-key list is recorded. `publish` refuses the key change, so the
   owner deletes the live KV value and dispatches `publish-verified-sites.yml`, which takes it live.
5. The owner releases and promotes the app. Old-key clients keep their last list until the updater
   (separate key) moves them; their old-key cache then stops verifying, the floor falls to the built-in,
   and the next fetch is accepted. For a compromise, step 5 is immediate.

**Emergency: a stolen key and KV access served a list that is not in history** (an absurd version,
say). `prepare` and `publish` refuse while live is ahead of history, so the owner first deletes the KV
value (`wrangler kv key delete verified-sites.json --remote --namespace-id …`, owner only), then
dispatches `publish-verified-sites.yml`, which restores the newest record into the absent key, then
rotates (steps 1–5). Clients that already accepted the forged list keep it until the rotation release
reaches them; the badge stays display-only throughout.

## Security & Adversarial Considerations

**Threat model.**

| Actor | Can | Control | Residual |
|---|---|---|---|
| Agent or token acting as the owner (`repo` scope, SSH push) | Land a change (the ruleset needs 0 approvals) and approve its own signing run with one API call; dispatch workflows; change environments; overwrite environment secrets; push a workflow that mints the release-bot identity (its secrets are repository-wide); or skip signing altogether with one PR that swaps `key.pub` and adds a self-signed record | Required reviewer; the summary and tripwire; every list is a public bot PR before it is live (the App authors it, so CODEOWNERS requests, and notifies, the owner); `publish` refuses a key change and the daily probe alarms on one, so a swapped key never goes live without the owner's KV delete; the release runbook asks the owner to confirm any `key.pub` change since the last release; display-only blast radius | **Accepted by the owner.** The reviewer is a pause, not an independent identity; a token that can push and merge still acts as the owner in every other way. Agents hold that token too (O1b declined, 2026-10-13), so an agent can approve a signing run with one API call. |
| Malicious workflow or script change on `main` | Exfiltrate the seed when an approved run starts | Tripwire lists signing-path changes; secret jobs run no repo dependency | Accepted: `main` is the trust boundary (`RELEASE_RUNBOOK.md`). Rotate if it happens. |
| Malicious PR | Propose entries or signing-path changes | Owner review; strict parser; append-only check; fork PRs get no secrets; the environment is `main`-only | — |
| Cloudflare KV-token, account or Worker holder (KV Storage Edit is account-wide) | Withhold, or replay any signed list at or above a client's floor | Signature; floor; equivocation refusal; caps | Freeze; fresh or cache-wiped clients accept a replayed list between their built-in and the newest. |
| Network attacker | Block, stall, truncate | TLS, signature, caps, deadlines, no redirects | Freeze only. |
| Local same-user process | Delete or corrupt the cache | Built-in fallback; a forged file fails verification and is overwritten by the next accepted list | It already owns the app. |
| Signing-key holder (CI compromise) | Sign anything, including a near-maximum version that freezes clients | Rotation by release (old-key caches stop verifying) | Window until clients update. |
| Other processes on the keyed-run host | Read the seed from the run's environment during the run | One short run; nothing in argv or on disk | Same-user exposure for seconds. |

**Least privilege.**

| Job | Token | Secret | Installs |
|---|---|---|---|
| prepare, verify-signed, verify, verify-live, PR gates, probe | `contents: read` (or `{}`) | none | setup-presto where the CLI is built, without `bun install` (no lifecycle script runs beside the CLI) |
| sign | `contents: read` | the seed, in the signing step only | none; sparse checkout; one Bun file run from `$RUNNER_TEMP` |
| record | `{}` plus an App token (contents, pull requests; about 1 h) | the App key, used only by the token action | none |
| publish | `{}` | KV token and account ID, in the write step only | none (curl, jq, base64) |

Contract tests pin all of this, plus the absence of `inputs:`.

**Approval gap (accepted) and its mitigations:** no inputs to inject; signing bound to the hash shown at
approval and to `main` still holding it; content restricted so the summary cannot be spoofed; records
create-only and public before going live; probe; display-only blast radius (no approval, deny-by-default,
cooldown or `/health` decision reads the registry); rotation runbook. Agents keep the owner's token
(O1b declined), so nothing technical stops an agent from approving; the owner accepted that.

**Cryptography.** Verification: `minisign-verify =0.2.5` (already trusted by the updater), key ID first,
`allow_legacy = false`. Signing: Bun's `node:crypto` Ed25519 (BoringSSL) and `Bun.CryptoHasher`
BLAKE2b-512. No new crypto dependency, no custom primitive; only minisign's documented container is
serialized, and every CI run and test round-trips it through the Rust verifier. Domain separation: a
dedicated key (a test asserts it differs from the updater's), the trusted comment and the envelope
schema.

**Input validation:** caps before decoding, `deny_unknown_fields`, canonical origins, restricted
characters, bounded counts, a FIFO-safe capped cache read, exact Worker path map.

**Supply chain:** no new npm or Cargo dependency; frozen lockfiles; 7-day npm floor untouched; existing
action pins only; no secret-holding job installs anything (lessons: `--frozen-lockfile` still runs
lifecycle scripts). Residual: the pinned Bun binary runs with the seed.

**Seed handling:** one step's environment; deleted after reading; never in argv, files, artifacts or
output; the provisioning child gets it on stdin only; a leak test checks every common encoding.

**Privacy:** one GET with `User-Agent: presto` and nothing about origins, approvals or the user, under
the same switch as the update check.

**Residual risks:** the approval gap; freeze (no expiry); rollback within the window for fresh clients;
the seed in the environment secret (a merged and approved malicious workflow can steal it); a stalled
history PR delays publishing (the owner presses Update branch); the uninstaller leaves the cache
(harmless; a reinstall keeps the floor); an absurd record forced past a disabled PR gate would wedge
the counter with no supported recovery under append-only history.

## Assumptions

### Facts (verified on 3ebb19b unless noted)

- **The registry today** is embedded and read only by `get_verified_info`:
  `src-tauri/src/verified_sites.rs:20` (`include_str!`), no `deny_unknown_fields`;
  `commands.rs:63` (`VerifiedSitesState`), `:522-533` (the command, `require_auth_window`);
  `main.rs:1146` (`.manage`); `capabilities/authorize.json` grants it to `auth-*` windows only.
- **Display-only:** `core/src/authorization.rs` `is_auto_approved` / `is_approved` take no registry; the
  headless server never references it.
- **Popup:** caches the badge per origin and renders with `textContent` (`frontend-src/authorize.js:30-44`).
- **Reusable:** `minisign-verify = "=0.2.5"` (`core/Cargo.toml:40`), `verify(…, false)` in
  `update_manifest.rs`; `run_updates(store, clock, launch_delay, tick, manual, busy, check, act)`
  (`update_schedule.rs:543`) with `Observation::{reached_feed, in_progress}`; `ScheduleStore::new(None, …)`
  is memory-only (`main.rs:273-280`); `write_private_atomic` (`updater_state.rs:361`, `pub(crate)`);
  `lock_exclusive_within` (`file_lock.rs:100`, `pub(crate)`, blocking); `read_capped`
  (`update_schedule.rs:294`, private).
- **Polling:** `should_poll_for_updates()` (`main.rs:258-272`); the Auto-Update preference only feeds
  `decide` (`main.rs:320`).
- **Core is `build.rs`-free** by design (`core/Cargo.toml:26-28`).
- **Worker:** one exact path (`release-feed/src/index.ts`); route `presto.build/releases/*` covers a
  sibling; KV `cacheTtl` 60.
- **Contract tests that constrain placement:** `scripts/cloudflare-deployment.test.ts:116-142` (one
  `wrangler kv key put` and two `environment: release-feed` in `release-presto.yml`; the deploy workflow
  never writes KV); `webdriver-only-hooks.test.ts` K2 forbids `PRESTO_E2E_` outside `e2e_tray.rs`;
  `scripts/bot-pr.test.ts` lists every bot-pr user; `ci-filter-contract.test.ts` pins the groups.
- `run-webdriver-local.sh` sets no `PRESTO_E2E_` variable.
- **Release-bot PRs** are authored and merged by the release-bot GitHub App with squash
  auto-merge (PR #90) and run the full PR gates. `bot-push` is create-only.
- **Live settings (2026-10-03, re-checked 2026-10-08):** environments `release-feed` and
  `release-signing` have branch policy `main`, no reviewers, `can_admins_bypass: true`;
  `verified-sites-signing` does not exist yet; the `main` ruleset requires the four status checks
  (strict), 0 approvals, no code-owner review; `Landing Status` is not required; the agent token is the
  owner's `gh` OAuth token with `repo` scope, and stays so (O1b declined, 2026-10-13). `origin/main` is still `3ebb19b` on
  2026-10-08, so every recon fact stands.
- **Fine-grained token permissions** (GitHub's "Permissions required for fine-grained personal access
  tokens", 2026-10-08): `POST …/actions/runs/{id}/pending_deployments` needs **Deployments: write**;
  environment secrets need **Environments** (read to list them or fetch the public key, write to set or
  delete); getting an environment or its branch policies needs **Actions: read**; creating or changing
  an environment or its branch policies needs **Administration: write**; repository secrets need
  **Secrets**; dispatch, re-run and cancel need **Actions: write**.
- **env-exec** (`KEYED_DENY_RE`) reserves `GIT_` but not `GH_` or `GITHUB_`, so `GH_TOKEN` is a valid
  template name, and `gh` reads it natively. `# op: import` makes `op-remote create` ask the owner to
  paste the value; every `# op:` secret of one template lives in one 1Password item.
- **Published 1.2.0-rc.1 bundles:** the `.deb` holds `usr/bin/Presto`, the `.app.tar.gz` holds
  `Presto.app/Contents/MacOS/Presto`, and neither contains `PRESTO_E2E_`; the current scanner passes
  both once extracted.
- **Live origins (2026-10-03):** `faucet.nulo.sh` does not resolve; the workers.dev alias returns 200;
  the Chrome ID's listing links `nulo.sh`.
- **Biome ignores nested JSON:** `biome check packages/presto/verified-sites.json` reports the path as
  ignored (`biome.json` includes `*.json`, root only).
- **`gh secret set`** reads the value from standard input when `--body` is absent (`gh secret set --help`).
- **Bun 1.4.2** signs Ed25519 from a PKCS#8-wrapped seed and supports `blake2b512`; `.bun-version` is
  1.4.0.

### Inferences (attack these)

- **I1** A merge made by the release-bot App's auto-merge triggers `push` workflows (App installation
  tokens trigger runs; `GITHUB_TOKEN` does not). No push-triggered workflow on `main` has run off a bot
  merge yet to confirm it. Fallback: the owner dispatches the publish workflow (no inputs), and the
  probe alarms.
- **I2** A workflow added in a merge runs on that merge's push. Fallback: dispatch.
- **I3** A run waiting for environment approval holds its concurrency group. (GitHub documents the
  rest: at most one pending run per group, and a newer one replaces it.) If not, two sign runs could
  wait at once; the sign job's check that `main` still holds the approved bytes fails the stale one.
- **I4** Bun 1.4.0 behaves as 1.4.2 for Ed25519 and BLAKE2b (the CI round trip proves it).
- **I5** The environment API accepts `prevent_self_review` and `can_admins_bypass`; the read-back
  confirms.
- **I6** The Cloudflare KV values API answers a missing key with 404 and error code 10009. Cloudflare's
  API reference confirms the rest (GET returns the raw bytes; PUT takes an `application/octet-stream`
  body stored as given) but not the missing-key answer, so publish treats only that exact answer as
  "absent" and fails on anything else.
- **I7** tauri-plugin-webdriver can refresh an auth window (it already refreshes other windows,
  `helpers.ts:112`). Fallback: the same origin in a fresh popup after the 30 s deny cooldown.
- **I8** (moot: O1b and its probe were dropped, 2026-10-13.) GitHub checks a fine-grained token's
  permission before it looks at the run, so a token without Deployments write gets 403 even for a run
  with nothing pending.
- **I9** Job summaries render while a later job waits for approval.
- **I10** Hard-coding the RFC 8032 vectors (fixtures and the E2E feed), and generating one throwaway
  key inside the CI round-trip job, is within the owner's key-handling constraint: none has authority,
  and none is generated on a workstation.

### Gate answers (owner, 2026-10-08)

- **A1 Test keys (D15, I10):** accepted.
- **A2 Delivery (D20):** two sequential PRs, approved.
- **A3 Narrowed agent token:** yes, before the keyed run: owner step O1b, verified by the agent with
  four expected 403s. O2's template imports a separate owner token for provisioning, so the keyed run
  never depends on the agents' token. **Reversed by the owner on 2026-10-13: O1b skipped** (decision
  ledger).
- **A4 Tightening (D16):** confirmed. It cannot exclude a Firefox entry that would otherwise work:
  `moz-extension` UUIDs differ per browser profile, so none can be listed; the rule only codifies that.
- **A5 `/harden`:** none.
- **Codex F8 (release-binary scan):** accepted, reversing the plan's rejection; D22.

## Owner steps (the implementing agent never performs these)

- **O1 Create the `verified-sites-signing` environment** (before the keyed run).
  - **UI:** Settings → Environments → New environment → `verified-sites-signing` → Configure.
    1. Tick **Required reviewers**, add `alejoamiras`. Leave **Prevent self-review** unticked (otherwise
       the only maintainer can never approve his own merge). No wait timer.
    2. Untick **Allow administrators to bypass configured protection rules**. Save protection rules.
    3. Deployment branches and tags: **Selected branches and tags** → Add rule → Ref type **Branch**,
       pattern `main`.
    4. Add no secrets or variables by hand.
  - **Done 2026-10-09** with the owner's `gh`. Read-back: reviewer `alejoamiras` only,
    `prevent_self_review: false`, `can_admins_bypass: false`, branch policy `main` only, no secrets.
  - **API** (from the owner's own `gh`):
    ```sh
    id=$(gh api users/alejoamiras --jq .id)
    jq -n --argjson id "$id" '{wait_timer:0,prevent_self_review:false,can_admins_bypass:false,
      reviewers:[{type:"User",id:$id}],
      deployment_branch_policy:{protected_branches:false,custom_branch_policies:true}}' |
      gh api --method PUT repos/alejoamiras/presto/environments/verified-sites-signing --input -
    gh api --method POST repos/alejoamiras/presto/environments/verified-sites-signing/deployment-branch-policies \
      -f name=main -f type=branch
    gh api repos/alejoamiras/presto/environments/verified-sites-signing \
      --jq '{can_admins_bypass, policy: .deployment_branch_policy,
             rules: [.protection_rules[] | {type, prevent_self_review, reviewers: [.reviewers[]?.reviewer.login]}]}'
    gh api repos/alejoamiras/presto/environments/verified-sites-signing/deployment-branch-policies \
      --jq '[.branch_policies[] | {name, type}]'
    ```
- **O1b Narrow the agents' GitHub token: dropped.** The owner declined it on 2026-10-13, so its
  verification is dropped too and agents keep the owner's `gh` token (decision ledger). The steps
  below are kept as the record of what was offered; nothing waits on them.
  1. GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate
     new token. Resource owner `alejoamiras`; repository access: every repository agents on this host
     work in (or all repositories); an expiry of the owner's choosing. Repository permissions:
     - **Actions: read and write** (dispatch, re-run and cancel the test workflows; read runs and
       environments);
     - **Checks: read**, **Commit statuses: read** (`gh pr checks`);
     - **Contents: read and write**, **Pull requests: read and write**, **Issues: read and write**;
     - **Workflows: read and write** (only HTTPS pushes and API edits under `.github/workflows` use
       it; this clone pushes over SSH, but `gh`'s git protocol here is `https`);
     - **Metadata: read** (mandatory);
     - **no access** to Administration, Deployments, Environments, Secrets, Variables or anything else.
  2. On this host, in the owner's own shell: `gh auth logout --hostname github.com --user alejoamiras`,
     then `gh auth login --hostname github.com --with-token` and paste the token, then Ctrl-D. (`gh`
     notes that fine-grained tokens can confuse it on resources outside their scope; the verification
     below exercises what agents use.) The logout deletes the old token from this host only; it stays
     valid until the owner revokes the GitHub CLI authorization under Settings → Applications, which
     signs `gh` out everywhere that uses it. That is the owner's call.
  3. **Verification** (the agent runs it with its own `gh` once the owner says the switch is done, and
     reports the output):
     ```sh
     gh auth status --hostname github.com    # one account; the token starts github_pat_
     gh api repos/alejoamiras/presto/environments/verified-sites-signing --jq .name
     env_id=$(gh api repos/alejoamiras/presto/environments/verified-sites-signing --jq .id)
     run_id=$(gh run list --repo alejoamiras/presto --status completed --limit 1 --json databaseId --jq '.[0].databaseId')
     gh api -i --method POST "repos/alejoamiras/presto/actions/runs/$run_id/pending_deployments" \
       -F "environment_ids[]=$env_id" -f state=rejected -f comment='permission probe, expected 403'
     gh api -i --method DELETE repos/alejoamiras/presto/environments/verified-sites-signing/secrets/PRESTO_PERMISSION_PROBE
     gh api -i --method DELETE repos/alejoamiras/presto/environments/verified-sites-signing/deployment-branch-policies/0
     gh api -i --method DELETE repos/alejoamiras/presto/actions/secrets/PRESTO_PERMISSION_PROBE
     ```
     Pass: the status shows one `github_pat_` account, the read prints `verified-sites-signing`, and
     each of the four probes returns **HTTP 403**, the first with `deployments=write` in
     `X-Accepted-GitHub-Permissions`. Nothing here can approve or delete anything real: the review call
     names a completed run (nothing pending) and asks to reject, and the deletes name a secret and a
     branch-policy id that do not exist. A token that held the permission would get 422 or 404
     instead, which fails the check; so does any other status. On a failure the agent stops and reports.
- **O2 Keyed run** (after Codex has reviewed the scripts, and after O1): the
  agent files
  `env-exec request --template packages/presto/verified-sites/signing-key.env.example --slug verified-sites-key -- bun --no-install --no-env-file --config=/dev/null packages/presto/scripts/provision-verified-sites-key.ts`
  and relays `op-remote create <host> <id>` then `op-remote <host> <id>` (the host's ssh alias is in
  `~/.agents/machine.md`). `op-remote` shows the pinned commit before it asks; the owner confirms it is
  the commit the agent reported (its scripts byte-identical to the Codex-reviewed revision). The agent commits the printed public key as
  `verified-sites/key.pub`.
  - **The provisioning token** (`op-remote create` asks for it, `# op: import`): a fine-grained token
    separate from the agents' `gh` login, resource owner `alejoamiras`, only `alejoamiras/presto`, **Actions: read** (the environment
    preflight), **Environments: read and write** (list, public key, set), **Metadata: read**, nothing
    else, a short expiry. The script refuses to run without it, so provisioning never uses the agents'
    `gh` login. Revoke it after the run; a later `--restore` or `--rotate` pastes a fresh one into the item's
    `GH_TOKEN` field.
- **O3 Merge PR 1** (not while a `release-presto` run is in flight).
- **O4 Deploy the Worker:** dispatch `deploy-release-feed.yml`; `/releases/verified-sites.json` returns
  503 and `/releases/latest.json` still 200.
- **O5 Approve the signing run** the PR 1 merge started, after checking its summary (version 1,
  previous 0, "first publish", the hash reproducible with the printed command). The history PR
  auto-merges (press Update branch if it stalls) and the publish workflow takes it live.
- **O6 Merge PR 2.**
- **O7 Release and promote** as usual. Its WebDriver gate runs the new spec.
- **O8 (optional canary)** a description-only list change (version 2): merge, approve, then confirm an
  installed app's `~/.presto/verified-sites-accepted.json` reaches version 2.

## Phases

Every gate includes `bun run lint` and `bun run test`, plus the commands listed. **Mutation rule**
(lessons): each new guard is shown failing against a deliberately broken variant, then reverted; the
round is logged in `lessons/`. No phase is done until its gate passes.

### PR 1: publishing path

**Phase 1: format, verifier, CLI, the signer's signing functions and fixtures.** ✓ The fixtures are
generated by `verified-sites-signer.ts`'s exported functions, so they land here; its `sign` command
and provisioning come in Phase 2.
- Gate: `cargo test --locked --manifest-path packages/presto/core/Cargo.toml`;
  `cargo clippy --locked --manifest-path packages/presto/core/Cargo.toml --all-targets -- -D warnings`;
  `bun test packages/presto/scripts/verified-sites-fixtures.test.ts` (byte for byte).
- Pass: every validator rule has an accepting and a refusing test; fixtures (lists 4, 5, 6 where 6
  drops an entry of 4; 5 equivocating, wrong key, bad comment, legacy `Ed`, tampered; 7 unknown field,
  non-canonical, `http`, bidi name; not JSON; oversized) each verify or fail for exactly their reason;
  `check --publish` renders a name like `![Approved](https://example.invalid/a.png)` as inline code;
  the four `judge` outcomes; envelope caps and strict base64; `canonicalize_origin` returns the
  extension origin unchanged.
- Mutations: `allow_legacy = true`; skip the trusted-comment check; equal-but-different returns
  Accept; drop `deny_unknown_fields`; admit `http`.
- Layers: unit, contract.

**Phase 2: `sign` command, provisioning and round trip.** ✓ Codex-reviewed (below); O1 done
(2026-10-09), O1b dropped, O2 done (2026-10-13, key ID `49A083C1A11B3947`).
- Gate: `bun test packages/presto/scripts/verified-sites-signer.test.ts packages/presto/scripts/provision-verified-sites-key.test.ts`;
  `bun run --cwd packages/presto typecheck`; a local round trip with the RFC 8032 key through `sign`
  and the CLI's `verify`.
- Pass: the signer matches RFC 8032 TEST 1's public key; its output verifies in Rust; pin mismatch,
  hash mismatch and oversized input are refused. The **leak test** runs the provisioning script
  against a stub `gh` that records argv, stdin and environment, with seed
  `sha256("presto provisioning leak test")`: no output, argv or child environment contains the seed as
  hex (lower, upper, `0x`), base64, base64url (padded or not), decimal bytes, PKCS#8 DER base64 or PEM
  body, or JWK `d`; stdin is exactly the 64 lowercase hex characters; an invalid seed, a weak
  environment, an existing secret in default mode and each mode's precondition are refused with no set;
  a missing `GH_TOKEN` is refused before any `gh` call; every child environment holds the token
  unchanged and no output contains it.
- Mutation: print `seed.toString("base64")` and the leak test fails.
- Then: a focused Codex review of the two scripts, push the branch, O1, the keyed run (O2), commit
  `key.pub`. Gate after O2: `env-exec wait` exits 0; the environment read-backs match O1; the secret
  is listed by name only; the KEYID in `key.pub` equals the log's; the masked log holds only public
  values.
- Layers: unit, contract.

**Phase 3: list content, its pins and its documentation** (the `VERIFIED_SITES.md` example and field
table; the rest of the docs stay in Phase 5). ✓ (the repository and `key.pub` checks landed with
`key.pub`).
- Gate: `cargo test … src-tauri … verified_sites` (after `frontend:build`); the core repo test;
  `bun test scripts/presto-domain.test.ts`; `bun run --cwd packages/presto test:e2e:ui` (delete
  `test-results` after).
- Pass: content as in Scope; `git grep -nI 'Nulo Wallet\|faucet\.nulo\.sh\|presto-playground\.alejo-amiras'`
  over `packages/presto` and `scripts` is empty except `core/src/config.rs`'s canonicalization data; no
  product version label in the list or `VERIFIED_SITES.md`; the repo test lands here with every rule of
  the version-rules table, including the 100 gap between records and the `\r` refusal;
  `git check-attr text -- packages/presto/verified-sites.json` reports `unset`.
- Mutations: a record 101 above its predecessor; a CRLF record.
- Layers: unit, UI mock.

**Phase 4: Worker.** ✓
- Gate: `bun run --cwd packages/release-feed typecheck`; `bun run --cwd packages/release-feed test`;
  `bunx wrangler deploy --dry-run --config packages/release-feed/wrangler.jsonc`.
- Mutation: map the new path to `latest.json` and a test fails.
- Layers: unit.

**Phase 5: workflows, contracts and docs.** ✓
- Gate: `bun run lint:actions`;
  `bun test scripts/verified-sites-workflows.test.ts scripts/cloudflare-deployment.test.ts scripts/bot-pr.test.ts scripts/action-pins.test.ts packages/presto/scripts/ci-filter-contract.test.ts`;
  the `verified-sites-feed` job's script run locally with the RFC 8032 key standing in for the
  throwaway.
- Pass (contract tests): no `inputs:`; push paths exact; per-job environments and permissions; the
  seed only in the sign step, the KV token only in the publish step, the App token only in record;
  the signer imports only `node:` modules and runs under `bun --no-install --no-env-file --config=/dev/null`; the sign job compares the
  signing-path blobs at `prepare.sha` with `origin/main` before the seed step, and the publish job
  compares the history tree and `key.pub` with `origin/main` before the write. A scripts test runs
  `verified-sites-kv-guard.sh` on fixture envelopes: absent → write; identical → skip; higher, equal
  but different, and an older valid list under another key (a rotation before the owner's delete) →
  refuse;
  `persist-credentials: false`; sign and publish install and build nothing; record pushes exactly two
  paths; a live check follows any attempted write; `release-presto.yml`'s counts unchanged.
- Mutations: drop `persist-credentials: false` from sign; add `bun install` to publish.
- Layers: lint, contract.

**Phase 6: PR 1 pre-PR gate** (below), then the Codex fix loop, then checkpoint to the parent, then
open PR 1. Gate ✓ and Codex loop converged (2026-10-13, `lessons/pre-pr.md`, `lessons/pr-1-review.md`);
PR 1 not yet open. After O3–O5, a read-only live gate: every job of both runs succeeded; the live document
verifies with the CLI at version 1; `history/1.json` equals the list at the merge commit; the probe
passes.

### PR 2: client

**Phase 7: store and fetch (core;** may start before `history/1` lands). ✓ (a FIFO at the cache
path is replaced by the save, a directory fails it; see `lessons/phase-7.md`).
- Gate: core tests and clippy; the Windows cross-check.
- Pass: store: corrupt, forged (TEST 2 key, version 2^53 − 1), oversized, FIFO and directory
  (`cfg(unix)`), never lowers under the lock, releases the lock. Fetch, against a house-style
  `TcpListener` server: 200; 3xx refused; 404; 5xx; oversized `Content-Length`; oversized chunked; a
  drip and a hang bounded by the timeout; `Feed::production(key)` is the constant HTTPS URL with
  `https_only`.
- Mutations: remove the byte counter; save without re-reading.
- Layers: unit, integration.

**Phase 8: app wiring and the in-process integration test.** ✓ against an uncommitted local
stand-in for `history/1`: no src-tauri build works without a record, so this branch builds in CI only
once `history/1` is on `main` (`lessons/phase-8.md` lists what waits for it).
- `src-tauri/tests/verified_sites_feed.rs`: multi-thread runtime, aws-lc-rs provider, a scripted local
  HTTP server, fixture lists, a temporary store, a 2 s feed timeout, built-in = list 4, and an outer
  `tokio::time::timeout` on every case so a missing production timeout fails instead of hanging. Every
  case asserts, through `verified_info`, the registry, the disk bytes and the elapsed time. It also
  runs on each `platform` matrix leg in `presto.yml` (`cargo test --test verified_sites_feed`), so the
  macOS and Windows file paths execute:

| # | Case | Expectation |
|---|---|---|
| 1 | Accept list 5 | New entry visible; disk holds list 5; persisted before the swap |
| 2 | Restart | A new `VerifiedSites` on the same store is at 5; serving 4 is refused |
| 3 | List 6 drops a built-in entry | That origin answers None, also after a restart |
| 4–16 | Tampered signature; wrong key; older; same version, different body; malformed JSON; signed schema violation; oversized with and without `Content-Length`; drip; hang; 404; 503; connection refused; 302 to a valid document | Nothing changes; returns within its bound; `reached` only for 200s within the cap |
| 17–20 | Cache corrupt; forged; FIFO or directory (unix); oversized | `load` returns the built-in in under 200 ms; the next accepted list overwrites the file (a FIFO is replaced like any bad file; a directory fails the save, and memory still advances) |
| 21 | Unwritable store directory | The swap still happens; the error is logged |
| 22 | Another instance already wrote list 6; this one fetches 5 | Memory moves to 6 (the disk winner), never to 5 |
| 23 | Disk holds a different list at the fetched version | Equivocation: nothing changes |
| 24 | Independence | The list's `run_updates` against the hung server beside a stub updater `run_updates` (10 ms delays): the stub's checks land on time |
| 25 | Live (`#[ignore]`, run with `PRESTO_VERIFIED_SITES_LIVE=1`) | The production fetch returns a document that verifies under the pinned key, at the newest record's version (so `judge` against the built-in says Unchanged); run in Phase 10's gate |

- Gate: `frontend:build`; `cargo test` for src-tauri and server (including a test that parses the
  embedded built-in and checks it equals the newest record byte for byte; the repo test verifies that
  record's signature, under `key.pub` or the retired key it names, so a rotation PR still passes); `bun run lint:clippy`; the
  Windows cross-check; `bash packages/presto/scripts/autostart-test.sh` if Docker is available.
- Mutations: swap before persisting; swap the candidate instead of the winner; swap on
  `Equivocation`; remove the reqwest timeout (the outer deadline fails the case); equal-but-different
  accepted; union instead of replace.
- Layers: integration, contract.

**Phase 9: WebDriver hook, feed, spec and scan** (including D22's release scan). ✓ against the same
local stand-in for `history/1`; the spec's run and the build pair repeat in Phase 10 on the real record
(`lessons/phase-9.md`).
- Gate: `bun test packages/presto/scripts/webdriver-only-hooks.test.ts packages/presto/scripts/assert-no-test-hooks.test.ts packages/presto/scripts/verified-sites-e2e-feed.test.ts packages/presto/scripts/release-contract.test.ts`;
  the extended scanner passes the published 1.2.0-rc.1 `.deb`, `.app.tar.gz` and AppImage (fetched with
  `gh release download`, deleted after) and fails a `.tar.gz` and a `.deb` that carry the needle;
  shellcheck 0.9.0 on the touched scripts; `bash packages/presto/scripts/run-webdriver-local.sh` (every
  spec, tray-update included); a release-profile build passes `assert-no-test-hooks.sh`, a WebDriver
  build fails it; `grep -r PRESTO_E2E_ src-tauri/frontend-src` is empty; a scripts test shows the
  smoke feed server answering `/releases/verified-sites.json` with 404; the feed's test produces the
  committed fixture envelope byte for byte.
- Pass (D22): `release-contract.test.ts` pins the step inside `build`, after the bundles are built
  and before upload, with no `secrets.` reference, one target set per OS, and no scan anywhere in
  `sign-updater-artifacts`.
- Mutations: sign the `tampered` list validly (step 3 fails); skip the refresh (step 2 fails); move the
  release scan after upload, or drop the `.deb` target (the contract test fails).
- Layers: E2E, contract.

**Phase 10: PR 2 pre-PR gate**, the Codex fix loop, the close-out commits, checkpoint, open PR 2.
✓ on the real `history/1` (`lessons/phase-10.md`, `lessons/pre-pr.md`); the director opens PR 2.
- First, once this branch sits on `main` after PR 1: add a fixture to `verified-sites-fixtures.ts`,
  a valid list at version 2^53 − 1 signed with TEST 2, and a store test that a forged cache at that
  version never raises the stored version floor (the bricking attack). The list-5 wrong-key store
  test stays.

### Pre-PR gate (blocks each PR)

1. Clean tree, rebased on `origin/main`.
2. **Updater byte-identity:** `git diff --exit-code origin/main...HEAD --` over the untouched files
   listed in the change map; in `main.rs`, a scratch script compares `spawn_update_task`,
   `spawn_floor_tracker`, `should_poll_for_updates`, `schedule_store` and `start_background_tasks`
   between base and HEAD, allowing exactly the one added `spawn_refresh` line; for PR 2,
   `git diff -U0 origin/main...HEAD -- .github/workflows/release-presto.yml` removes no line and adds
   one hunk, D22's step.
3. `git diff origin/main...HEAD | grep -nE '/(home|mnt|Users)/'` empty; added comments carry no plan,
   phase or review references; `git grep -nE '/k/[0-9a-f]{32,}'` empty.
4. Locally: `bun run lint`, `bun run test`, `bun run lint:actions`, `bun run lint:clippy`, `cargo test`
   for core, src-tauri and server, the Windows cross-check, shellcheck 0.9.0, the round trip; for PR 2
   also the full WebDriver suite and `test:e2e:ui`.
5. **CI-equivalent runs on the pushed branch** (secretless test workflows only): `presto.yml` (dispatch
   forces every lane), `actionlint.yml`; for PR 2 also `smoke-updater-unix.yml` and
   `smoke-updater-windows.yml` in `positive` mode. All three impersonate `presto.build` (hosts entry and
   a trusted local CA, which reqwest's platform verifier honours) with a feed server that serves only
   the update files, so the list fetch always gets 404 there: a passing smoke is the updater, unchanged,
   with the list fetch failing. The success path keeps no feed log, so a scripts test pins the premise
   instead: `updater-feed-server.ts`'s handler answers `/releases/verified-sites.json` with 404. For PR 2 also `PRESTO_VERIFIED_SITES_LIVE=1` case 25 against the live list. Run
   IDs go in `lessons/pre-pr.md`; a skipped lane is not green.

## Delivery

Two sequential PRs (D20), not a stack: PR 2 needs `history/1`, a release-bot commit that exists only
after PR 1 merges and the owner approves.

| PR | Branch | Phases | Base |
|---|---|---|---|
| 1: publishing path | `worktree-verified-sites-feed` | 1–6 | `main` |
| 2: client, plus close-out | `verified-sites-feed-client` (same worktree) | 7–10 | `main` after `history/1` |

Order: Phase 1–2 → push → O1 → Phases 3–5 (all but `key.pub`) → O2 → commit `key.pub` → gate, Codex loop, checkpoint → PR 1
→ O3 → O4 → O5 → live gate → Phases 7–9 → gate, Codex loop, close-out, checkpoint → PR 2 → O6 → O7 →
O8. From then on, a list change is one merge plus one approval.

## Post-implementation

1. **No `/code-review`** (`code_review: off`).
2. **Codex fix loop per PR**, after its local gate and before it opens:
   - `~/.claude/skills/codex/scripts/run-codex.sh <prompt> <worktree> high read-only gpt-6.1-sol`.
   - The prompt carries the PR's diff against `origin/main`, this plan, the decision ledger, the PR map
     ("PR N of 2; the other adds …"), an adversarial and security ask, and the two rules below
     verbatim.
   - Triage: verify each claim against the repo, apply accepted fixes in new commits, re-run the
     affected gate and then the full pre-PR gate, and log the round in `lessons/pr-<n>-review.md`.
   - Resume with `resume-codex.sh <session> <prompt> <codex-dir> high gpt-6.1-sol` until a round has no
     new material finding. Three rounds still producing material findings → stop and surface.
   - PR 2's loop ends with a fresh session over the net diff from `3ebb19b`, asking about the seam
     between the PRs, duplication and drift from this plan.
3. **Close-out** (PR 2's final commits, after its loop converges):
   - An `## Outcome` block after the front matter: date, status, PRs, what was dropped, and a line
     retiring the seeds.
   - Promote generalizable gotchas into `implementations-plan/lessons.md` (stay within ~8 KiB: dedupe,
     retire superseded lines).
   - Move open follow-ups (expiry, a second approval factor, the Firefox deferral, the canary if not
     yet run) into `implementations-plan/follow-ups.md`.
   - `git mv implementations-plan/verified-sites-feed implementations-plan/archive/verified-sites-feed`
     in its own commit; repair links; move the index line into `archive/index.md`.
4. **Open PR 2**, `gh pr checks --watch`, report. The owner merges.
5. **Teardown after the merge:** once
   `git fetch -q origin main && git cat-file -e FETCH_HEAD:implementations-plan/archive/verified-sites-feed/plan.md`
   succeeds, run `agent-worktree done verified-sites-feed --merged` (this session never used
   `EnterWorktree`, so there is nothing to exit). It never forces; relay any refusal and stop. A
   `/loop` session checks on every firing; a `/goal` session arms one background wait after its wrap-up:
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

## Decision ledger

Three independent drafts: the driver's (`plan-main.md`), Codex's (`plan-codex.md`) and Opus's
(`plan-fable.md`), all from the same brief and recon. Draft files are local only.

**Unanimous:** D7 raw seed, D6 envelope, D8 no floor file, D9 selection and equivocation, the
display-only boundary, no new IPC or ACL, Firefox deferred.

**Taken from one draft over the others:**
- D1–D2 exact bytes, curator-bumped version (Codex; Opus agreed; the driver's CI-assigned version is
  rejected because the signed bytes would no longer be the reviewed file). The `+100` bound is Opus's.
- D3 keep `schemaVersion` (Opus): PR 1 then needs no loader change; the in-payload `schema` string
  that the driver and Codex both proposed added churn and no security, given a dedicated key.
- D4 fixed trusted comment, SHA-256 key ID (Opus): simpler to check than the driver's
  version-and-hash comment, which repeated what the signature already covers.
- D5 history as `.json` + `.minisig` (Opus): reviewable diffs and stock-tool auditability; envelopes
  in history (driver, Codex) were opaque base64.
- D11 no bootstrap (Opus): removes a code path that existed only for a transitional window, and makes
  "release only after the first signed list" structural.
- D12 key in src-tauri (Opus): keeps core free of out-of-package includes.
- D14 secret jobs run nothing of the repo's (Opus): a cargo build in the same job as a secret can
  reach later steps through `$GITHUB_ENV` and `$GITHUB_PATH`, so per-step scoping alone is not
  isolation. Curl instead of wrangler keeps npm out of the KV job.
- D19 hooks in `e2e_tray.rs`, prefix needle (Opus): keeps one `cfg` site and K2's shape.
- D21 updater files byte-identical (Opus).
- From the driver: printable-ASCII names (D16), the stale-`main` check in sign,
  the pending-record refusal in prepare.
- D10 the schedule: the driver piggybacked on the update check, Codex ran a separate task with a
  persisted schedule, Opus a separate memory-only one (adopted: the launch check runs on every start,
  so a persisted schedule buys nothing, and a separate task proves independence by construction).
- From Codex: history before KV (D13).

**Disputes after both contradiction checks:**
- D13 publish order: Codex and driver (history first) against Opus's draft (KV first, one workflow).
  Both checkers keep history first: it alone gives "public before live" and approval-free KV
  restores. Its latency is cut by keeping records off the WebDriver and packaging lanes. Settled by
  the Codex audit (no longer an Ask).
- D17 popup latch: Codex's draft would remove it; both checkers accept keeping it.
- D18 swap on a failed write: Codex's checker would refuse the swap; Opus's checker and the driver
  keep it (refusing keeps a removed badge alive for the session). Kept, with the quality bar's restart
  wording fixed.
- D20 delivery: driver (3 stacked arcs), Codex (1 PR), Opus (2 sequential PRs, adopted); both
  checkers agree it follows from D11. Still offered as A2.

**Changed after approval:**
- **Case 19 corrected (implementation, 2026-10-13):** `rename(2)` replaces a FIFO at the cache path,
  healing it like any bad file; only a directory fails the save.
- **Skip-the-refresh mutation corrected (implementation, 2026-10-13):** the popup reads its badge only
  when it loads, so the mutant fails at step 2, the first badge that needs a reload, not step 4.
- **A3 reversed (owner, 2026-10-13): O1b skipped.** The narrowed agent token and its four-403
  verification are dropped; agents keep the owner's `gh` OAuth token (`repo` scope). An agent can
  therefore approve a signing run with one API call and change the environment or its secret. The
  approval gap stays accepted as written (threat model; `SECURITY_MODEL.md` decision 7), without that
  mitigation, and no doc claims a narrowed token. Provisioning is unaffected: the O2 template imports
  its own short-lived owner token, and the script and template stay byte-identical to their
  Codex-reviewed revision (`6599d42`).

### Contradiction check: Codex (`gpt-6.1-sol`, high, fresh session)

Verdict: **inconsistent** before fixes (blocking: #1, #8). Disposition:

| # | Finding | Severity | Disposition |
|---|---|---|---|
| 1 | Phase 1 fixtures need the signer from Phase 2; Phase 3's grep fails on docs that Phase 5 edits | blocking | **Accepted.** The signer's signing functions move to Phase 1; the list's documentation moves to Phase 3. |
| 2 | After a rotation, CI cannot verify the still-live old-key list under the new pin | material | **Accepted.** CI checks a live document against the record of its version, under that record's key; the client keeps one pin. |
| 3 | The "scripts job" does not run the Worker's tests | material | **Accepted.** `packages/release-feed/**` routes to `release_tooling`; its `lint` job gains release-feed `typecheck` and `test`. |
| 4 | Refresh could activate a list below a newer verified disk floor written by another instance | material | **Accepted.** `save_if_newer` returns the winner and the swap uses it; cases 22–23 added. This property was in Codex's draft and was lost silently. |
| 5 | D18 contradicts "removals survive restart" | material | **Rejected, wording fixed.** Refusing to activate on a failed write would block a removal entirely while the disk is unwritable; swapping applies it now and again at the next launch check. The quality bar now says so. |
| 6 | An interrupted record job has no retry path | material | **Accepted.** `if-exists: skip` plus a content check of the existing branch; re-running the job is the recovery. Opus had it; consolidation dropped it. |
| 7 | The tripwire baseline (the record's commit) can miss a signing-path change merged between approval and recording | material | **Accepted, different fix.** The baseline is the commit that first gave the source record H's bytes (blob hash), derivable from git with no extra metadata. |
| 8 | An empty list breaks the spec's "first origin" assertion | blocking | **Accepted.** Built-in-origin assertions run only on a non-empty record. |
| 9 | The WebDriver "hang" step does not prove the updater overlaps a failing fetch | material | **Accepted.** Claim removed; the proof is case 24 plus the three smokes, whose logs must show the list's 404 beside a passing update. |
| 10 | Provisioning needs an authenticated `gh` on the host | material | **Accepted.** The template imports an owner token (`GH_TOKEN`, A3 at the gate), so provisioning never depends on the host's `gh` login; the preflight fails closed. |
| 11 | The env-gated real-data test from Codex's draft was dropped | material | **Accepted.** Case 25, `#[ignore]` with `PRESTO_VERIFIED_SITES_LIVE=1`, run in Phase 10. |
| 12 | Ledger provenance errors (D3, D10, D15) | minor | **Accepted.** Corrected above. |

Codex would keep D13 (history first), D17 (latch) and D20 (two PRs).

### Contradiction check: Opus (fresh Plan agent)

Verdict: **consistent after fixes** (no blocking items). It independently found Codex's #1, #2, #3,
#7, #9 and #10 on an earlier text, and confirmed the fixes. New findings:

| # | Finding | Disposition |
|---|---|---|
| 1 | `Feed::production()` in core needs the pinned key that only src-tauri has | **Accepted.** `Feed::production(key)`. |
| 2 | D6 says only the CLI builds envelopes, but the E2E feed builds them in Bun | **Accepted.** Reworded; the feed's test compares its envelope with the CLI's byte for byte. |
| 3 | The repo test cannot pass before `key.pub` and `version` exist | **Accepted.** It lands in Phase 3. |
| 4 | The append-only check has no PR base on a dispatch | **Accepted.** Merge base with `origin/main` outside pull requests. |
| 5 | A rotation PR would fail its own append-only check | **Accepted.** Only paths that exist at the base are protected; additions pass. |
| 6 | The tripwire lists the bot actions' wrappers, not their scripts, and misses `.bun-version` | **Accepted.** |
| 7 | Running the signer outside a `node_modules` turns on Bun's auto-install | **Accepted.** `bun --no-install`; a contract test pins `node:`-only imports. |
| 8 | On Windows the 404 line lands in `feed.err` | **Accepted.** |
| 9 | PR 2 edits `assert-no-test-hooks.sh`, which "the updater scripts" covered | **Accepted.** The untouched list now names its files. |
| 10 | `key.pub` is compiled in but not routed | **Accepted**, with its D13 suggestion: records and `key.pub` route to `rust_platform` only. |
| 11 | Case 25 expected Accept where a healthy system says Unchanged | **Accepted.** |
| 12 | The feed's `hang` mode is unused | **Accepted.** Dropped. |
| 13 | I7's fallback cannot show a disappearance for the same origin | **Accepted.** Same origin after the 30 s cooldown. |
| 14 | A list merged while a record is pending fails and needs a manual dispatch | **Accepted as documented behaviour.** The refusal prevents a second, unrecorded signature for a version; the failure notifies the owner. |
| 15 | D15 and D17 attributions and reasons | **Accepted.** Corrected. |
| — | Sign the E2E feed with a public test key, not a generated one | **Accepted.** No key is generated on a workstation. |

## Audit verdicts

### Codex audit (`gpt-6.1-sol`, high, fresh session)

**VERDICT: reject**, on F1, F7 and F8. Dispositions, all applied to the plan above:

| # | Finding | Severity | Disposition |
|---|---|---|---|
| F1 | A failed write could activate a list the disk proves is equivocating | blocking | **Accepted.** `save_if_newer` answers `Saved`, `DiskNewer`, `Equivocation` or `WriteFailed`; only `WriteFailed` swaps memory alone; a mutation pins it. |
| F2 | A re-run keeps its old commit, so an old signer could meet today's seed | material | **Accepted.** The sign job requires every signing-path blob at `prepare.sha` to match `origin/main` before the seed step. |
| F3 | Compromise recovery blocks itself while KV holds a forged, newer list | material | **Accepted.** Owner-only emergency runbook (delete the KV value, republish the newest record, rotate); `prepare` only warns on an absent live list once history exists. |
| F4 | Printable ASCII still allows Markdown images and links in the summary | material | **Accepted.** Curator values render as inline code; a fixture pins it. |
| F5 | "Within 6 h 15 min of the live write" ignores the Worker cache and KV propagation | minor | **Accepted.** Cadence and propagation stated separately. |
| F6 | A3's token lacks Actions write, which dispatching the test runs needs | material | **Accepted.** A3's token keeps Actions write. |
| F7 | A5 offered KV-first, which loses "public before live" | blocking | **Accepted as a settled decision.** The owner had not fixed the order (Excellent #7 is this plan's bar), but all three reviews chose history first, so D13 is settled and A5 removed. |
| F8 | No scan of the production release binaries | blocking | **Accepted at the approval gate (owner, 2026-10-08)**, reversing the plan's rejection (K3 and K4 make release builds hook-free by construction; the owner wants that proven on the shipped bytes too). D22: one secretless step in `release-presto.yml`'s `build` job, away from the updater-key job. |
| F9 | macOS never runs the persistence integration test; a missing timeout would hang the gate | material | **Accepted.** `platform` matrix runs it; every case has an outer deadline. |
| F10 | WebDriver timing: Mocha's 30 s, the 60 s decision deadline, the fallback's cooldown | material | **Accepted.** Explicit spec timeout, sequence under 45 s, 5 s poll bounds, the pending request cleaned up. |
| F11 | `/goal` required O6–O7 while PR 2 is open | material | **Accepted.** It ends at O1–O5 and PR 2 open. |
| F12 | Recon's key-generation row is superseded; only 503 is `no-store` | minor | **Accepted.** Recon annotated; Worker text corrected. |

Inferences after the audit: I1, I2 and I8 are supported by GitHub's documentation (still observed at
O5); I6 and I9 are checked during O5.

### Opus audit (fresh Plan agent)

**VERDICT: conditional approve**, with six conditions: C1 (P1), C2 (S2), C3 (S1), C4 (P2), C5
(`PRIVACY.md`) and C6 (P3). All are met except C2, which is met in part, as argued in its row.
Dispositions:

| # | Finding | Severity | Disposition |
|---|---|---|---|
| P1 | Windows checkouts turn the records, signatures and `key.pub` into CRLF (no eol rule in `.gitattributes`), breaking signatures and, in a Windows build, making the built-in equivocate | blocking (C1) | **Accepted.** `-text` rules; `build.rs` and the repo test refuse `\r`. |
| S1 | One PR swapping `key.pub` and adding a self-signed record publishes with no approval request | material (C3) | **Accepted.** Recorded in the threat model; `publish` refuses a key change (the owner's KV delete is the gate); the probe alarms when the live key differs from `key.pub`; the release runbook asks the owner to confirm a `key.pub` change. |
| S2 | An absurd version inside history wedges the counter for good | material (C2) | **Accepted in part.** The repo test now limits consecutive records to a 100 gap, which stops the absurd record at the PR gate (only a gate-disabling owner-token attacker gets past it, which is the accepted gap). The proposed key-scoped counter is **rejected**: `build.rs` would have to decode signature files, and a rotation window with no new-key record yet would either break the build or need a fallback rule, for a scenario that already requires a stolen seed and a bypassed gate. Counter damage admitted through a bypassed gate has no supported recovery under append-only history; this is recorded as a residual risk. |
| S3 | The untrusted comment is unauthenticated, so envelope-byte identity lets a KV holder fake equivocation | minor | **Accepted.** Identity is the signed list bytes. |
| S4 | CODEOWNERS never notifies an owner-authored PR | minor | **Accepted.** The mitigation now names only App-authored record PRs, which do request the owner. |
| S5 | The keyed run is not bound to the reviewed commit | minor | **Rejected.** `env-exec` refuses a dirty tree and pins the pushed commit, which `op-remote` shows the owner before asking; O2 now has the owner confirm it is the reviewed commit. |
| S6 | Name how the sign job reads `origin/main` | minor | **Accepted.** `git fetch --depth=1` and `git rev-parse`. |
| F-b, F-c, F-d | Worker responses are not edge-cached; the WebDriver gate uploads logs; three line cites drifted | minor | **Accepted.** |
| I-2 / P2 | Positive smokes keep no feed log, so the 404 evidence is unobservable | material (C4) | **Accepted.** A scripts test pins that the smoke feed server answers the list path with 404; a passing smoke is the proof. |
| A3 | The narrowed token only removes the one-call approval | — | **Accepted.** Reworded. |
| P3 | No mechanism for the feed-versus-CLI byte comparison | minor (C6) | **Accepted.** One committed fixture envelope, asserted from Rust and from Bun. |
| P4 | Routing records to `rust_platform` runs the 3-OS matrix on every history PR | minor | **Accepted.** Records stay in `verified_sites_feed`; `key.pub` goes to the desktop groups. |
| P5 | The probe inside `update-feed-health.yml` reads as an updater failure | minor | **Accepted.** Its own `verified-sites-health.yml`; the updater workflow stays untouched. |
| P6 | `start_background_tasks` changes but was not in the identity check | minor | **Accepted.** Compared, allowing the one added line. |
| P7 | New bot-pr workflows must be in `release_tooling`; the `lint` job needs a longer timeout | minor | **Accepted.** |
| P8 | No runbook for a stuck record | minor | **Accepted.** Three recovery lines. |
| P9 | Built-in parse failure behaviour unstated | minor | **Accepted.** Empty registry and an error log; a test parses and verifies the embedded copy. |
| P10 | `sha256sum` is missing on macOS | minor | **Accepted.** `shasum -a 256` beside it. |
| C5 | `PRIVACY.md` lists every desktop request and still says 12 h | — | **Accepted.** PR 2 adds the list request and corrects the cadence. |

### Final pass: Codex (`gpt-6.1-sol`, high, fresh session over the plan and the full ledger)

**VERDICT: conditional approve**, with three conditions, all applied:

1. The publish job's own text lacked the key-change refusal the version rules promise. Now in the
   job, through `verified-sites-kv-guard.sh`, with a scripts test that includes an older valid list
   under another key.
2. A re-run of an old publish run could restore an obsolete record into a deleted key. The publish job
   now compares the history tree and `key.pub` with `origin/main` right before the write.
3. S2's "owner revert" recovery contradicted append-only history. Removed; recorded as a residual
   risk instead.

The same session, resumed over the revised plan, confirmed all three conditions met and found no new
contradiction: **VERDICT: approve** (confidence high).

### Implementation review: signer and provisioning (Codex `gpt-6.1-sol`, high, fresh session)

**VERDICT: suitable for the keyed run once fixed** (moderate confidence). All six findings accepted
and fixed, each with a test that fails against the old behaviour:

| # | Finding | Severity | Fix |
|---|---|---|---|
| R1 | The preflight accepted the owner plus another reviewer, and GitHub takes one approval from any listed reviewer | blocker | Exactly one required-reviewers rule with exactly one `User` reviewer, `alejoamiras` |
| R2 | `HOME` let `gh` read a stored config, whose default host could redirect calls away from github.com | should-fix | `GH_HOST=github.com` and an empty `GH_CONFIG_DIR` in every child |
| R3 | A malformed updater key in `tauri.conf.json` silently disabled the updater-key refusal | should-fix | Refuse unless it decodes to a 42-byte `Ed` minisign key |
| R4 | `bun --no-install` alone still loads `.env` files and bunfig preloads beside the seed | should-fix | `--no-env-file --config=/dev/null` for the keyed run and the CI signer |
| R5 | The leak test ignored files and a child that echoes its inputs on failure | should-fix | It scans the throwaway tree and runs a failing `gh` that prints the seed and token |
| R6 | The signer ignored stray or repeated flags, and `--out` could overwrite its inputs | nit | Exact flags, each once; `--out` is created exclusively |

R5 also asked for stock `minisign -V` in CI: the PR gate's round trip runs it (Ubuntu's `minisign`
package, secretless job, `-H` to require the prehashed form).

The same session, resumed over the fixes, verified all six and added one nit (the file scan's
exclusion matched sibling directories, and it lacked the raw-byte forms), fixed: **VERDICT: approve
for the keyed run** (high confidence).

### Implementation review: PR 1 (Codex `gpt-6.1-sol`, high, fresh session, resumed twice)

**VERDICT: ready** (round 3, high confidence). Rounds 1 and 2 raised four material findings, all
accepted (details in `lessons/pr-1-review.md`):

| # | Finding | Severity | Fix |
|---|---|---|---|
| 1 | The tripwire and stale check missed core files outside `verified_sites/` that change what the CLI prints | important | `SIGNING_PATHS` holds the whole core crate, `rust-toolchain.toml` and a root `.cargo/` |
| 2 | The round trip's equivocation case broke on an empty list | important | It reuses the whitespace-tampered list |
| 3 | The first list's version was unbounded | important | Counted from 0 before the first record, in `prepare` and the repo test |
| 4 | `bun install` in the CLI jobs ran lifecycle hooks beside the CLI | important | `setup-presto` `install-js-deps: "false"` in all five CLI jobs (a different fix from Codex's path list; Codex accepted it in round 3) |

Minors fixed: tripwire file names cannot break the summary's markup and a failed tripwire diff fails
the step; the runbook's failed-record recovery deletes the record branch; two comments cut.

### Implementation review: PR 2 (Codex `gpt-6.1-sol`, high, one session)

**VERDICT: ready** (round 2, high confidence). Round 1 raised one material finding, accepted
(details in `lessons/pr-2-review.md`):

| # | Finding | Severity | Fix |
|---|---|---|---|
| 1 | A save that could not take the lock returned `WriteFailed` before reading the disk, and the caller swaps memory anyway (D18). Another instance holding the lock over a newer list let a replayed older list become current | important | The disk is judged whether or not the lock was taken; only then does a lock error become `WriteFailed`. A held-lock test covers both a newer and an equivocating disk list. |

Minors fixed:
- The E2E tampered list is signed for its own version, so only the signature refuses it.
- The core FIFO test fails on a deadline instead of hanging.
- One comment went with the restructure, and the integration test's deadline claim was narrowed.

Not changed:
- src-tauri case 19's FIFO: the core test names that regression, and the CI job's timeout bounds
  it.
- The spec's numbered step comments: they state expectations the assertions do not spell out.

Rounds 3 to 5 resumed the session to verify, not reopen: the `history/1` merge and two Windows-only
test corrections CI forced (`2e79326`, `34c65ff`). Each returned `VERDICT: ready`.

## Rejected and deferred alternatives

- **Firefox identity (deferred).**
  - `moz-extension://<UUID>` is random for each browser profile, so it cannot be listed.
  - Mozilla may switch extension requests to `Origin: null` (bug 1405971, still open; two attempts
    shipped and were backed out).
  - The only browser-enforced Firefox identity is native messaging (Firefox passes the caller's add-on
    ID and enforces `allowed_extensions`). Deferred.
  - A plain "Firefox extension" popup label was rejected by the owner.
  - The `https`/`chrome-extension` rule (D16, confirmed at the gate) codifies this: it excludes no
    Firefox entry that could have worked, because none can be listed.
  - Routing Nulo through a `nulo.sh` iframe to borrow its verified origin was rejected: any site could
    frame the bridge and use Nulo's approval (a confused deputy).
- **Unsigned remote JSON:** forgeable badges.
- **Reusing the updater key:** one compromise would cover both channels.
- **A separate numeric floor file:** forgeable; reproduces the F-04 lockout.
- **A union of built-in and fetched entries:** resurrects removals.
- **CI-assigned versions; a republish that lowers the version; a client cap on version jumps.**
- **A minisign secret-key file plus password in CI, or `tauri signer`:** see D7.
- **Refactoring `update_manifest.rs` or `read_capped` into shared helpers:** touches the updater path.
- **Piggybacking on the update check, or persisting the list's schedule:** couples the list to the
  updater's busy and install semantics; the launch check runs anyway.
- **An unsigned version-0 bootstrap, or runtime verification of the built-in** (D11).
- **Expiry or freshness stamps:** periodic re-approval for a display-only badge. Deferred.
- **A second KV namespace or token:** no isolation, since KV Storage Edit is account-wide.
- **Wrangler, or any install, in a secret-holding job.**
- **Sigstore, immutable releases, R2:** the owner chose repository history.
- **A standby second key:** the owner chose one key, rotated by release.
- **Making `Landing Status` required:** `presto.yml`'s `release_tooling` lane runs the Worker's tests instead.
- **Removing the popup's badge latch** (D17).

## Seeds (final, approved 2026-10-08; O1b removed 2026-10-13)

ELI5 companion: https://claude.ai/artifact/AAwn5s8D3drQb2AfotZ3bz (source, not committed:
`implementations-plan/verified-sites-feed/eli5.html`).

Run inside the worktree (`agent-worktree resume verified-sites-feed`). Use exactly one per session.
**Recommended: `/loop`**, because the plan stops at owner steps (O1, O2–O8) between phases, which a
completion condition cannot see past.

```
/loop 15m Drive implementations-plan/verified-sites-feed forward. Never idle waiting for input, except at an owner step. Each firing:
1. Reality check: read implementations-plan/verified-sites-feed/plan.md (Outcome & Quality Bar first) and lessons/. If that path is gone and `git fetch -q origin main && git cat-file -e FETCH_HEAD:implementations-plan/archive/verified-sites-feed/plan.md` succeeds, PR 2 merged: run `agent-worktree done verified-sites-feed --merged`, report what it removed (or its refusal verbatim, never forcing), clear this loop and stop. A live plan.md with an `## Outcome` block means the close-out was interrupted: finish it. Otherwise rebuild the task list from plan.md if empty; `git status`; `git log --oneline -5`; `gh pr view --json statusCheckRollup` if a PR exists.
2. Owner steps (O1, O2–O8) are never yours: never approve a deployment, dispatch sign-verified-sites.yml, publish-verified-sites.yml or deploy-release-feed.yml, write KV, deploy a Worker, merge, tag, release, change gh's login, or touch the updater key. If the next step is an owner step, state the exact instruction once and hold; later firings only re-check whether it happened. After O1, file O2 (`env-exec request`, then relay the `op-remote create <host> <id>` and `op-remote <host> <id>` lines).
3. No task in hand: take the next pending phase step. After each meaningful edit run that phase's gate commands. Commit with `-F <msgfile>` (conventional, lower-case subject); remote git commands run with `SSH_AUTH_SOCK=`.
4. Stuck or facing a decision: consult Codex (`~/.claude/skills/codex/scripts/run-codex.sh <prompt> <worktree> high read-only gpt-6.1-sol`), decide, and log it in lessons/phase-N.md. Never cross a hard limit or expand scope.
5. Same step failed 3 times: stop and surface it.
6. Phase gate green (commands and pass criteria exactly as in plan.md, mutations included): mark the phase ✓ in plan.md, write lessons/phase-N.md, print `LESSONS_FILE=implementations-plan/verified-sites-feed/lessons/phase-N.md`. At Phase 6 and Phase 10: run the pre-PR gate, then the Codex fix loop with the no-over-engineering and comment-quality rules until a round has nothing material, then surface before opening the PR.
7. All phases ✓ and PR 2 open with the close-out commits: `gh pr checks --watch`, report, stop. Merging is the owner's call.
```

```
/goal Phases 1–10 marked ✓ in implementations-plan/verified-sites-feed/plan.md, each backed by its validation gate (commands, pass criteria and mutations as written there) reported passing in the transcript, with `LESSONS_FILE=implementations-plan/verified-sites-feed/lessons/phase-N.md` printed per phase; owner steps O1 and O2–O5 confirmed done in the transcript, never performed by the agent (O6–O8 follow the PR 2 merge and are the owner's); for each PR the pre-PR gate's CI run IDs recorded in lessons/pre-pr.md and the Codex fix loop converged (a resumed Codex pass reporting no new material finding, quoted); `/code-review` NOT run; PR 1 merged and PR 2 open on GitHub (`gh pr view` output in the transcript), PR 2 carrying the close-out (`git show --stat` of the archive-move commit in the transcript); `bun run test` and `bun run lint:actions` both exit 0 in the transcript.
```

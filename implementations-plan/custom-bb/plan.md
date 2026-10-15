---
plan: custom-bb
tier: mid
status: draft (awaiting approval)
driver: claude-code
eli5_mode: file
code_review: off
claude_model: opus
codex_model: sol
explainer: off
quality: production
base: a2a3a98 (origin/main, 2026-10-15)
depends_on: the RC-channel plan's `PrestoConfig.developer: DeveloperSettings` contract
---

# Developer mode: a custom `bb`

With developer mode on, a user picks a `bb` file in Settings and gives it one version label. A
proof request whose `x-aztec-version` equals the label runs that file; every other request is
unchanged. Presto pins the file's path and SHA-256 and rechecks both right before it starts the
file. It refuses a changed file and never falls back to the official bb for that label. Settings,
the tray and the approval popup show the state.

Recon: `recon.md`. Planning consults: `lessons/phase-0.md`. Size: over the 350-line `mid` target,
because it spans two crates and a UI and writes out the post-implementation steps (this repo has no
shared standard to cite).

## Outcome & Quality Bar

**For whom:** a barretenberg tinkerer who tests their own build against a real dApp on their own
machine, and rebuilds between tries.

**Excellent looks like:**

1. **Setup takes under a minute, without a terminal.** Pick, read, tick, test-run and save on one
   card. A refusal names the cause and gives a copyable fix command.
2. **It is never unclear which bb made a proof.** Settings shows the version, hash, last proof and
   last failure; the tray shows a line; the response carries `x-presto-bb: custom`.
3. **A changed file never runs silently.** A rebuild gives a refusal, then a "Trust new build" review
   that pins only the hash it showed.
4. **Off restores today's routing for every new request.** A queued job is refused; a running proof
   finishes.

**Good enough:** one custom bb at a time; no per-site scoping; no notification per proof; English
copy only; no `/health` field.

## Scope and decisions

- **In:** the core route for both schemes; the pin and its verification; the wire header and errors;
  Settings (card and banner); the tray line and tooltip; the approval-popup line; the picker
  dependency; the CI lanes the tests need; docs (SECURITY_MODEL, the READMEs, CLAUDE.md).
- **Out:** the headless server (`BB_BINARY_PATH` stays its override, documented precisely); tray icon
  art; SDK code; Presto changing quarantine, signatures or the exec bit; the developer-mode switch
  (RC-channel plan).
- **Owner-accepted** (through the director, 2026-10-15): pin by reference; refuse quarantined or
  unsigned files with a copyable fix; headless out of scope; one custom bb; `tauri-plugin-dialog`
  from Rust only; the record survives updates and clears when developer mode turns off.

| # | Decision | Status |
|---|---|---|
| D1 | Hybrid (b)+(d). An exact `x-aztec-version` match selects the label. The label may equal a release or the bundled version | panel agrees; driver |
| D2 | `x-presto-bb: custom` on custom proofs only; no `/health` field | **owner decided** |
| D3 | A changed, missing or withdrawn file gives `503 custom_bb_unavailable`; a crash gives `500 prove_failed`; the wire text is fixed. Failures are loud in Presto | **owner decided** |
| D4 | The `bb --version` test run happens only after the trust tick, holds the prove permit, and must pass before saving | driver; audits |
| D5 | UX: setup A; active state A banner + B card + one tray line; popup C, keeping the permanence line | **owner decided** |
| D6 | When `BB_BINARY_PATH` names an existing file, Settings shows "overridden" and refuses to save, and the route refuses the label | panel agrees |
| D7 | No other account may be able to change the file or a parent directory (policy in Mechanics) | audits agree |

## Architecture & Implementation

### Proposed architecture

- **Core** (`packages/presto/core/src`): new `custom_bb.rs` (pin, label gate, inspection, spawn
  check, test run); `server/prove.rs` decides the route once; `bb.rs` and `bb/ultra_honk.rs` accept
  an exact path; `authorization.rs` carries the matched label on a pending approval. Nothing touches
  `versions/`, so the file is never listed, leased, marked or evicted.
- **Desktop** (`packages/presto/src-tauri`): new `src/custom_bb.rs` (four async Settings-only
  commands and an in-memory candidate); `tray.rs` (one menu line); `frontend-src/custom-bb.js` (card
  and banner); `authorize.js` (the popup line).
- **Config:** `developer.custom_bb: Option<CustomBbPin>` in the sibling's `DeveloperSettings`; its
  effective getter returns `None` unless `developer.enabled`.

### Key interfaces

```rust
// core/src/custom_bb.rs
pub struct CustomBbPin { pub path: PathBuf /* canonical */, pub sha256: String /* hex64 */,
                         pub label: AztecVersion, pub pinned_at: i64 }
pub fn de_custom_bb<'de, D>(d: D) -> Result<Option<CustomBbPin>, D::Error>; // reads a Value; invalid → None
pub fn check_label(raw: &str) -> Result<AztecVersion, LabelError>;   // request gate ∩ presto-noir regex
pub fn inspect(picked: &Path) -> Result<Inspection, Refusal>;          // static only; never executes
pub fn verify_for_spawn(pin: &CustomBbPin) -> Result<PathBuf, Unavailable>; // D7 policy + rehash
pub async fn test_run(path: &Path, sha256: &str, permit: OwnedSemaphorePermit) -> Result<TestRun, TestRunError>;
pub fn env_override_active() -> bool; // BB_BINARY_PATH set and `exists()`: the find_bb predicate

// core/src/server/prove.rs
pub(crate) enum BbSource { Bundled, Cached(AztecVersion), Custom(CustomBbPin) }
// core/src/bb.rs (and bb/ultra_honk.rs)
pub enum BbBinary<'a> { Find(Option<&'a AztecVersion>), Exact { path: &'a Path, gate: &'a dyn SpawnGate } }
pub trait SpawnGate { fn admit(&self) -> Result<(), Unavailable>; } // under the config read lock, right before spawn
// core/src/authorization.rs: `request(origin, version: Option<AztecVersion>)` keeps the FIRST request's version; `peek` returns it
// core/src/server.rs
pub type CustomBbChangedCallback = Arc<dyn Fn() + Send + Sync>; // tray rebuild; the on_versions_changed pattern
```

- `Inspection { path, sha256, size, warnings }`; `TestRun { version_suggestion: Option<AztecVersion>, excerpt }`.
- `Refusal` carries a fix command where one exists. It refuses a file that is not regular, not
  executable, of the wrong format or architecture, outside the D7 policy, quarantined (macOS), or
  failing `codesign --verify` (macOS arm64).
- **Wire:** `503 custom_bb_unavailable` and `500 prove_failed` carry fixed messages on both routes,
  with no path, hash or bb output. CORS `expose_headers` gains `x-presto-bb`. `api_version` stays 1.
- **Memory only:** `CustomBbActivity` (last proof, last failure) lives in `HeadlessState`.

### IPC commands and capability grants (owner approval required)

Owner rule: no new IPC command or capability grant without explicit approval. Each new command
starts with `require_label(window.label(), SETTINGS_LABEL)` as `get_config` does, before any file
work, and is `async`; hashing runs on `spawn_blocking`; the webview never sends a path.

| Command | Window | Arguments | What it can change | Why no existing command does it |
|---|---|---|---|---|
| `custom_bb_review` | `settings` | `source: "pick" \| "pinned"` | Nothing on disk. `pick` opens the native picker (async, parented to Settings, one at a time); `pinned` reopens the pinned path for "Trust new build". Reads, inspects and hashes the file, never runs it, and replaces the in-memory candidate. Developer mode required | No command opens a picker or reads a file. One `source` argument covers pick and re-trust |
| `custom_bb_test_run` | `settings` | `sha256`, `acknowledged: true` | **Runs the chosen file as the user**: it can do anything the user can (files, network); containment is not a sandbox (SECURITY_MODEL). Presto itself persists no pin: it uses a private temp directory, logs, and records the result for that hash on the in-memory candidate. Takes the prove permit with `try_acquire` ("a proof is running" if busy), requires the candidate hash to equal `sha256`, and runs `--version` once with no witness and its own piped stdout. Developer mode required | Nothing else executes a file. Kept apart from review (nothing runs before the tick) and from save (it prefills the label) |
| `custom_bb_save` | `settings` | `null` (stop) or `{sha256, label}` | `developer.custom_bb` in `config.json`. Activates or deactivates routing. **Set** requires the candidate, test-run and fresh-rehash hashes to equal `sha256`, the label to pass the gate, developer mode on, and no env override. **Stop** skips those preconditions; a config write failure surfaces as it does for other setters. Fires the tray rebuild | Existing setters write one field with no preconditions (`set_speed`, `set_theme`). Set and stop are one command |
| `custom_bb_status` | `settings` | none | Nothing. Rehashes the pinned file and returns off, in use, changed, missing, overridden or revoked, plus the activity; `off` when developer mode is off | `get_config` returns stored config only; this state is computed at runtime |
| `get_pending_auth` (exists) | `auth-*`, own request only (unchanged) | unchanged | Widened return: `PendingAuthDto` gains `custom_label: Option<String>`, set only while the pending request's first version equals the effective label at read time. Nothing else about other requests, paths, hashes or config | The popup already reads its data here, never from its URL |

- **Grants:** `capabilities/settings.json` gains exactly `allow-custom-bb-review`,
  `allow-custom-bb-test-run`, `allow-custom-bb-save` and `allow-custom-bb-status`. No other window
  gains anything; handlers become main's count + 4.
- **Plugin:** `tauri-plugin-dialog` is registered from Rust with no `dialog:*` permission anywhere, so
  its JS commands stay unreachable under the existing exact-permission test (T10 names it).

### Data and control flow (one custom proof)

1. **`admit`** authorizes. An unapproved origin's pending approval keeps its first request's
   `x-aztec-version` (later piggybacked requests never overwrite it). When the popup loads,
   `get_pending_auth` compares it with the effective label, and on a match the popup shows the line
   above the permanence line. Then `admit` takes the slots and reads the body and version.
2. **`resolve_version`**, after parsing and the revocation check and before the bundled normalization
   at `prove.rs:75`, compares the request with the effective label: a match returns `Custom(pin)`
   with no download; otherwise today's path.
3. **`acquire_prover`**: `Custom` skips the download, the lease and the cache-path check, then takes
   the prove permit.
4. **In the task:** prepare the workspace; `verify_for_spawn` on `spawn_blocking`; then, under the
   config **read** lock, `SpawnGate::admit` (same pin, `enabled`, no env override) and a synchronous
   spawn. `custom_bb_save(null)` takes the write lock, so a stop either precedes the spawn and
   refuses it, or follows a spawn that already started.
5. **Outcome:** success returns 200, `x-prove-duration-ms` and `x-presto-bb: custom`. Failure returns
   the fixed 500 or 503; the detail goes to the log and `CustomBbActivity`. A refusal fires the tray
   callback.

### File-level change map

- **Core:** new `custom_bb.rs`; `server/prove.rs`, `server/ultra_honk.rs`, `server/auth.rs`;
  `server.rs` (error, CORS, callback, activity); `bb.rs`, `bb/ultra_honk.rs`, `authorization.rs`;
  `config.rs` (field, `de_custom_bb`); `versions/mod.rs` (drop `cfg(test)` from the `sha256_file`
  re-export).
- **Desktop:** new `src/custom_bb.rs` and `frontend-src/custom-bb.js`; `main.rs` (handlers, plugin,
  callbacks), `build.rs`, `capabilities/settings.json`; `commands.rs` (`PendingAuthDto`); `tray.rs`;
  `e2e_tray.rs` (`PRESTO_E2E_CUSTOM_BB_PATH`, where the hook-guard test requires it); `Cargo.toml`,
  `Cargo.lock`; `frontend/settings.html`, `frontend/authorize.html`, `frontend/style.css`;
  `frontend-src/settings.js`, `frontend-src/authorize.js`.
- **Tests and CI:** `scripts/tauri-trust-boundary.test.ts`; `scripts/webdriver-only-hooks.test.ts`
  (`HOOK_NAMES`); `e2e/settings.spec.ts`, `e2e/authorize.spec.ts`, `e2e/tauri-mock.js`; new
  `e2e-webdriver/custom-bb.spec.ts`; `wdio.conf.ts` (specs list, hook export);
  `.github/workflows/_e2e-webdriver.yml` and `scripts/run-webdriver-local.sh` (hook export before
  launch, fixture staging; the binary check in the workflow only); `.github/workflows/presto.yml`
  (core `custom_bb` tests on macOS).
- **Docs:** `docs/SECURITY_MODEL.md`, `packages/presto/README.md`, `README.md`, `CLAUDE.md`.

### Non-obvious mechanics

- **Route before normalization.** Deciding later loses the label. Traced failures: a bundled label
  never routes; an uncached release label gives `503 version_evicting`; a cached release label runs
  the official binary while Settings says custom.
- **One bb at a time.** Containment registers one process group (Unix) or Job Object (Windows). A
  test run outside the prove permit would overwrite a running proof's entry, so update quiesce and
  quit would miss that proof and a Windows timeout would kill it. Hence the test run holds the permit.
- **Popup label freshness.** The stored first version is a fact about the request and never goes
  stale; the match is computed when the popup loads. A stop or re-pin after that leaves the line
  on screen, so its copy is conditional ("While your custom bb answers that version, …"). A later
  request with another version from the same origin shares the popup (known limit 5).
- **Test run:** rehash, then spawn `--version` through containment from a private temp directory,
  with stdout piped (`spawn_capturing_stderr` inherits it) and no witness; 5 s limit, 4 KiB output
  cap, tree killed on exit. The suggestion is the first token that passes `check_label`. Exit 0
  proves the file starts on this host: a wrong architecture, a missing library, Smart App Control and
  Gatekeeper all fail here.
- **D7 path policy**, at pick time and at spawn time:
  - **Unix:** the file and every ancestor are owned by the user or root; the file is neither group-
    nor world-writable; no ancestor is world-writable without the sticky bit; an ancestor may be
    group-writable only through the user's private group (same name as the user, the user's primary
    gid, no listed members). Debian user-private groups keep working; macOS `staff` is refused.
    Extended ACLs on the file or any ancestor are refused when an **allow** entry grants a
    write-class right (write, append, delete, delete-child, add-file, add-subdirectory, write
    attributes or security, chown) to anyone, since macOS evaluates ACLs before mode bits. Deny
    entries pass, so the default home ACL (`group:everyone deny delete`) is accepted. Linux: a
    POSIX access ACL (`system.posix_acl_access`, via `libc::lgetxattr`) with a named user or group
    entry holding write is refused. macOS reads ACLs through libSystem's `acl_*` calls in a small
    `extern "C"` block. No new crate.
  - **Windows:** the file must sit under `%USERPROFILE%`, whose default ACL is owner, SYSTEM and
    Administrators. `C:\dev`, where Authenticated Users can modify, is refused with a fix line.
  - The same-user hash-to-exec race and a loosened profile ACL remain known limits.
- **Format check:** the first 4 KiB, comparing ELF `e_machine`, Mach-O (thin or fat) `cputype` or PE
  `Machine` with the host. Pick time only, so tests may pin a shell-script fake.
- **Label gate:** the request gate (canonical semver, no build metadata, not revoked) intersected
  with presto-noir's `^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$`.
- **Config tolerance:** `de_custom_bb` validates an `Option<Value>` field by field, like
  `de_approved_origins`. A malformed record becomes `None` instead of failing the whole config into
  read-only defaults (`config.rs:377`).

### Trade-offs and alternatives not taken

- **A pinned override for every proof** (`plan-alt.md`): every site at every version would reach the
  dev build, and a late `find_bb` override still comes after the download.
- **Copying the file** into an owner-only directory: closes the race but keeps running a stale build
  after a rebuild.
- **A Windows deny-write handle across `CreateProcess`:** one OS only, loader interplay unverified.
  Known limit.
- **New 500 codes or a `/health` field:** the owner rejected both (D2, D3).
- **A size-and-mtime status cache:** spawn always rehashes, and one code path is simpler.
- **A per-site consent popup:** adds persistent state and a lifecycle. Known limit.
- **`rfd` directly:** Presto would own main-thread dispatch and window parenting on three OSes.

## Security & Adversarial Considerations

- **Threat model:**
  - **Unapproved web origin:** nothing new; the route runs after `admit`, and the minimal `/health`
    is unchanged.
  - **Approved origin:** selects the route by sending the label, by design. It learns only "custom",
    never a path, hash or bb output (fixed wire text, asserted by T3). With its download budget
    spent, it can tell `429` from `500` and so guess the label (known limit 8).
  - **Local process without `Origin`** (any account on the machine): reaches the custom bb with
    chosen inputs and no popup, as it reaches the official bb today. A debug or ASan build raises
    the stakes. Documented as SECURITY_MODEL decision 8; see A7.
  - **Another local user:** D7 (mode bits and ACLs) and the rehash at spawn stop them from changing
    the file or its parents.
  - **Malware running as the user:** can write its own record or race the rehash. Known limit under
    decision 1.
  - **The user's own forgotten build:** the realistic harm. The banner, the tray line, the popup line
    and the setup copy address it.
- **Least privilege:** four `allow-*` grants, Settings only (A5); one widened DTO; no `dialog:*`;
  window label and developer mode checked in Rust; the webview never supplies a path.
- **Cryptography:** SHA-256 through the existing `sha2` helper; nothing new.
- **Input validation:** labels through `check_label`; paths canonicalized at pick and checked at
  spawn without following a final symlink; every string through `textContent`; CSP unchanged.
- **Supply chain:** `tauri-plugin-dialog` is a new crate, and Cargo has no release-age gate. Pin an
  exact version at least 7 days old, diff the `.crate` against its upstream tag, and list each
  transitive crate in `lessons/phase-3.md`. `tauri-plugin-fs` may come in but is never registered.
- **Privacy:** a witness reaches the custom bb only for its label; logs stay local; activity stays in
  memory.
- **Known limits** (closed `known-limit` issues at close-out):
  1. The same-user hash-to-exec race.
  2. A loosened Windows profile ACL.
  3. Libraries and config the binary loads are not hashed.
  4. A well-formed but wrong proof returns 200.
  5. No per-site scoping. Only an origin's first queued request opens a popup, and already-approved
     sites see none.
  6. Reinstalling resumes routing, because uninstall keeps config.
  7. A revoked label is unreachable.
  8. An approved origin can guess the label.
  9. A local caller without `Origin` reaches the custom bb.

## Assumptions

**Facts:**

- **F1.** `find_bb` uses `BB_BINARY_PATH` when it names an existing path, ahead of every request, and
  never hashes it (`core/src/bb.rs:49`).
- **F2.** `resolve_version` normalizes a bundled request to `None` (`core/src/server/prove.rs:75`).
- **F3.** In the current `presto-core`, an unrecognised `500` code throws and any `503` degrades
  (`packages/sdk-core/src/lib/presto-client.ts:519`). Older publications are unchecked; D3 relies
  only on the long-standing 503 behaviour.
- **F4.** presto-noir's `bbVersion` regex rejects a hyphen inside the prerelease part.
- **F5.** A malformed field fails the whole config into read-only defaults; a missing field only
  defaults (`core/src/config.rs:377`).
- **F6.** CORS exposes only `x-prove-duration-ms` (`core/src/server.rs:397`).
- **F7.** `tauri-trust-boundary.test.ts` requires `allow-<kebab>` grants matching the handlers exactly.
- **F8.** `ProveFailed(e.to_string())` sends internal text on both routes (`prove.rs:304`,
  `server/ultra_honk.rs:300`).
- **F9.** Eviction and listing scan only `versions/`.
- **F10.** `_e2e-app.yml`, `_e2e.yml`, `_ts-package-ci.yml` and `presto.yml` set `BB_BINARY_PATH`;
  the WebDriver workflow does not.
- **F11.** Containment holds one bb at a time (`core/src/bb.rs:675`, `:925`).
- **F12.** `PRESTO_E2E_*` names must live in `e2e_tray.rs`; `wdio.conf.ts` lists its specs explicitly.
- **F13.** A request without `Origin` skips authorization (`core/src/server/auth.rs:81`).
- **F14.** The popup reads its data from `get_pending_auth`, never its URL (`frontend-src/authorize.js`).
- **F15.** macOS evaluates a file's ACL before its mode bits (Apple, File System Programming Guide).
- **F16.** `webdriver-only-hooks.test.ts:150` (L4) requires the CI step and
  `scripts/run-webdriver-local.sh` both to export every `HOOK_NAMES` entry before launch.

**Inferences** (verified in the phase named):

- **I1 (P3).** `tauri-plugin-dialog` 2.x's async picker works from Rust, parented to Settings, with no
  permission. Check cancel and parenting.
- **I2 (P1).** A release `bb --version` prints its semver; a local build may print a placeholder, so
  the label is only a suggestion.
- **I3 (P1).** arm64 macOS binaries carry an ad-hoc signature. T13 needs it on the dev sidecar; check
  the real one.
- **I4 (P3).** SmartScreen does not gate `CreateProcess`, so Mark-of-the-Web only warns.
- **I5 (P2).** A per-proof rehash of a few hundred MB, run off the runtime, is acceptable. Measure it.
- **I6 (P1).** The sibling's `DeveloperSettings` lands as relayed. A test proves turning developer
  mode off clears `custom_bb` in the same save.
- **I7 (P5).** The Windows runner checks out outside `%USERPROFILE%`, so both launchers copy the
  sidecar into a fresh directory under it (and on Unix into a `0700` directory) before launch.

**Asks** (through the director). Closed: A1, A2 (D2, D3) and A3 (D5).

- **A4:** start after the RC-channel contract merges to `main`? Recommended: yes; P1 can start before.
- **A5: approve the IPC commands and capability grants table** above: four new commands, four
  `allow-*` grants, one widened `get_pending_auth` return. Its own line at the approval gate; no
  implementation starts before it.
- **A6:** read "refuse unsigned files" as macOS arm64 only? Intel macOS runs unsigned code, and local
  Windows builds carry no Authenticode signature. Recommended: yes.
- **A7:** should local requests without `Origin` (Node tests, scripts) reach the custom bb?
  Recommended: yes, documented. It is the tinkerer's main test path, and the official bb has the same
  exposure.

## Phases

Fast layers on every gate: `bun run lint`; `bun run lint:clippy`; `cargo test --locked` for each
touched crate; the Windows cross-check from `packages/presto/src-tauri`,
`cargo check --target x86_64-pc-windows-gnu --lib --bins`. A phase is ✓ only when its gate passes,
with the output or run ID in the transcript.

### Phase 1: core pin, label gate, inspection, test run

1. `custom_bb.rs`: `CustomBbPin`, `de_custom_bb`, `check_label`, `inspect` (with D7),
   `verify_for_spawn`, `test_run` (takes a permit), `env_override_active`.
2. Re-export `sha256_file` for non-test use.
3. Wire `custom_bb` into `DeveloperSettings` once that struct exists (I6).
4. Add `cargo test --manifest-path ../core/Cargo.toml custom_bb` to `presto.yml`'s macOS leg.
5. Tests:
   - **T1** `check_label`: refuses `6.0.0-alice-perf.1`, a `+build` label, a revoked label.
   - **T2** `verify_for_spawn`: hash mismatch; final symlink; non-regular file; group-writable file;
     world-writable ancestor without sticky bit; group-writable ancestor accepted only through the
     private group (Unix); an ancestor with a named-user write ACL (Linux, where `setfacl` exists);
     an allow-write ACE refused and a deny-only ACE accepted (`cfg(macos)`, `chmod +a`); file outside
     the profile (Windows).
   - **T4** `test_run`: prints a version; prints garbage; hangs and is killed at 5 s; hash changes
     before the run; a running proof holds the permit, so the test run is refused and the proof's
     containment entry survives.
   - **T6** config: a full config with `"sha256": 5` keeps its origins and save capability; turning
     developer mode off clears the record.
   - **T7** `inspect`: no exec bit; foreign architecture header; quarantine (`cfg(macos)`).

**Gate:** `cargo test --locked --manifest-path packages/presto/core/Cargo.toml custom_bb`,
`bun run lint:clippy`, `bun run lint:actions`, the Windows cross-check. **Pass:** all exit 0; T1,
T2, T4, T6, T7 pass; each refusal test and the permit test fail against an accept-everything stub
(recorded in lessons); the sidecar signature check (I3) is recorded. **Layers:** lint, typecheck,
unit.

### Phase 2: core route, spawn gate, wire, popup label

1. `BbSource` in `resolve_version`; `Custom` skips the download, the lease and the cache-path check.
2. `BbBinary::Exact` with `SpawnGate` in both runners: prepare the workspace and `verify_for_spawn`
   first, then `admit` and a synchronous spawn under the config read lock.
3. Fixed messages on both routes, `x-presto-bb: custom`, the CORS entry, `CustomBbActivity`,
   `CustomBbChangedCallback`.
4. `AuthorizationManager::request` takes the request's parsed `x-aztec-version` (malformed → `None`)
   and keeps the first one; `peek` returns it.
5. Tests:
   - **T5:** a pure table over every routing cell: labels (bundled, cached release, uncached release,
     prerelease) × requests (match, other version, versionless) × developer mode on/off.
   - **T3:** server integration with a pin-only fake bb (Unix, no `BB_BINARY_PATH`): (1) match on
     `/prove` → 200 with header; (2) match on `/prove/ultra-honk` → 200 with header; (3) changed
     file → 503, no path or hash in the body; (4) intent withdrawn while waiting on the permit → 503,
     fake never runs; (5) intent withdrawn during `verify_for_spawn` (a `cfg(test)` pause) → 503;
     (6) crash → fixed 500; (7) headless state with a record never routes. The CORS header and the
     untouched download budget are asserted inside these cases.
   - **T11:** a pending request keeps its first version; a piggybacked request with another version
     does not overwrite it.

**Gate:** `cargo test --locked` for `core`, `server` and `src-tauri`; `bun run lint:clippy`; the
Windows cross-check. **Pass:** all exit 0; T3, T5, T11 pass; T3 case 5 fails against a gate placed
before the hash (recorded in lessons). **Layers:** lint, typecheck, unit, integration.

### Phase 3: desktop backend (picker, commands, tray, popup DTO)

1. Add `tauri-plugin-dialog` after the supply-chain review; register it with no permission.
2. Exactly the four approved commands, `async`, hashing on `spawn_blocking`. The save preconditions
   are a pure function (**T8**).
3. Widen `PendingAuthDto` with `custom_label`, computed from the stored version and the effective
   label. A pure unit test: match → label; other version → none; stopped or developer mode off →
   none.
4. All four lockstep lists, kebab grant names. **T10:** handlers equal main's count + 4; no
   capability grants `dialog:`.
5. `menu_layout` gets the custom line (**T9**). `CustomBbChangedCallback` rebuilds the menu with no
   lock held across the menu setters; the tooltip gets the suffix.
6. `PRESTO_E2E_CUSTOM_BB_PATH` hook in `e2e_tray.rs`, plus `HOOK_NAMES`, the binary check in
   `_e2e-webdriver.yml`, and the export and staging (I7) in both launchers (L4 keeps them in step).

**Gate** (repo root): `cargo test --locked --manifest-path packages/presto/src-tauri/Cargo.toml`;
`bun run --cwd packages/presto test:unit`; `bun run lint:clippy`; the Windows cross-check;
`cargo build --release --locked --manifest-path packages/presto/src-tauri/Cargo.toml`, then
`bash packages/presto/scripts/assert-no-test-hooks.sh packages/presto/src-tauri/target/release/Presto`.
**Pass:** all exit 0; T8, T9, T10 and the DTO test pass; the scan finds no `PRESTO_E2E_` name.
**Layers:** lint, typecheck, unit.

### Phase 4: Settings and popup UI

1. D5 in `custom-bb.js`, `settings.html`, `authorize.html`/`.js` and `style.css`: existing tokens
   only, in all three theme blocks; every string via `textContent`; controls disabled until their
   state is known; the popup line above the permanence line, with conditional copy: "This site asks
   for bb 6.0.0-rc.6. While your custom bb answers that version, it runs these proofs, not the
   official one."
2. **T12** in `e2e/settings.spec.ts` on `tauri-mock.js`, three tests: (1) pick → review → tick → test
   run → save → banner; (2) the refused, changed and overridden states render their copy and
   actions; (3) stop clears the banner.
3. One test in `e2e/authorize.spec.ts`: the line and the permanence line both render and fit 400×300
   (grow the popup if they do not).

**Gate:** `bun run test`; `bun run --cwd packages/presto test:e2e:ui`;
`bun run --cwd packages/presto frontend:build`;
`cargo build --locked --manifest-path packages/presto/src-tauri/Cargo.toml` (bundle manifest check).
**Pass:** all exit 0; T12, the authorize test, `contrast-guard.test.ts` and `window-fit.spec.ts`
pass. **Layers:** lint, typecheck, unit, UI e2e (mocked).

### Phase 5: end to end, and docs

1. **T13** (`e2e-webdriver/custom-bb.spec.ts`, with its `wdio.conf.ts` entry and hook export): one
   scenario on three OSes. Turn developer mode on and "pick" the shipped sidecar through the hook;
   test-run and save it as `6.0.0-dev.1`; from an unapproved origin, POST the committed Noir fixture
   to `/prove/ultra-honk` with that version; assert the popup line, then allow; assert 200,
   `x-presto-bb: custom` and proof bytes equal to the fixture; stop, and check a repeat request has
   no header. **Only it proves** real IPC, config, popup, route and exact-path spawn on each OS,
   Windows `bb.exe` quirks included. **Runtime:** estimated 25 s per OS; measure it.
2. Docs: `docs/SECURITY_MODEL.md` adds decision 8 (one user-chosen, hash-pinned file for exactly one
   label; D7; local callers without `Origin`) and amends decision 1's "nothing else" and "Not
   accepted"; the app README gets bb resolution, a "Developer mode: custom bb" section and
   `x-presto-bb`; the root README's versions bullet; `CLAUDE.md`'s Presto bullet.

**Gate:** `bun run test`; `bun run lint:actions`; on Linux,
`bun run --cwd packages/presto test:e2e:webdriver --spec ./e2e-webdriver/custom-bb.spec.ts`.
**Pass:** all exit 0; T13 passes on Linux, and on macOS and Windows in the PR's WebDriver lanes; the
PR body states the WebDriver wall-clock before and after. **Layers:** lint, typecheck, unit, e2e.

## Delivery

| Arc | Branch | Phases | Stacks on | `/code-review` |
|---|---|---|---|---|
| 1 core | `worktree-custom-bb` | P1–P2 | `main`, after the RC-channel contract (A4) | off |
| 2 desktop | `custom-bb-desktop` | P3–P5 | arc 1 | off |
| close-out | `custom-bb-close-out` | docs only | arc 2 | off |

Arc 1 is inert without a record, and nothing writes one yet; it touches `src-tauri` only to compile
the new callback and the changed `request` signature. No lanes and no pipelined boundary: P3 and P4
share the command shapes.

## Decision ledger

- **Chosen:** label routing ("safest first").
- **Rejected:** `plan-alt.md` ("cheapest first"; see Trade-offs); model (a); a copy pin; a per-site
  popup; `rfd` directly; an optional test run; a stop switch in the tray; an mtime status cache; a
  Windows deny-share handle.
- **Settled by the owner:** D2 (Codex wanted a `/health` field; Opus and the driver did not: none);
  D3 (Codex wanted failures loud in the dApp; Opus and the driver wanted Presto: Presto); D5 (the
  driver's UX picks, except popup C over the driver's late switch to A; C keeps the permanence line).
- **Owner pending:** A4, A5, A6, A7.

### Audit verdicts (round 1, 2026-10-15)

- **Codex** (`gpt-6.1-sol`, high, session `01a140e4-4ff6-76c0-bea5-6526726e30c7`): **conditional
  approve** — (1) serialize probes with proofs; (2) fix the cross-user file policy; (3) order disable
  against spawn; (4) a field-level pin deserializer; (5) repair the validation wiring; (6) resolve the
  owner decisions and the signature ambiguity.
- **Opus** (Plan agent): **conditional approve** — H1 the probe takes the permit and has its own
  stdout; H2 a platform path policy; M1 a lenient deserializer; M2 async commands; M3 a macOS core
  lane; M4 keep the permanence line; L1 kebab grant names; L2 hook placement; L3 popup data through
  `get_pending_auth`.
- **Adopted**, each verified against the code and now in the sections above: every condition of both
  audits; a pin-only harness with T3 shrunk to T5 plus seven cases; `acknowledged` on the test run;
  stop without preconditions; status without the origins list; F1/F3 narrowed, F2 corrected,
  F10–F14; known limits 8 and 9; A6 and A7.
- **Rejected:** Opus's mtime status shortcut (contradicts the panel); the Windows deny-share handle
  (unverified loader interplay; known limit); Codex's Unix location restriction (the permission
  policy, with the ACL check the final pass required, gives the same guarantee without blocking home
  build directories).

### Final pass (fresh Codex session, 2026-10-15)

- **Codex** (`gpt-6.1-sol`, high, session `01a140f8-8500-75b3-b5f4-c20a3e04f6ae`): **conditional
  approve** — close the Unix ACL gap; repair the local launcher wiring; define the popup snapshot
  wording and tests; correct the test-run authority disclosure; obtain A4–A7 before dependent
  implementation. Ledger: every round-1 condition resolved except those. IPC verdicts: review, save,
  status, `get_pending_auth` and the dialog registration **keep**; test run **change** (disclose that
  it runs the file with the user's full authority). No merge recommended: a merged review-and-test
  command would cut names, not authority.
- **Adopted**, verified against the code: ACLs in D7 and T2 (F15); `run-webdriver-local.sh` and
  fixture staging (F16, I7); popup freshness through the stored first version, a read-time match and
  conditional copy, with T11 and the DTO test; the test-run, save and stop columns; `require_label`
  named. The last condition is the approval gate itself.
- **Refined:** Codex proposed snapshotting the label at admission. The plan stores the request's
  version instead, so `authorization.rs` stays ignorant of the custom bb and the match is as fresh as
  the popup load.

## Post-implementation

**While implementing:** comments follow the value-per-character rule and never mention this plan;
log attempts in `lessons/phase-N.md`; at each gate run
`agent-worktree status custom-bb "phase N green: <next>"`; stop after 3 failures on one step (5 in a
`/loop` run).

**Steps** (`code_review: off`, so there is no `/code-review` step):

1. **Codex fix loop per arc, at each boundary**, before `gh stack add` opens the next arc. Run
   `~/.claude/skills/codex/scripts/run-codex.sh <prompt> <worktree> high read-only gpt-6.1-sol` with
   the arc diff, this plan and the ledger, the arc map ("arc N of 2; arc 2 adds the desktop UI on arc
   1's route"), the adversarial ask, and the two rules below verbatim. Triage each claim against the
   code; fix, commit, log; resume with `resume-codex.sh` on the fix diff. Repeat until a round has
   nothing material; after three rounds that still do, stop and report. A fix that adds persistent
   state, a lifecycle, a coordination protocol, a recovery policy or a public contract is a plan
   change: write it here and stop for the owner. Later rounds verify; they reopen a settled point only
   on new evidence.
2. **Final cross-arc pass:** a fresh Codex session over `main...HEAD` (seams, duplication, drift), same
   loop.
3. **Delivery:** `gh stack sync` if `main` moved; `gh stack submit --auto`; `gh pr edit` each body
   with the WebDriver time before and after, `Closes #N` where it applies, and the attribution line.
4. **Close-out**, as the top layer (`gh stack add custom-bb-close-out`):
   - `## Outcome` after the front matter: date, status, PRs, dropped or rejected items,
     `Known limits: #N…`, `Open items:`, and a line retiring the seeds.
   - Promote lessons to `implementations-plan/lessons.md`: dedupe, prune to about 8 KiB, date-stamp
     tool versions.
   - File the known limits as closed `known-limit` issues after `gh issue list --state all --search`;
     open items go to their homes per the table below.
   - `git mv implementations-plan/custom-bb implementations-plan/archive/custom-bb` in its own commit;
     repair links with `git grep -n custom-bb`; move the index line to `archive/index.md`.
   - Submit, `gh pr checks --watch` on every PR, report, wait. Merging is the owner's call
     (`gh stack merge --squash`).
5. **Teardown after the merge.** A `/loop` checks on every firing; a `/goal` session arms one wait
   after its wrap-up:
   `until git fetch -q origin main && git cat-file -e FETCH_HEAD:implementations-plan/archive/custom-bb/plan.md; do sleep 300; done`.
   Then, without asking: `ExitWorktree` (`keep`) if this session entered through `EnterWorktree`;
   `agent-worktree done custom-bb --merged`; report the deleted branches and SHAs. Relay a refusal
   verbatim; never force.

**No-over-engineering rule** (verbatim in every fix-loop prompt): *"Report bugs and small, targeted
improvements only. Do not propose speculative abstractions, extra configuration surface, new layers,
or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it
alone."*

**Comment-quality rule** (verbatim in every fix-loop prompt): *"Audit the comments for value per
character. Flag any comment that narrates what the code visibly does, restates its line, references
implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag
places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are
permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and
exact."*

**Where open work lives:**

| Situation | Home |
|---|---|
| Work inside this implementation | this plan and its PRs |
| A bug, gap, missing test or deferred refactor that outlives the plan | an issue with a domain label and a `Record` link to the archived plan |
| A product call, or a wait on something outside the repo | an issue labelled `owner-decision` or `blocked:external` naming the trigger |
| A suspected exploitable weakness | a private draft security advisory; this plan records only "tracked privately: GHSA-…" |
| Rejected, superseded or done | a disposition line in the Outcome |
| A path needing unsupported conditions, or whose consequence does not matter | a `known-limit` issue, closed as not planned at once, with its reopening condition |
| Knowledge that prevents a repeat | `implementations-plan/lessons.md` |

Issue body sections: `## What happens` (the path, labelled demonstrated or plausible), `## Where`,
`## Impact`, `## Possible fix`, `## Record`.

## Seeds (DRAFT until approval)

Run inside the worktree (`agent-worktree resume custom-bb`). Recommended: `/goal`.

```
/goal All phases marked ✓ in implementations-plan/custom-bb/plan.md, each backed by its validation gate reported passing in the transcript with LESSONS_FILE=implementations-plan/custom-bb/lessons/phase-N.md printed; /code-review NOT run (code_review: off); the Codex fix loop (gpt-6.1-sol, high) converged for arc 1 and arc 2 at their boundaries and for the final cross-arc pass, each shown by a resumed pass reporting no new material findings quoted in the transcript; the stack (arc 1 core, arc 2 desktop, custom-bb-close-out) exists on GitHub, created only after all loops converged (`gh stack view` in the transcript), with the close-out's archive-move commit shown by `git show --stat`; `bun run test` and `bun run lint:actions` exit 0 in the transcript.
```

```
/loop 15m Drive implementations-plan/custom-bb forward per its plan.md (read it and lessons/ first, including Outcome & Quality Bar; on a stack read them from the top layer). If plan.md is gone, check `git fetch -q origin main && git cat-file -e FETCH_HEAD:implementations-plan/archive/custom-bb/plan.md`: merged → run the teardown (ExitWorktree keep if entered via EnterWorktree, then `agent-worktree done custom-bb --merged`), report, clear this loop, stop; else babysit CI only. Otherwise rebuild the task list from plan.md, take the next step, run the fast layers after each edit, commit and push (gh stack push). Decisions you would bring to me: consult Codex (gpt-6.1-sol, high) and log the verdict; never merge, publish, add an IPC command or capability grant beyond plan.md's approved table, or expand scope. Same step failed 5 times: reassess with Codex. Phase gate green: mark ✓, print LESSONS_FILE, advance; at an arc boundary run the Codex fix loop before `gh stack add`. All ✓: final cross-arc pass, Delivery, close-out, `gh pr checks --watch`, wrap-up report, stop.
```

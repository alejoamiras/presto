# Phase 0: planning consults

## Panel 1: design questions (2026-10-15)

- **Reviewers:** Opus 5.5 subagent (general-purpose, read-only) and Codex `gpt-6.1-sol` at `high`
  (session `01a140d3-a1d0-7d52-bf0d-57f813378524`). Both had the same brief and read the code.
- **Brief:** the driver's positions P1–P8 and questions 1–11, with the owner-accepted answers marked
  (pin by reference, refuse quarantined or unsigned files, headless out, one custom bb, picker crate).
- **Developer-mode contract** (from the RC-channel stream, relayed by the director the same day):
  `PrestoConfig.developer: DeveloperSettings { enabled, update_channel, custom_bb }`,
  `#[serde(default)]`; turning it off resets the whole struct in the same save; effective getters
  return defaults unless `enabled`; headless forces it off in memory.

### 1. Version model

- **Call:** hybrid of (b) and (d). A user label must pass the request gate. A request whose
  `x-aztec-version` equals the label goes to the custom bb. Every other request, and every
  versionless one, is unchanged.
- **Agree:** both want the label allowed to equal a real release or the bundled version, since
  `@alejoamiras/presto` cannot relabel. Both want the route decided once, after revocation and before
  bundled normalization and the download step. Both want it carried as an explicit route through both
  schemes, not as `Some(label)` into `find_bb`.
- **Codex trace (demonstrated):** a bundled label collapses to `None`.
- **Opus trace:** an uncached label gives `503 version_evicting`; a cached release label runs the
  official binary while Settings says custom.
- **Differ:** Opus adds three points.
  - The label must also pass presto-noir's regex: `^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$` rejects a
    hyphen inside the prerelease part, which the server accepts. Verified in
    `packages/sdk-noir/src/lib/tested-versions.ts`.
  - The confirmation should list the approved origins a release label affects.
  - Scoping the build per origin is a known limit, not v1 work.

### 2. What sites see

- **Call:** a response header on proofs the custom bb made (`x-presto-bb: custom`), added to the
  CORS expose list. No `/health` field in v1. No path, hash or `--version` text on the wire.
- **Agree:** both want the header, the unchanged minimal `/health`, and the label kept out of
  `versions` / `available_versions`.
- **Differ:**
  - Codex also wants a detailed-`/health` field.
  - Opus rejects it: it tells every approved origin, including ones that never ask for the label,
    that this user runs a dev build. A typed label is a cross-site identifier. It is also a public
    contract with no consumer, and adding it later is additive.
  - Opus also caught that `ProveFailed(e.to_string())` sends internal text to the site. Custom-route
    errors need fixed wire strings.
- **Owner decides:** the `/health` field.

### 3. Pinning

- **Call:** pin by reference.
  - Canonicalize the path at pick time; keep a regular file, with no symlink at the last component.
  - Refuse a file whose owner is neither the user nor root, and any world-writable path component
    without the sticky bit.
  - Rehash right before spawn. The hash-to-exec race is a known limit.
- **Agree:** both.
- **Opus additions:**
  - Do not refuse group-writable files, because Debian user-private groups use umask 002.
  - "Trust new build" is compare-and-set: Rust pins only the hash Settings displayed.

### 4. OS gates

- **Call:** detect and refuse, as accepted.
- **Additions:**
  - Check the executable format and architecture (Opus).
  - Check the macOS signature on arm64 only, since Intel runs unsigned binaries (Opus).
  - Map a spawn `EACCES` on a `noexec` mount, a Smart App Control block and a macOS privacy `EPERM`
    to readable messages.
  - Never promise that clearing Mark-of-the-Web makes a file run (Codex).

### 5. Failure

- **Call:** no fallback to the official bb, ever (both agree).
- **Differ:**
  - Codex wants new `500 custom_bb_unavailable` / `custom_bb_failed`, so every published SDK throws
    and the experiment cannot be masked by WASM.
  - Opus wants `503 custom_bb_unavailable` for a changed, missing or withdrawn file, which degrades
    in every published SDK (precedent: `version_evicting`). A crash stays `500 prove_failed`. Presto
    itself is the loud channel: Settings keeps the last failure and the tray line flips.
  - Opus's case: a new 500 code makes every approved dApp that asks for a shadowed release throw
    instead of degrading.
- **Driver sides with Opus:** no new error contract that breaks published SDKs; loud inside Presto.
- **Owner decides:** loudness in the dApp vs in Presto.

### 6. Indicator

- **Call:** Settings banner, a tray menu line, and tooltip text, all while a record exists. Add one
  line in the authorization popup while a custom bb is active.
- **Agree:** both. Opus notes Linux app indicators show no tooltip, so the menu line is the floor.
  The tray line must not key on the existing `dev_mode` (debug builds).

### 7. Headless

- **Call:** out of scope; document `BB_BINARY_PATH` precisely (all versions, unhashed).
- **Agree:** both. Both also found that `BB_BINARY_PATH` wins on desktop too (demonstrated, `bb.rs:49`;
  `_e2e-app.yml` sets it). Settings must show the conflict and refuse to activate while it is set.

### 8. Lifecycle

- **Call:** survive updates; clear on developer mode off; downgrade drops it.
- **Agree:** both want a re-check right before spawn (Opus: after the prove permit, mirroring
  `ensure_not_revoked`). A request queued before the user turned it off gets the 503, never the old
  binary.
- **Opus additions:** a revoked label (`KNOWN_VULNERABLE_VERSIONS`) is refused before the custom
  check, and Settings should say so. Reinstall resumes routing because uninstall keeps config: a
  known limit.

### 9. The `bb --version` probe

- **Call:** run it once, after the trust tick and before saving, on the proof containment, with a
  short timeout, capped output and no witness, rechecking the hash first. Prefill the label only if
  the output passes the gate. A failed probe blocks saving.
- **Differ:** Codex makes the probe optional, with manual labels. Opus makes it mandatory, because
  it is the cheapest proof that the file runs on this host (architecture, glibc, Smart App Control,
  Gatekeeper). The driver takes mandatory.

### 10. Picker

- **Call:** `tauri-plugin-dialog`, Rust API only, with no `dialog:*` permission.
- **Agree:** both. Assert the missing permission in `tauri-trust-boundary.test.ts` and review the
  crate diff, which may pull in `tauri-plugin-fs`.

### 11. Missing boundaries

- **Agree:**
  - the `BB_BINARY_PATH` conflict;
  - malware running as the user can write its own record: a known limit under SECURITY_MODEL
    decision 1;
  - a well-formed but wrong proof returns 200: a known limit, since downstream verification stays
    authoritative;
  - a new SECURITY_MODEL decision entry is required.
- **Codex adds:** dylibs and config files a pinned binary loads are outside the hash (known limit).
- **Opus adds:**
  - custom requests never spend the download budget;
  - a custom-route error must not leak the username via the path.

## Plan audits (2026-10-15)

Verdicts and dispositions are inline in `plan.md` (Decision ledger). What future plans can reuse:

- **Round 1** (Codex `01a140e4-4ff6-76c0-bea5-6526726e30c7`; Opus Plan agent): both returned
  conditional approve. Both caught independently that a `--version` probe outside the prove permit
  breaks the "one bb at a time" containment registry (`core/src/bb.rs:675`, `:925`). Any new bb
  spawn path must take the permit.
- **Final pass** (fresh Codex `01a140f8-8500-75b3-b5f4-c20a3e04f6ae`): conditional approve. It
  caught that a Unix ownership-and-mode policy says nothing about macOS ACLs, which are evaluated
  first. It also caught that a new `PRESTO_E2E_*` hook must be exported by both WebDriver launchers,
  `_e2e-webdriver.yml` and `scripts/run-webdriver-local.sh` (L4 in `webdriver-only-hooks.test.ts`).
- **Popup data:** store facts about the request (its first version) rather than derived state (the
  matched label), and compute the match when the popup reads it. Fresher, and the auth manager stays
  ignorant of the feature.

## Housekeeping

- `bun install` at homing rewrote one line of `bun.lock` (sdk-noir `2.0.0-rc.1` → `2.0.0-rc.2`):
  the committed lock lags the manifest on `main`. Restored with `git checkout -- bun.lock`, since
  this run is planning only.

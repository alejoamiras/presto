I now have all the material needed to write the complete report.

---

# `POST /prove/ultra-honk` — Rust Request Path Map

Repo: `packages/presto/core` (crate `presto-core`), `packages/presto/server` (headless binary), `packages/presto/src-tauri` (desktop wiring). All paths below are repo-relative.

## 1. Module inventory

| File | Purpose | LOC |
|---|---|---|
| `packages/presto/core/src/server.rs` | Router construction (`router_for_port`), `AppState`/`HeadlessState`, `/health`, `ProveError` → HTTP mapping, cap constants (`MAX_INFLIGHT_PROVE`, `AUTH_DECISION_TIMEOUT`, `AUTH_QUEUE_BACKSTOP`), `SCHEMES`/`API_VERSION`, bind-ownership tracking | 698 |
| `packages/presto/core/src/server/prove.rs` | Shared admission pipeline (`admit`, `acquire_prover`), `/prove` (chonk) handler, body-read timeout/size caps, version resolution/download, cache cleanup spawn | 547 |
| `packages/presto/core/src/server/ultra_honk.rs` | `POST /prove/ultra-honk` handler; JSON body manual `Deserialize`, base64/gzip decode + inflate-bomb guard, per-origin `OriginSlots` admission cap, blocking-worker execution, revocation re-checks | 617 |
| `packages/presto/core/src/server/auth.rs` | `authorize_origin`, `Approval`, popup request/persist flow, `save_approved_origin` | 204 |
| `packages/presto/core/src/server/host.rs` | Loopback `Host`/`:authority` guard (`host_is_trusted`, `guard` middleware) — SEC-01a DNS-rebinding keystone | 161 |
| `packages/presto/core/src/authorization.rs` | `CanonicalOrigin` (RFC 6454 canonicalization), `AuthorizationManager` (pending popups, single-active-popup arbiter, deny cooldown, revocation generations) | 1196 |
| `packages/presto/core/src/bb.rs` | `find_bb`, `run_bb` (spawn/containment/timeout/stderr-cap), prove-workspace creation, process-tree containment (Unix pgid / Windows Job Object), chonk `prove()` | 1726 |
| `packages/presto/core/src/bb/ultra_honk.rs` | `VerifierTarget` enum, `UltraHonkWorkspace` (file layout, client-vk text-mode workaround), `build_ultra_honk_command`, JSON output field decoding (`read_outputs`), output caps | 662 |
| `packages/presto/core/src/versions/mod.rs` | Re-export surface for the `versions` submodules | 24 |
| `packages/presto/core/src/versions/downloader.rs` | `download_bb`, tarball streaming download, GitHub digest verification, staged/fail-closed install, gzip-bomb-capped extraction | 956 |
| `packages/presto/core/src/versions/cache_layout.rs` | On-disk cache layout, integrity marker (`bb.sha256.json`) write/verify, `verify_cached_bb`, `list_cached_versions` | 498 |
| `packages/presto/core/src/versions/leases.rs` | In-use lease registry (`acquire`/`begin_evict`) preventing eviction racing execution | 288 |
| `packages/presto/core/src/versions/release_metadata.rs` | Platform naming, download URL, GitHub asset-digest fetch, shared `reqwest` client | 195 |
| `packages/presto/core/src/versions/version_policy.rs` | `AztecVersion` value object, `is_valid_version`, `check_version_selectable` (revocation denylist), retention/eviction policy, `CACHE_MAX_TOTAL_BYTES` | 983 |
| `packages/presto/server/src/main.rs` | Headless binary: origin-gating mode resolution (`--allow-all`/`ALLOWED_ORIGINS`), port resolution (`--port`/`PRESTO_PORT`/`PRESTO_HOME`), state wiring, SIGTERM→bb-quiesce | 373 |
| `packages/presto/core/src/server/tests.rs` | Integration/unit tests for router, auth, `/health` tiering, ultra-honk admission | 1744 |
| `packages/presto/core/tests/ultra_honk_real_bb.rs` | `#[ignore]`d real-bb integration tests over `fixtures/noir/*` | 247 |

## 2. Entrypoints & request flow

Route registration — `packages/presto/core/src/server.rs:391-407` (`router_for_port`):
```
.route("/health", get(health))
.route("/prove", post(prove::prove))
.route("/prove/ultra-honk", post(ultra_honk::prove_ultra_honk))   // line 394
.layer(DefaultBodyLimit::max(50 * 1024 * 1024))                    // line 395 — 50 MiB axum body limit
.layer(cors)
.layer(SetResponseHeaderLayer::overriding(cross-origin-resource-policy: cross-origin))
.layer(axum::middleware::from_fn(move |req, next| host::guard(expected_port, req, next)))  // outermost
```

Ordered call chain, ingress → bb → response:

1. **Host guard** (outermost middleware, runs before routing/CORS) — `server/host.rs:62` `guard()`, using `host_is_trusted` (`server/host.rs:22`). Rejects any request whose `Host`/`:authority` isn't an exact loopback literal on the listener's own port → `403 invalid_host` (`server/host.rs:78-85`).
2. **Handler entry** — `server/ultra_honk.rs:322` `prove_ultra_honk()`.
3. **Admission stage 1** — `server/ultra_honk.rs:327` calls `admit(&state, request, Some(&state.ultra_honk_slots))` → `server/prove.rs:246` `admit()`:
   - `server/prove.rs:254` `authorize_origin(state, &parts.headers)` → `server/auth.rs:35`:
     - `server/auth.rs:72` `parse_request_origin` reads `Origin` header, canonicalizes via `CanonicalOrigin::parse` (`authorization.rs:102`); malformed → `ProveError::InvalidOrigin` (400).
     - No `Origin` header → `Approval::ungated()` (auth bypass by design for non-browser callers — `server/auth.rs:80-84`).
     - `server/auth.rs:47` `auth_manager.with_generation(|generation| origin_is_approved(...))` — approval check + generation stamp under one lock (`authorization.rs:493`).
     - If not pre-approved and no popup callback (headless, ungated) → `403 origin_denied` (`server/auth.rs:56-58`).
     - Else `request_authorization` → `server/auth.rs:104`: `auth_manager.request(origin)` (`authorization.rs:434`, cooldown-checked atomically with insert), shows popup (desktop only), awaits decision bounded by `AUTH_QUEUE_BACKSTOP` (`server.rs:71-76`, = `AUTH_DECISION_TIMEOUT × (MAX_PENDING_ORIGINS+1)` = 60s × 11 = 660s).
     - `AuthDecision::Allow` → `persist_approved_origin` (`server/auth.rs:154`) → `save_approved_origin` (`server/auth.rs:174`) writes `approved_origins` to config via `config::lock_mutate_save_to` (`server/auth.rs:184`, `config.rs:661`).
   - **Origin slot** — `server/prove.rs:257-260`: `origin_slots.try_enter(origin)` → `server/ultra_honk.rs:55` `OriginSlots::try_enter`. Cap `MAX_ULTRA_HONK_PER_ORIGIN = MAX_INFLIGHT_PROVE / 2 = 4` (`server/ultra_honk.rs:31`). Full → `429 origin_queue_full`.
   - **Inflight cap** — `server/prove.rs:265` `try_enter(state.prove_waiters.clone())` (`server/prove.rs:204`). Cap `MAX_INFLIGHT_PROVE = 8` (`server.rs:52`). Full → `429 prove_queue_full`.
   - **Declared-size reject** — `server/prove.rs:268` `reject_declared_oversize(&parts.headers)` (`server/prove.rs:133`): validates every `Content-Length` value/comma-element vs `MAX_BODY_SIZE = 50 MiB` (`server/prove.rs:121`); malformed/oversize/conflicting → `413 payload_too_large` before the permit is touched.
   - **Body read** — `server/prove.rs:273` `read_body(raw_body, MAX_BODY_SIZE, BODY_READ_TIMEOUT)` (`server/prove.rs:180`): `tokio::time::timeout` around `axum::body::to_bytes`. `BODY_READ_TIMEOUT = 30s` (`server/prove.rs:127`). Timeout → `408 body_read_timeout`; over-cap → `413`.
   - **Version header** — `server/prove.rs:276` `requested_version(&parts.headers)` reads `x-aztec-version` (`server/prove.rs:374`), just extracted here (validated later).
   - Status callback → `Proving`; returns `Admitted{ body, requested_version, approval, _status, _inflight, _origin_slot }`.
4. **Parse (runtime thread, pre-permit)** — `server/ultra_honk.rs:330` `parse_request(&body)` → `server/ultra_honk.rs:168`:
   - `serde_json::from_slice::<RawRequest>` via the manual `Deserialize` (`server/ultra_honk.rs:109-153`) — rejects duplicate keys, tolerates unknown keys, requires `bytecode`/`witness`/`verifier_target` (400 `invalid_request`).
   - `raw.verifier_target.parse::<VerifierTarget>()` (`bb/ultra_honk.rs:89`) — 400 `invalid_verifier_target` on an unknown spelling.
   - Encoded-length pre-check per field vs `encoded_cap(cap)` (`server/ultra_honk.rs:175-186`) using caps `MAX_BYTECODE_BYTES=16 MiB`, `MAX_WITNESS_BYTES=32 MiB`, `MAX_VK_BYTES=64 KiB` (`server/ultra_honk.rs:35-37`).
5. **`acquire_prover`** — `server/ultra_honk.rs:333` → `server/prove.rs:305`:
   - `resolve_version(state, requested_version)` (`server/prove.rs:51`): `AztecVersion::parse` (traversal guard, `versions/version_policy.rs:77`) → `check_version_selectable` (`versions/version_policy.rs:295`, denylist `KNOWN_VULNERABLE_VERSIONS`, empty by default) → normalizes an explicit-bundled request to `None`.
   - `download_if_needed` (`server/prove.rs:381`) → `versions::download_bb(version)` (`versions/downloader.rs:21`) only if `verify_cached_bb` failed.
   - `compute_threads(state)` (`server/prove.rs:110`) from config `speed`.
   - `acquire_version_lease(version)` (`server/prove.rs:430`) → `versions::acquire_lease` (`versions/leases.rs:120`) — `None` (evicting) → `503 version_evicting`.
   - `state.prove_semaphore.acquire_owned()` (`server/prove.rs:328`) — the single global prove permit (bb saturates all cores).
6. **Revocation re-check #1** — `server/ultra_honk.rs:334` `ensure_not_revoked(&state, &admitted.approval)` (`server/ultra_honk.rs:312`) → `auth_manager.revoked_since(origin, approval.granted_at)` (`authorization.rs:524`) — catches a Settings removal that happened while the job queued for the permit.
7. **Decode on blocking worker** — `server/ultra_honk.rs:338` `on_worker(held, |cancel| decode_and_check(&raw, cancel))` (`server/ultra_honk.rs:286`, `spawn_blocking`; `CancelOnDrop` arms cancellation on client disconnect):
   - `decode_and_check` (`server/ultra_honk.rs:248`): `decode_field` (base64-decode via `BASE64` engine, padding-indifferent, `server/ultra_honk.rs:196`) → `require_gzip` (magic-byte check `1f 8b`, `server/ultra_honk.rs:208`) → `inflate_dry_run` (`server/ultra_honk.rs:219`, `flate2::read::MultiGzDecoder` streamed through a counting sink; cap `MAX_INFLATED_BYTES = 256 MiB`, chunk `INFLATE_CHUNK = 64 KiB`, cancel-polled per chunk) for `bytecode` and `witness`; `vk` decoded but not gzip/inflate-checked.
8. **Revocation re-check #2** — `server/ultra_honk.rs:339`.
9. **Workspace write (blocking worker)** — `server/ultra_honk.rs:347` → `UltraHonkWorkspace::create(&job)` (`bb/ultra_honk.rs:209`): private `0700` tempdir (`bb.rs:227` `create_prove_tempdir`), `write_witness` (`bb.rs:265`, `0600` mode, `create_new(true)` fail-closed) for `bytecode.gz`/`witness.gz`/optional `vk`. On Windows, `BB_READS_KEY_IN_TEXT_MODE = cfg!(windows)` (`bb/ultra_honk.rs:206`) sets the client key aside instead of writing it (bb.exe reads `-k` in text mode, corrupting binary keys).
10. **Revocation re-check #3** — `server/ultra_honk.rs:352`.
11. **bb command** — `server/ultra_honk.rs:354` `bb::run_ultra_honk(&workspace, target, version, threads)` (`bb/ultra_honk.rs:150`) → `build_ultra_honk_command` (`bb/ultra_honk.rs:245`):
    ```
    bb prove --scheme ultra_honk --output_format json -b <bytecode.gz> -w <witness.gz> -t <flag> -o <output_dir>
      [-k <vk>]        # client key present and not text-mode-excluded
      [--write_vk]     # no usable client key — bb computes and writes vk.json
    ```
    Env: `HARDWARE_CONCURRENCY=<threads>` only if a thread cap is configured (`bb.rs:432-436` `finish_command`). `command.kill_on_drop(true)`; spawned via `containment::spawn_and_register` under its own process group (Unix `process_group(0)`, `bb.rs:626-627`) / Windows Job Object — whole-tree SIGKILL/`TerminateJobObject` on drop/timeout/quiesce. `run_bb` (`bb.rs:344`) enforces `PROVE_TIMEOUT = 300s` (`bb.rs:17`) and caps retained stderr at `STDERR_RETAIN_CAP = 64 KiB` (`bb.rs:23`, draining continues to EOF regardless).
12. **Output read (blocking worker)** — `server/ultra_honk.rs:365` `bb::read_ultra_honk_outputs(&workspace)` → `bb/ultra_honk.rs:409` `read_outputs`:
    - `read_fields(workspace, "proof", MAX_PROOF_BYTES)` (`bb/ultra_honk.rs:312`) reads `proof.json`, streams `{"proof":["0x<64-hex>",…]}` via a custom `DeserializeSeed` (`bb/ultra_honk.rs:335-406`) that caps field count (`cap/32`) and rejects malformed/duplicate/trailing content without building a value tree. `MAX_PROOF_BYTES = 64 MiB` (`bb.rs:28`); `validate_proof_len` (`bb.rs:496`) requires non-empty, ≤ cap, 32-byte-aligned.
    - `public_inputs.json` similarly, `MAX_PUBLIC_INPUT_BYTES = 4 MiB` (`bb/ultra_honk.rs:25`); empty is valid (`validate_public_inputs_len`, `bb/ultra_honk.rs:280`).
    - `vk.json` only if the job carried no client key; `MAX_VK_BYTES = 64 KiB` (`bb/ultra_honk.rs:23`); `validate_vk_len` rejects empty (`bb/ultra_honk.rs:296`).
13. **Response** — `server/ultra_honk.rs:369` `render(&out)` (`server/ultra_honk.rs:390`) base64-encodes `proof`/`public_inputs`/optional `vk` into JSON; `set_duration_header` (`server/prove.rs:367`) sets `x-prove-duration-ms` (bb wall time only, excludes queue/download/auth).

**Cap constants named** (value, definition site):
- `MAX_INFLIGHT_PROVE = 8` — `server.rs:52`
- `MAX_ULTRA_HONK_PER_ORIGIN = 4` (`MAX_INFLIGHT_PROVE/2`) — `server/ultra_honk.rs:31`
- `MAX_BODY_SIZE = 50 MiB` — `server/prove.rs:121` (also the axum `DefaultBodyLimit`, `server.rs:395`)
- `BODY_READ_TIMEOUT = 30s` — `server/prove.rs:127`
- `MAX_BYTECODE_BYTES = 16 MiB`, `MAX_WITNESS_BYTES = 32 MiB`, `MAX_VK_BYTES (ingress) = 64 KiB` — `server/ultra_honk.rs:35-37`
- `MAX_INFLATED_BYTES = 256 MiB`, `INFLATE_CHUNK = 64 KiB` — `server/ultra_honk.rs:39-40`
- `PROVE_TIMEOUT = 300s` — `bb.rs:17`
- `STDERR_RETAIN_CAP = 64 KiB` — `bb.rs:23`
- `MAX_PROOF_BYTES = 64 MiB` — `bb.rs:28`
- `MAX_PUBLIC_INPUT_BYTES = 4 MiB`, `MAX_VK_BYTES (bb output) = 64 KiB` — `bb/ultra_honk.rs:23,25`
- `AUTH_DECISION_TIMEOUT = 60s` — `server.rs:64`
- `AUTH_QUEUE_BACKSTOP = 60s × (MAX_PENDING_ORIGINS+1) = 660s` — `server.rs:71-76`
- `MAX_PENDING_ORIGINS = 10` — `authorization.rs:221`
- `DENY_COOLDOWN = 30s` — `authorization.rs:228`
- `MAX_COOLDOWN_ENTRIES = 64`, `MAX_PIGGYBACK_SENDERS = 16`, `MAX_REVOCATION_ENTRIES = 256` — `authorization.rs:235,244,254`
- `CACHE_MAX_TOTAL_BYTES = 2 GiB` — `versions/version_policy.rs:197`
- `MAX_DOWNLOAD_BYTES = 64 MiB` — `versions/downloader.rs:131`
- `MAX_DECOMPRESSED_BYTES = 512 MiB` — `versions/downloader.rs:387`
- `CACHE_ENTRY_ACTIVE_WINDOW = 5 min` — `versions/downloader.rs:216`
- `PROVE_RESIDUE_FLOOR = 24h` — `bb.rs:152`

## 3. Trust boundaries

**Untrusted inputs and where validated:**
- **`Origin` header** — `server/auth.rs:72` `parse_request_origin`; canonicalized/validated by `CanonicalOrigin::parse` (`authorization.rs:22-103`, RFC 6454: rejects path/query/fragment/userinfo, IDNA-normalizes, exact-grammar checks extension IDs, rejects trailing-dot); absent → treated as trusted-local (non-browser caller assumption documented at `server/auth.rs:80-84`).
- **`Host`/`:authority`** — `server/host.rs:22-53` `host_is_trusted`; outermost middleware, fails closed on disagreement/absence, exact-port match, rejects userinfo/alternate-numeric/IPv4-mapped-IPv6/multi-dot forms (SEC-01a DNS-rebinding keystone).
- **`x-aztec-version`** — read raw at `server/prove.rs:374`; validated downstream by `AztecVersion::parse` (`versions/version_policy.rs:77-102`, charset/length/traversal gate) then `check_version_selectable` (`versions/version_policy.rs:295-315`, canonical-semver + revocation-denylist gate).
- **`Content-Length`** — `server/prove.rs:133-175` `reject_declared_oversize`, validates every comma-element per RFC 7230 §3.3.2 (digits-only, agreement, ≤ cap) before the permit is taken.
- **JSON body fields** (`bytecode`/`witness`/`vk`/`verifier_target`) — manual `Deserialize` (`server/ultra_honk.rs:109-153`) rejecting duplicate keys and requiring the three mandatory fields; `verifier_target` parsed against the closed `VerifierTarget::ALL` set (`bb/ultra_honk.rs:89-98`).
- **base64 fields** — `decode_field` (`server/ultra_honk.rs:196-206`), padding-indifferent standard alphabet; cap-checked post-decode.
- **gzip fields** — magic-byte check (`require_gzip`, `server/ultra_honk.rs:208-213`) then a streamed, cancel-aware, capped inflate dry-run (`inflate_dry_run`, `server/ultra_honk.rs:219-245`) — the gzip-bomb guard; walks every concatenated gzip member (bb accepts multi-member input).
- **`verifier_target` enum** — closed 8-variant enum (`bb/ultra_honk.rs:31-98`); a client string never reaches bb argv directly, only `as_flag()`'s fixed string literal.
- **Client `vk` file** — decoded/capped like other fields; written to the workspace via `write_witness` (`0600`, create-new) *except on Windows*, where `BB_READS_KEY_IN_TEXT_MODE` (`bb/ultra_honk.rs:206`) sets it aside (bb reads `-k` in text mode, corrupting binary content) and bb is told `--write_vk` instead, recomputing the key itself. On other OSes it's passed via `-k <path>` (`bb/ultra_honk.rs:267-274`).
- **bb's own output JSON** (`proof.json`/`public_inputs.json`/`vk.json`) — treated as untrusted too: streamed `DeserializeSeed` with per-field hex/length validation and a hard field-count cap (`bb/ultra_honk.rs:326-406`), plus post-parse byte-length/alignment checks (`bb.rs:496-512`, `bb/ultra_honk.rs:280-306`).

**Sinks:**
- **Temp files** — per-user private base `<runtime-data>/prove-tmp` created `0700` (`bb.rs:98-132`); per-prove workspace dir `0700` via `tempfile::Builder` (`bb.rs:227-260`, no create-then-chmod window); witness/bytecode/witness/vk files `0600` via `create_new(true)` (`bb.rs:265-286`) — fails closed on a pre-planted path/symlink. Windows: owner-only DACL via `win_acl::secure_create_dir`/`secure_create_file`, verified read-back (`bb.rs:236-248`).
- **bb child process** — spawned under process-group (Unix) / Job Object (Windows) containment (`bb.rs:603-1030`), `kill_on_drop(true)`, stderr captured (never inherited — `bb.rs:1061-1066`) and cap-drained (`bb.rs:519-543`); args are all server-constructed literals/validated paths (`bb/ultra_honk.rs:250-277`), never raw client strings; env limited to `HARDWARE_CONCURRENCY` (numeric, server-computed).
- **GitHub download** — `versions/downloader.rs:118-152` bounded-streaming (`MAX_DOWNLOAD_BYTES=64 MiB`, both Content-Length pre-check and running counter) then digest-verified (`verify_digest`, `versions/downloader.rs:158-180`) against `GET api.github.com/.../releases/tags/v{version}` asset digest (SEC-02 caveat documented inline: circular trust, same control plane serves binary+digest — MITM blocked by TLS, supply-chain compromise not). Extraction is gzip-bomb-capped (`CappedReader`, `versions/downloader.rs:388-467`, `MAX_DECOMPRESSED_BYTES=512 MiB`), rejects non-regular-file entries (symlink defense). Install is staged-then-published fail-closed (`install_version_dir`, `versions/downloader.rs:271-364`) with an integrity marker (`bb.sha256.json`, `versions/cache_layout.rs:140-165`) rehashed on every use (`verify_cached_bb`, `versions/cache_layout.rs:232-252`). macOS: quarantine-clear + ad-hoc re-sign before caching (`versions/downloader.rs:62-103`).
- **Config writes for approvals** — `server/auth.rs:174-204` `save_approved_origin` → `config::lock_mutate_save_to` (`config.rs:661`), gated by a `PersistCapability` (`config.rs:225-263`) so an older-schema build can't clobber a newer on-disk config; skipped entirely for the headless server's env-derived `ALLOWED_ORIGINS` config (`cap: None`, `packages/presto/server/src/main.rs:99-105`).

**Per-origin / global caps:** `MAX_ULTRA_HONK_PER_ORIGIN=4` (`server/ultra_honk.rs:31`), `MAX_INFLIGHT_PROVE=8` (`server.rs:52`), single global `prove_semaphore` (1 permit, `server.rs:205`), `MAX_PENDING_ORIGINS=10` distinct pending popups (`authorization.rs:221`), `MAX_PIGGYBACK_SENDERS=16` per pending popup (`authorization.rs:244`).

**Timeouts:** `BODY_READ_TIMEOUT=30s` (`server/prove.rs:127`), `AUTH_DECISION_TIMEOUT=60s`/`AUTH_QUEUE_BACKSTOP=660s` (`server.rs:64,71-76`), `PROVE_TIMEOUT=300s` (`bb.rs:17`), `DENY_COOLDOWN=30s` (`authorization.rs:228`), HTTP client `timeout=300s`/`connect_timeout=30s` (`versions/release_metadata.rs:9-17`).

**Logging:** structured `tracing` throughout — origin, version, target, elapsed, ok/error at `info`/`warn`/`debug`/`error` levels (`server/ultra_honk.rs:374-388` `log_outcome`, `bb.rs:320-324,455-469`). bb's stderr is captured, capped at 64 KiB, and logged server-side only — never returned to the HTTP client (`bb.rs:471-480` `require_success`, explicit comment: "Never return stderr to HTTP clients; it may contain paths or witness diagnostics"). Proof bytes/witness content are never logged, only lengths.

## 4. Dependency graph (one level)

- `server.rs` → `server/prove.rs`, `server/ultra_honk.rs`, `server/auth.rs`, `server/host.rs`, `bb`, `versions`, `config`, `authorization` (module declarations + `health`/router).
- `server/ultra_honk.rs` → `server/prove.rs` (`admit`, `acquire_prover`, `Admitted`, `Prover`, `set_duration_header`), `server/auth.rs` (`Approval`), `bb` (`UltraHonkJob`, `UltraHonkWorkspace`, `VerifierTarget`, `run_ultra_honk`, `read_ultra_honk_outputs`), `server.rs` (`AppState`, `ProveError`, `MAX_INFLIGHT_PROVE`), `authorization` (`CanonicalOrigin`).
- `server/prove.rs` → `server/auth.rs` (`authorize_origin`, `Approval`), `server/ultra_honk.rs` (`OriginSlot`, `OriginSlots`), `bb`, `versions`, `server.rs` (`AppState`, `ProveError`, `ServerStatus`).
- `server/auth.rs` → `authorization` (`AuthorizationManager`, `CanonicalOrigin`, `Generation`, …), `config`, `server.rs` (`AppState`, `ProveError`, `AUTH_QUEUE_BACKSTOP`).
- `server/host.rs` → axum only (no crate deps).
- `bb.rs` → `versions` (leases, `AztecVersion`), `bb/ultra_honk.rs` (submodule).
- `bb/ultra_honk.rs` → `bb.rs` (shared helpers: `acquire_version_lease`, `create_prove_tempdir`, `find_bb`, `finish_command`, `read_capped`, `run_bb`, `validate_proof_len`, `write_witness`), `versions`.
- `versions/mod.rs` → `versions/cache_layout.rs`, `versions/downloader.rs`, `versions/leases.rs`, `versions/release_metadata.rs`, `versions/version_policy.rs` (re-exports).
- `versions/downloader.rs` → `versions/cache_layout.rs`, `versions/release_metadata.rs`, `versions/version_policy.rs`, `versions/leases.rs` (via `super::leases::begin_evict`).
- `versions/cache_layout.rs` → `versions/release_metadata.rs`, `versions/version_policy.rs`.
- `versions/version_policy.rs` → `versions/cache_layout.rs`, `versions/leases.rs`.
- `authorization.rs` → no intra-crate deps (leaf module: `parking_lot`, `url`, `uuid`, `tokio::sync::oneshot`).
- `packages/presto/server/src/main.rs` → `presto_core::authorization`, `presto_core::config`, `presto_core::server` (`start_on`, `AppState`, `HeadlessState`), `presto_core::bb` (`begin_quiesce`, `terminate_and_confirm`), `presto_core::isolated_presto_home`.
- `packages/presto/src-tauri/src/main.rs` → `presto::server` (`start`, `AppState`, `HeadlessState`, callbacks), `presto::config` (`ConfigStore`), `presto::authorization` (`AuthorizationManager`), `windows.rs` (`show_auth_popup_window`); `commands.rs` → `crate::authorization::CanonicalOrigin`, `AuthState`/`ConfigState` (revoke on Settings removal, `respond_auth`/`get_pending_auth` resolving via `AuthorizationManager`).

## 5. Frameworks

- **axum 0.8** — router/middleware (`server.rs`), extractors (`Request`, `State`), `DefaultBodyLimit`, `axum::middleware::from_fn` for the host guard, `IntoResponse` impls for `ProveError`.
- **tokio** (`features=["full"]`) — async runtime, `tokio::time::timeout` (body read, auth queue backstop, bb process wait), `tokio::sync::{Semaphore, oneshot, Mutex}`, `tokio::task::spawn_blocking` (the ultra-honk decode/write/read workers, `on_worker` in `server/ultra_honk.rs:286`), `tokio::process::Command`.
- **serde / serde_json** — most bodies use `#[derive(Serialize/Deserialize)]`, but `RawRequest` (`server/ultra_honk.rs:109-153`) is a **hand-written `Deserialize`** implementing `Visitor::visit_map` directly to reject duplicate keys and require exact fields without an intermediate `serde_json::Value`; bb's JSON *output* is likewise hand-decoded via `DeserializeSeed` (`FieldsSeed`/`FieldArray`, `bb/ultra_honk.rs:335-406`) to stream-validate-and-cap without building a value tree.
- **base64 0.23** — a custom `GeneralPurpose` engine configured `DecodePaddingMode::Indifferent` (`server/ultra_honk.rs:44-47`) since Noir toolchain output isn't guaranteed canonically padded.
- **flate2** — `MultiGzDecoder` for the inflate-bomb dry run (`server/ultra_honk.rs:225`) and tarball extraction (`GzDecoder`, `versions/downloader.rs:429`).
- **reqwest 0.13** — `versions/release_metadata.rs:10-17` shared client (`stream`, `json` features), used for both the tarball download (streamed chunk-by-chunk) and the GitHub API digest lookup.
- Also: `tower-http 0.7` (`CorsLayer`, `SetResponseHeaderLayer`), `semver` (version-selectable canonical-form check), `uuid` (opaque request IDs, SEC-06), `url` (origin canonicalization), `sha2`/`hex` (integrity marker digests), `tar` (tarball extraction), `parking_lot` (`AuthorizationManager` mutex, `ConfigStore` RwLock).

## 6. Test surfaces

**Unit tests in the target modules** (one line each):
- `server/ultra_honk.rs`: parse accepts the contract and names every rejection; decode requires gzip fields and bounds inflation; inflate dry-run stops at the cap, counts every member, honours cancel; origin slots cap each origin and release on drop; a dropped request releases its guards only after the worker returns; render includes the key only when present.
- `server/prove.rs`: declared oversize rejected before permit; waiter cap sheds excess with queue-full; body read does not hold the prove permit; oversized body errs; stalled body times out.
- `server/auth.rs`: no dedicated `#[cfg(test)] mod tests` (covered by `server/tests.rs`).
- `server/host.rs`: accepts real client authorities; rejects multi-dot trailing forms; rejects DNS-rebinding/external hosts; rejects wrong port; rejects alternate numeric/mapped forms; rejects userinfo smuggling; rejects malformed authorities.
- `authorization.rs`: auto-approved localhost variants; non-localhost not auto-approved; is_approved checks both; request-and-resolve piggybacking; resolve deny; resolve ignores wrong request_id; rejects too many pending origins; rejects too many piggyback senders; arbiter first-is-active/second-is-queued; arbiter resolving active promotes next; arbiter resolving queued does not promote; arbiter user-resolve rejects non-active; ~15 `canonicalize_origin`/`CanonicalOrigin` tests (default ports elided, trailing-dot rejected, extension-id grammar, IDN homograph non-collision, idempotence); deny-cooldown tests (user deny, system deny, expiry, eviction cap); revocation-forgetting-denies-not-revives.
- `bb.rs`: prove-workspace/witness private modes (Unix + Windows); `child_stderr_is_captured...`; `truncate_stderr` char-boundary safety; `prepend_field_count_header` (3 variants); `find_bb` env override / nonexistent path / resolution priority / uncached-version fail-closed; reap tests (abandoned-but-not-live, ignores foreign entries, does-not-follow-symlinks, missing-parent no-op); `drain_capped` retains-cap-counts-total / handles-smaller-than-cap; `validate_proof_len` accepts-only-nonempty-capped-aligned; end-to-end fake-bb: rejects empty proof / rejects non-aligned proof / succeeds despite chatty stderr / times out on hang; containment: `terminate_inflight_kills_bb_and_its_grandchild`, `terminate_and_confirm_kills_the_tree_and_confirms_it`, `terminate_and_confirm_is_ok_when_nothing_is_running`, `spawn_is_refused_while_quiescing_then_reopens`, `finish_reaps_a_straggler_grandchild_on_the_success_path`; Windows `contain_spawn_failure_confirms_the_direct_child_is_dead`.
- `bb/ultra_honk.rs`: verifier targets round-trip bb spellings and reject unknown ones; JSON fields streamed/validated/bounded; output-length rules allow empty public inputs but not empty keys; command carries `-k` for a client key and `--write_vk` without one; workspace files are private to the user; end-to-end fake-bb: returns raw outputs and the key only when bb computed it; accepts empty public inputs but rejects missing/malformed outputs; rejects an empty key and times out a hung bb.
- `versions/downloader.rs`: extracts bb within cap; rejects bb entry declaring over cap; capped reader trips on cumulative decompressed bytes; extract from synthetic/nested tarball; rejects symlink entry; fails on corrupted gzip/empty input; cleans up on missing bb; `reap_stale_stages_spares_recently_active_stages`; publisher-contention trio (held-and-valid preserved, held-but-corrupt fails loudly, evicting fails rather than vouching); `install_version_dir_stages_marks_and_publishes`; `download_and_verify_bb` (network-gated, `PRESTO_DOWNLOAD_TEST`).
- `versions/cache_layout.rs`: version_bb_path format; list_cached_versions structural checks; `verify_bb_entry` accepts-matching / is-fail-closed / rejects-symlink-binary; `version_dir_size` sums+tolerates missing; `list_cached_versions_in` excludes stages/unmarked/junk; marker written owner-only; cross-language fixture-schema contracts (`bb-cache-marker.json`, `github-release-metadata.json`).
- `versions/leases.rs`: lease visible-while-held/gone-after; last-holder-releases-not-first (refcount); reservation excludes acquisition until released; held-version cannot be reserved; two passes cannot both reserve; panic-while-holding still releases; panic-while-reserving still un-reserves; leases are per-version.
- `versions/version_policy.rs`: `is_valid_version` accepts real / rejects traversal-injection-dots; `AztecVersion::parse` matches `is_valid_version`; unsafe version cannot be constructed for download sink; tier classification/retention limits; F-06 size-cap regression suite (mainnet grows unbounded until cap binds, cap binds regardless of classification, under-cap left alone, bundled/in-use never evicted for size); lease-closure suite (held survives eviction, unheld evicted, recently-active deferred); evict-excess-nightlies; evictions-exempt-in-use; bundled-never-evicted; mainnet-never-evicted; rc-versions-sort-numerically; mixed-tiers; version-selectable allow-by-default / refuses-denylisted / rejects-aliases-and-build-metadata / denylist-entries-wellformed; `versions_to_evict` edge cases.
- `packages/presto/server/src/main.rs`: `a_foreign_listener_gets_actionable_guidance_without_changing_it`; port-resolution suite (`a_non_default_port_requires_an_isolated_presto_home`); gating suite (`allow_all_no_origins`, `allow_all_conflicts_with_allowlist`, `default_is_deny_by_default_empty_allowlist`, `allowlist_parses_origins`, `present_but_empty_allowlist_still_gates`, `invalid_origin_errs`) plus `ALLOWED_ORIGINS` parser tests (parses/canonicalizes, empty-not-error, trailing-comma tolerated, dedupes order-preserving, fails-fast-on-invalid).
- `server/tests.rs` (integration-style, router-level, 1744 lines) covers, among others: `health_*` tiering (SEC-05 detailed-vs-minimal by Origin/approval), CORS preflight/headers, `prove_error_responses_stay_text_plain_json_string`, `a_denied_origin_is_refused_with_authorization_cooldown_without_re_prompting`, `prove_success_path_and_status_sequence`, `prove_auto_approves_localhost_origin`, `prove_triggers_popup_for_unknown_origin`, `prove_returns_403_when_origin_denied`, `prove_allows_no_origin_only_with_trusted_loopback_host`, `prove_rejects_forged_host_dns_rebinding`, `prove_approves_remembered_origin`, `prove_returns_403_without_popup_in_headless`, `prove_returns_429_when_too_many_pending_origins`, `prove_returns_403_on_authorization_timeout`, `invalid_host_reply_stays_application_json_without_message`, `prove_sheds_with_429_when_waiter_cap_full`, `allow_persists_the_origin_to_disk`; ultra-honk-specific: `ultra_honk_returns_raw_outputs_and_the_key_only_when_bb_computed_it`, `ultra_honk_rejects_malformed_bodies_with_named_text_plain_errors`, `ultra_honk_sheds_a_fifth_concurrent_job_from_one_origin_but_not_another`, `ultra_honk_denies_a_job_whose_origin_was_removed_in_settings_while_queued`, `health_advertises_schemes_everywhere_and_version_pairs_only_when_detailed`, `a_popup_allow_older_than_a_settings_removal_is_dropped`, `an_allow_whose_persist_fails_still_proves_and_re_prompts_later`.

**`ultra_honk_real_bb` ignored test** — `packages/presto/core/tests/ultra_honk_real_bb.rs` (separate integration-test crate, `#[ignore = "needs a real bb binary and the CRS; run in the ultra-honk-real-bb CI lane"]` on every test, run via `cargo test -- --ignored` in a dedicated CI lane): `native_proofs_match_the_wasm_reference_and_verify` (byte-equal to `fixtures/noir/{square,nopub}` reference proofs, native `bb verify` round-trip, tampered-proof-fails check); `every_supported_target_proves_and_verifies` (all 6 non-starknet `VerifierTarget`s); `starknet_targets_are_refused_by_bb` (pins bb 5.2.0's own rejection, surfaced as `prove_failed`); `a_key_from_another_circuit_never_yields_a_verifying_proof` (cross-circuit vk never verifies, never crashes the server).

**HTTP smoke script** — `packages/presto/scripts/ultra-honk-smoke.ts` (`bun` entrypoint, runtime-neutral exported helpers reused by the WebDriver spec): `PRESTO_URL` (default `http://127.0.0.1:59833`) + `BB_BINARY_PATH`; posts `fixtures/noir/{square,nopub}` jobs with/without a client `vk`, checks response bytes against the WASM/bb.js references (`checkOutputs`) and native-verifies with `bb verify` (`verifyNatively`). Companion `packages/presto/scripts/ultra-honk-smoke.test.ts` exists alongside it.

**WebDriver ultra-honk spec** — `packages/presto/e2e-webdriver/ultra-honk.spec.ts`: drives the real desktop app end to end — "Allow proves the fixture natively: byte-equal to the WASM reference and sidecar-verified" (through the consent popup, `#allow`, then `verifyNatively` against the *shipped sidecar bb*, skipped on Windows via `SIDECAR_VERIFIES = process.platform !== "win32"` since `bb.exe` reads verify inputs in text mode); "an unknown verifier_target from the approved origin is a 400 with no consent prompt"; "Deny is a 403 before anything runs and persists nothing" (via `#deny`).

## 7. Generated / vendored / fixture code

`fixtures/noir/*` (repo root, not under `packages/presto`) holds two committed Noir circuits used as ground truth by both the Rust `#[ignore]`d integration test and the TS smoke/WebDriver suites:
- `fixtures/noir/square/` and `fixtures/noir/nopub/` — each contains `Nargo.toml`, `src/main.nr`, `target/{name}.json` + `target/{name}.gz` (compiled artifact), `circuit.json` (the wire-format `bytecode` string), `Prover.toml`, `witness.gz`, `vk`, `proof`, `public_inputs`, and `manifest.json` (records the fixture's `verifierTarget`, e.g. `noir-recursive-no-zk`).
- Consumed via `loadFixture(root, name)` in `packages/presto/scripts/ultra-honk-smoke.ts:39-53` (reads `circuit.json`+`manifest.json`, wraps `witness.gz`/`vk`/`proof`/`public_inputs` as raw bytes) and via `fixture(name)` in `packages/presto/core/tests/ultra_honk_real_bb.rs:38-54` (same file set, read via `std::fs::read` relative to `CARGO_MANIFEST_DIR/../../../fixtures/noir`).
- Purpose: these are pre-computed WASM (bb.js) reference outputs — the real-bb test asserts the *native* bb output is byte-identical to them (for the deterministic `-no-zk` target) and that both verify; they are the only fixture/vendored artifacts in this request path (no generated/vendored Rust code in the modules of interest).

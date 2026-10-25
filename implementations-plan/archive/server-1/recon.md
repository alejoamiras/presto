# server-1 recon

Base: `main` @ 80b562e. One Explore sweep (Sonnet) plus direct reads. Paths are relative to
`packages/presto/core/src/` unless they say otherwise.

## Reuse map

| Capability needed | Existing code | Verdict |
|---|---|---|
| One funnel for wire error bodies | `ProveError` + `prove_parts` + `json_error` (`server.rs:530-731`) | reuse-as-is |
| "Fixed text for the site, detail elsewhere" | `bb_failure` (`server/prove.rs:362-379`): the custom route sends `"bb prove failed"`, records the detail for Settings, and downcasts `custom_bb::Unavailable` | adapt (the same fixed text on the official route) |
| Coarse download cause | none: `download_bb` returns `Box<dyn Error>` built from strings (`versions/downloader.rs:21`). Searched `enum`, `thiserror`, `kind`, `Failure` in `versions/` | build new (`DownloadFailure`) |
| Log the source chain | `tracing-subscriber` 0.3.23 `fmt` prints `error.sources=[…]` for a field recorded as `&dyn Error` (`fmt/format/mod.rs:1276`); both launchers use the default `fmt::layer()` (`src-tauri/src/main.rs:951`, `server/src/main.rs:42`) | reuse-as-is (no helper) |
| Status to cause | `refusal_reason` (`versions/release_metadata.rs:131`) formats the status; nothing maps it to a cause | adapt |
| Test: path stays off the wire | `a_custom_route_workspace_failure_keeps_its_path_off_the_wire` (`server/tests.rs:2112-2160`): child-process re-run, `prove-tmp` as a file, `TMPDIR` missing; helpers `outcome`, `ultra_honk_request`, `chonk_request`, `ScopedPrestoHome` | reuse the pattern |
| Test: tarball fixtures | `make_targz` (`versions/downloader.rs:476`) | reuse-as-is |
| Network seam for `download_bb` | none: the URLs are fixed to github.com (`release_metadata.rs:96`, `:165`); network tests are gated on `PRESTO_DOWNLOAD_TEST`. Searched `mock`, `fake`, `serve_one` | not built (see plan) |

## The path from a failed download to the body

`/prove` (`server/prove.rs:327`) and `/prove/ultra-honk` (`server/ultra_honk.rs:326`) call
`acquire_prover` (`prove.rs:520`), which calls `download_if_needed` (`prove.rs:531`, body `:626`),
which calls `versions::download_bb` (`prove.rs:651`). Its `map_err` logs `error = %error` and builds
`ProveError::DownloadFailed { detail: error.to_string() }` (`prove.rs:652-656`). `prove_parts`
renders `format!("Failed to download bb v{version}: {detail}")` (`server.rs:698-702`). Both listeners
use the one `router` (`server.rs:389`); `src-tauri` adds only the TLS wrapper.

## Which download errors carry a local path

- **Demonstrated**: the `tar` 0.4.46 unpack. `extract_bb_from_tarball_capped` calls
  `entry.unpack(dest.join("bb"))` (`downloader.rs:461`), and tar wraps an open or write failure as
  ``failed to unpack `<entry>` into `<dest>/bb` `` (`tar-0.4.46/src/entry.rs:683-690`). `dest` is the
  staging directory `<versions_base_dir>/.<version>.tmp.<pid>-<nanos>-<seq>` (`downloader.rs:189`,
  `:282`), under `~/.presto/versions` or `$PRESTO_HOME/versions`. A scratch program printed
  ``failed to unpack `barretenberg/bb` into `<tmp>/.6.0.0.tmp.1-2-3/bb` `` for
  `error.to_string()`, and the OS reason (`No such file or directory (os error 2)`) only through
  `source()`. So today's body names the path, and today's log line drops the reason.
- Path-free: every other site uses `std::io::Error` (its `Display` names no path), reqwest errors
  (they name the GitHub URL), status strings, digests, size caps, and the fixed
  `"SECURITY: home directory unresolved…"` (`downloader.rs:63`).

## Other client-facing bodies

- **`prove_failed`, official route: demonstrated path.** `bb_failure` returns
  `ProveFailed(error.to_string())` when the route is not custom (`prove.rs:368`). The prove
  workspace comes from `create_prove_tempdir` (`bb.rs:264`), and `tempfile` 3.27.0 wraps its error
  as `"{err} at path {path:?}"` (`tempfile-3.27.0/src/error.rs:10-13`). The scratch program printed
  `Not a directory (os error 20) at path "<tmp>/prove-tmp/prove-ThAkVd"`. Both routes
  reach it: chonk via `ProveWorkspace::create` inside `bb::prove_cancellable` (`bb.rs:371`), UltraHonk
  via `UltraHonkWorkspace::create` in the handler (`server/ultra_honk.rs:342-345`). The comment there
  ("A workspace error names the temp path, so the custom route must redact it too") shows the custom
  route was fixed and the official one was not. UltraHonk's `log_outcome` logs only `ok`
  (`ultra_honk.rs:382`), so that route logs no detail today.
- Path-free by trace: bb's stderr never reaches a body (`require_success`, `bb.rs:686-695`); spawn
  errors are bare `std::io::Error`; `find_bb`, version policy, budget, eviction and custom-bb bodies
  are fixed or name no path; `invalid_request`, `invalid_version`, `invalid_verifier_target`,
  `origin_denied` and `payload_too_large` echo client input or axum/serde text.
- `invalid_host` is an `axum::Json` body with no message (`server/host.rs:81-84`).

## Tests that pin these bodies

- No Rust or TS test asserts a `download_failed` message. The SDK keys on the code only
  (`packages/sdk-core/src/lib/presto-client.ts:552`); `presto-client.test.ts:335` pins the code.
- `prove_error_responses_stay_text_plain_json_string` (`server/tests.rs:379`) checks content type,
  code and `message.is_string()`; it does not build `DownloadFailed`.
- The custom-route path tests: `server/tests.rs:1979-1999`, `:2087-2107`, `:2112-2160`.

## Docs

No doc quotes the `download_failed` message. `PRIVACY.md:39-42` says no error body carries the
witness; it says nothing about paths. `follow-ups.md` names the `GITHUB_TOKEN` hint as the server's;
it stays in the log.

## Collisions

- `sdk-1` (#102) classifies `download_failed` by its code in presto-core; it does not read the
  message. No shared file.
- `tests-1` edits `verified_sites` tests and `src-tauri/tests`; this lane edits `server/tests.rs`,
  `versions/*` and `bb*`. No shared file.
- No closed `known-limit` issue matches "error message" or "download_failed".

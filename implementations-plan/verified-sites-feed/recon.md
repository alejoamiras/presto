# Recon: verified-sites-feed

Read against `origin/main` at `3ebb19b` on 2026-10-03. Three read-only explorers (a batched reuse
sweep, a client-side Rust mapper, a CI/Worker mapper) plus live checks of GitHub settings and the
listed origins. Paths are repo-relative.

## Reuse map

| Capability | Existing code | Verdict |
|---|---|---|
| Ed25519 signature verification | `minisign-verify =0.2.5` in `packages/presto/core/Cargo.toml`; call pattern in `core/src/update_manifest.rs` (decode pubkey doc, decode sig doc, `verify(bytes, sig, false)`) | **reuse-as-is**: no new crypto crate |
| Signed envelope (verbatim bytes as base64 + detached sig, schema discriminator, caps before decode) | `core/src/update_manifest.rs` (`ENVELOPE_SCHEMA`, `MANIFEST_B64_MAX`, `deny_unknown_fields`) | **adapt**: the field-extract + cap + decode + verify front half is generic; the back half is updater-specific. Either extract a small shared helper or mirror the pattern under a new schema string |
| Signing tool in CI | `packages/presto/scripts/sign-release-updater-artifacts.sh` (pinned local `node_modules/.bin/tauri signer sign`, key scoped to a subshell, verifier built before the key is exposed) | **reuse the pattern**: `tauri signer` is the repo's only signer; produces minisign Ed25519 keys and prehashed sigs `minisign-verify` accepts |
| Key generation | `tauri signer generate` (`ephemeral-updater.sh` keygen, `presto.yml` `updater-feed-e2e`) | **reuse-as-is** for both the production key (owner, password-protected) and throwaway test keys |
| CLI verifier usable from CI | `core/examples/update-manifest.rs` (`envelope`/`splice`/`verify`/`verify-artifact`) | **adapt**: a sibling example (or subcommands) for the list, so CI verifies with the same code the app runs |
| Monotonic version floor on disk | `core/src/updater_state.rs` (floor/pending, F-04 self-heal: corrupt state is recoverable, a forged floor cannot wedge the channel) | **adapt the pattern, not the code** (SemVer-shaped). The F-04 lesson applies directly |
| Atomic owner-only JSON write | `updater_state.rs` `write_private_atomic` (tempfile + 0600 + fsync file and dir + rename; no Windows ACL step), already shared with `update_schedule.rs` | **reuse-as-is** |
| Cross-process lock | `core/src/file_lock.rs` (`lock_exclusive_within`) | **reuse-as-is** |
| Launch + 6 h cadence | `core/src/update_schedule.rs` `run_updates` (generic over `Observation`/`Reply`; constants `CHECK_INTERVAL_SECS`, `WAKE_TICK`, `LAUNCH_DELAY` are `pub`); one call site, `src-tauri/src/main.rs` `spawn_update_task` | **reuse**: piggyback the update task's tick or run a second `run_updates` with its own store. Explorers disagree; a plan decision |
| Bounded HTTP GET | `core/src/versions/release_metadata.rs` `client_builder` (timeouts, `user_agent("presto")`, `redirect::Policy::none()` variant); `versions/downloader.rs` Content-Length early reject + running byte counter | **build new, small**, copying that idiom exactly. No shared bounded-fetch helper exists (searched `reqwest::Client`, `ClientBuilder`, `MAX_.*BYTES` under `packages/presto/{core,src-tauri,server}`) |
| Origin canonicalization | `core/src/authorization.rs` `canonicalize_origin` (rejects paths, userinfo, trailing dots; validates the chrome-extension ID grammar) | **reuse-as-is** |
| Registry load + lookup | `src-tauri/src/verified_sites.rs` (`include_str!`, private `HashMap`, `lookup`) | **adapt**: becomes one of two sources; validation must be shared by the built-in and the fetched list |
| Runtime-swappable registry state | `commands.rs` `VerifiedSitesState = Arc<VerifiedSitesRegistry>` (immutable); `ConfigStore`'s `parking_lot::RwLock` shape in `core/src/config.rs` | **adapt**: swap the whole registry under a lock. No new IPC command or ACL grant: `get_verified_info` already reads state on each popup render |
| JSON Schema validation | `verified-sites.schema.json` is editor/docs only; no `ajv` anywhere (searched `\bajv\b` in `*.ts`/`*.json` outside `node_modules`) | Rust structs with `deny_unknown_fields` are the repo's enforcement idiom; CI validates with a Rust example binary, not new TS tooling |
| Worker path for a second KV key | `packages/release-feed/src/index.ts` (exact-path match on `/releases/latest.json`, 404 otherwise); route `presto.build/releases/*` already covers a sibling path | **adapt**: add a second path→key branch; tests mirror `index.test.ts` |
| KV write + live verification | `release-presto.yml` `promote` (retried `wrangler kv key put` with exact pre-verified bytes) and `verify-live-feed` (separate job gated on `write_attempted`, re-verifies the live bytes with the production verifier) | **reuse the pattern** in a new workflow; must not live in `release-presto.yml` (see collisions) |
| No-secret job → secret job handoff | `release-presto.yml` `build` → `sign-updater-artifacts` (artifact handoff); `release` → `finalize` (sha256 manifest diffed later) | **reuse the pattern** |
| Daily public-feed probe | `.github/workflows/update-feed-health.yml` (credential-free, writes `$GITHUB_STEP_SUMMARY`) | **adapt/extend** for the list |
| Append-only history | None. Releases/tags are append-only by policy only (`release-presto.yml` refuses a published tag); KV is a mutable pointer; no R2; immutable releases are off; no tag ruleset | **build new**: medium is an owner decision |
| Throwaway-key fixtures | `core/tests/fixtures/updater/{latest.json,pubkey.b64}` (generated by hand once); fresh ephemeral keys per CI run elsewhere | **reuse the two-tier approach** |

> Superseded by the plan: the signing-tool and key-generation rows. CI signs with a dependency-free
> Bun signer from a raw seed that the keyed run generates (plan D7).

## The registry today

- Built once at startup (`main.rs` `.manage(Arc::new(VerifiedSitesRegistry::load()))`); read only by
  `get_verified_info` (`commands.rs`), gated by `require_auth_window`, granted only to `auth-*`
  windows (`capabilities/authorize.json`). The popup (`frontend-src/authorize.js`) invokes it per
  render with the server-authoritative origin.
- **Display-only, confirmed**: no approval, deny-by-default, cooldown or `/health` decision reads it
  (`authorization.rs` `is_auto_approved`/`is_approved` take no registry). The headless server and
  `core` never reference it. Settings lists raw approved origins with no names.
- Load-time validation is hand-written in `try_load` (ASCII-only raw origins, canonicalization,
  displayName 1–64, duplicate detection). The structs lack `deny_unknown_fields`.
- Release builds turn a broken file into an empty registry; debug builds panic. `build.rs` only
  checks JSON syntax.
- `.github/CODEOWNERS` lists the three registry files, but the `main` ruleset has
  `require_code_owner_review: false` and `required_approving_review_count: 0`, so it only
  auto-requests review.

## Facts checked live (2026-10-03)

- `https://faucet.nulo.sh` does not resolve. `https://presto-playground.alejo-amiras.workers.dev`
  returns 200 directly. `https://www.yacana.network` 301s to the bare domain.
- `https://presto.build/releases/verified-sites.json` returns 404 (the Worker's exact-path match).
- Chrome Web Store ID `jlmiaokmjoicmclelpiiocdhncddkdmc` is the listing "Nulo V5" (0.28.0), linking
  `nulo.sh/privacy`. The ID matches `is_chrome_extension_id`'s grammar.
- GitHub environments `release-feed`, `release-signing`, `npm-publish`: branch policy `main` only,
  no required reviewers, `can_admins_bypass: true`.
- `main` ruleset requires `SDK Status`, `App Status`, `Presto Status`, `Actionlint Status` (strict).
  **`Landing Status`, which gates `packages/release-feed`, is not required.**
- The agents' `gh` token has `repo` scope as the owner; the git remote is SSH with full push rights.

## Collisions and constraints

- `docs/RELEASE_RUNBOOK.md` ("One-time production configuration") states neither environment
  requires reviewers and that environments "are not independent approval boundaries" in this
  solo-maintainer repo. A required-reviewer environment is a deliberate exception; the doc must say
  so.
- `scripts/cloudflare-deployment.test.ts` asserts `release-presto.yml` has exactly one
  `wrangler kv key put` and exactly two `environment: release-feed`, and that
  `deploy-release-feed.yml` never writes KV nor reads `CLOUDFLARE_RELEASE_FEED_API_TOKEN`.
  `packages/presto/scripts/release-contract.test.ts` pins `release-presto.yml`'s jobs. The new
  publish path belongs in its own workflow.
- `scripts/presto-domain.test.ts` pins the playground entry's origins, including the workers.dev
  alias.
- `CLOUDFLARE_RELEASE_FEED_API_TOKEN` is Workers KV Storage Edit, account-wide. A second key or a
  second namespace gives no token isolation; only client-side signature checks protect the list.
- `update_schedule.rs` and `updater_state.rs` deny `unwrap`/`expect`/`panic`/indexing/arithmetic:
  release builds abort on panic and crash recovery turns a startup panic into a crash loop.
- `should_poll_for_updates()` suppresses update checks in debug, under `PRESTO_NO_UPDATE` and in the
  WebDriver build, whose schedule store is memory-only.
- The uninstaller leaves `config.json`, `update-schedule.json` and `updater-state.json`; a new state
  file would survive a reinstall too.
- `.github/filters/presto.yml` routes `verified-sites.json` to `rust_platform`, `desktop_runtime`
  and `windows_packaging`; nothing routes `packages/release-feed/**` except `landing.yml`'s inline
  filter.
- `scripts/action-pins.test.ts` enforces SHA-pinned `uses:` on every workflow, new ones included.

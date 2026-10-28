# release-2 recon

Base: `main` @ 8d4098b2 (2026-10-28). One Explore agent (Sonnet) for the reuse sweep; every claim
below was re-checked by hand against the tree, the runs and the registry.

## Reuse map

| Capability needed | Existing code | Verdict |
|---|---|---|
| Prepare the runner `$HOME` before the N-1 AppImage starts | `packages/presto/scripts/updater-smoke-linux.sh:64-74` (`CONFIG_DIR`, `APP_DIR`, `mkdir -p "$SERVE_DIR" "$APP_DIR"`), `:231` (`mkdir -p "$CONFIG_DIR"`) | adapt: add the cache dir to the line-74 `mkdir` |
| Launch the app | `updater-smoke-modes.sh:25` `launch_app`, shared with the macOS `updater-smoke.sh` (bash 3.2) | reuse as is; a Linux-only dir does not belong in the shared helper |
| Pin a smoke script's shell text | `packages/presto/scripts/release-contract.test.ts` (`UPDATER_SMOKE_SCRIPTS`, `:30`; text pins at `:584`, `:1128`); `release-feed-contract.test.ts:468-500`; `tray-menu.test.ts:120` | reuse: one more `test()` in `release-contract.test.ts` |
| Accept an advisory | `scripts/dependency-audit-allowlist.json`; `parseAllowlist`/`evaluateFindings` in `scripts/dependency-audit.ts` | reuse as is: append three entries |
| Prove the audit | `bun run audit:dependencies` (`package.json:17`), CI `dependency-audit.yml` (its PR paths include the allowlist) | reuse as is |

Absences, with search trail: no other script launches an AppImage (`grep -rIl -i appimage` over
`.github`, `scripts`, `packages/presto/scripts`, every workflow hit read); no smoke script sets
`HOME`, `XDG_*` or `TMPDIR` (`grep -nE 'mkdir|HOME|XDG|TMPDIR'` over the four smoke scripts); no
test loads the real allowlist (`grep -rn dependency-audit-allowlist`: only
`ci-filter-contract.test.ts:218`, a path pin); no Linux job pins an Ubuntu version except
`release-presto.yml:563` `ubuntu-24.04-arm` (`grep -rnE 'ubuntu-[0-9]' .github`).

## The Linux smoke failure (verified)

- Release run 40574646039, job 122450669186 (`positive / from 1.2.1`): the app logged
  `ERROR presto::updater: Update install failed: No such file or directory (os error 2) at path
  "/home/runner/.cache/tauri_current_app2Fyq5L"`; `/health` never reported 1.2.2-rc.1. The
  `negative` leg passed (it never installs).
- Runner: label `ubuntu-latest`, image `ubuntu-26.04` version 20261012.163.1, Ubuntu 26.04.1.
  `20261021.618` is the Runner Image Provisioner (Hosted Compute Agent) version, not the image.
  Green job 117419969259 (run 39040116463, Oct 17, `from 1.2.0`): same label, image `ubuntu-24.04`
  20261012.334.1.
- `tauri-plugin-updater` 2.11.0 (`src-tauri/Cargo.lock:4464`), `src/updater.rs:1047-1120`,
  `install_appimage`: locations `env::temp_dir()`, `dirs::cache_dir`, the AppImage's parent. Each
  runs `tempdir_in(..)?` then compares `dev()` with the AppImage's. A device mismatch moves on;
  a `tempdir_in` error returns at once. The log path proves location 1 was created but sat on
  another device, and location 2's parent (`~/.cache`) was absent. The AppImage is untouched
  (the error precedes the rename), so N-1 keeps running.
- Callers: `_e2e-updater-linux.yml:51` (release lane, `ubuntu-latest`) and
  `smoke-updater-unix.yml` (dispatch-only ephemeral lane, matrix `ubuntu-latest`) both run
  `updater-smoke-linux.sh`. `ephemeral-updater.sh` only builds, stamps and signs; it launches
  nothing.
- The 1.2.2-rc.1 Linux binary was built on ubuntu-26.04 (job 122437783820). Its newest glibc
  symbol is `GLIBC_2.39` (`objdump -T` on the `.deb`'s `usr/bin/Presto`, never executed), so it
  still runs on 24.04; pinning the smoke to 24.04 is technically possible.

## The audit failure (verified)

- PR #190's run 40582228314 (job 122464350007) and `bun run audit:dependencies` on this base
  today both print the same five lines and `5 blocked, 12 accepted`, exit 1:
  `GHSA-4w7w-5xrc-9h26 undici`; `GHSA-2m5v-pch6-74hx undici` and `(npm 11.21.1 bundle)`;
  `GHSA-qrxm-fqhp-jwvm undici` and `(npm 11.21.1 bundle)`. All three published 2026-10-27
  19:02Z, severity high.
- Ranges (GitHub advisory API): 4w7w `>=7.0.0 <7.30.1`, `>=8.0.0 <8.12.2`; 2m5v and qrxm
  `<6.29.1`, `>=7.0.0 <7.30.1`, `>=8.0.0 <8.12.2`. Fixed in 6.29.1 / 7.30.1, the same versions as
  the accepted GHSA-xjj6-f33q-929c.
- Copies: `bun.lock` has `undici@6.29.1` (root and `npm/undici`), `cheerio/undici` 7.30.1 and
  `miniflare/undici` 7.29.1 (`miniflare@5.20261012.1-beta`, exact pin, from `wrangler@4.151.1`).
  npm 11.21.1's installed bundle carries undici 6.29.0. So only miniflare's copy and npm's bundle
  are affected, and 4w7w misses the 6.x bundle.
- Allowlist schema: one `ecosystem`, `id`, `package` per entry; key `ecosystem:id:package`; a
  duplicate key is INVALID; one entry covers every copy and every source of its package. `STALE`
  prints when an entry matched no blocking finding and does not change the exit code.
- Removal path (out of scope here): `wrangler@4.154.0` (2026-10-27T17:06Z) pins
  `miniflare@5.20261023.1-beta`, which pins undici 7.30.1; it clears the 7-day gate on 2026-11-03.
  npm 11.21.1 is the newest 11.x; npm 12.2.1 is `latest`.
- Miniflare's bundle (`dist/src/index.js`) has no undici `Agent` with a `tls` function option
  (its `checkServerIdentity` is Hyperdrive's own `tls.connect`) and no cache interceptor. Its
  three `Pool`s target local endpoints through `connect` (`:120067`, `:135002`, `:135019`), but it
  also fetches `https://workers.cloudflare.com/cf.json` through undici's global dispatcher
  (`:78691`), so a hostile TLS 1.2 endpoint there could crash the tooling process (qrxm).

## Open work

`gh issue list --state open`: none. Closed `known-limit` issues on the updater (#122, #124-#126,
#128) and on the audit (#187) do not cover either failure; no issue mentions the AppImage cache
directory.

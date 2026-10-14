# Phase 1: rustls 0.23.46

## The red audit

On #105, `Dependency Audit` (job 115949892900, 2026-10-14) reported "12 blocked, 13 accepted". The
12 are RUSTSEC-2026-0346, -0347, -0348 and -0349 against `rustls` 0.23.45, once in each of the
three Cargo locks. RustSec assigned all four ids on 2026-10-14, in advisory-db `caee11f41f`. Each
entry has `patched = [">= 0.23.46"]`.

## The bump

`cargo update -p rustls@0.23.45 --precise 0.23.46` was run in each crate. In every lock it changed
only the `rustls` version line and its checksum line, and the three diffs are identical. So this is
one commit.

## Provenance gate (crate published the same day)

Two maintainers share releases. crates.io records `ctz` as the publisher of 0.23.46
(2026-10-14T09:54:15Z) and of 0.23.45 (2026-09-14). `djc` published 0.23.44. None of these use
trusted publishing. `ctz` also published the GitHub release v/0.23.46, at 09:51:22Z. The crate was
about six hours old when this plan opened.

1. **Checksums.** I downloaded both `.crate` files from static.crates.io. Each hashes to its lock
   checksum:
   - 0.23.45: `0d41d731…d634`;
   - 0.23.46: `48e13bd8…8fdf`.
2. **Crate vs tag `v/0.23.46`.** The crate's `.cargo_vcs_info.json` names `f04804fa13` at path
   `rustls`, which is the commit the lightweight tag points at. I diffed the crate against the tag's
   `rustls/`, excluding `Cargo.toml`, `Cargo.toml.orig`, `.cargo_vcs_info.json` and `Cargo.lock`:
   - no source difference;
   - `Cargo.toml.orig` is byte-identical to the tag's `rustls/Cargo.toml`;
   - the crate has `README.md`, byte-identical to the tag's root README (copied through `readme`);
   - the tag has `tests/` and `src/testdata/`, which the manifest excludes from the package.
3. **Delta, 0.23.45 crate → 0.23.46 crate.**
   - Files: 21 `src/` files, plus the version line in `Cargo.toml` and `Cargo.toml.orig`, plus the
     packaged `Cargo.lock`. This is the same file set as upstream's `v/0.23.45...v/0.23.46` compare
     under `rustls/src/`.
   - No manifest dependency, feature or `build.rs` change.
   - The packaged `Cargo.lock` moves `itertools` from 0.10.5 to 0.13.0, which arrives through
     `bindgen`. cargo ignores a dependency's lock, so this reaches none of Presto's three locks.
   - The added lines contain no `unsafe`, process, environment, filesystem, network,
     `include_bytes` or FFI use.
4. **Upstream review.** The compare is 29 commits. Each one belongs to a `rel-0.23` PR approved by
   the other maintainer:

   | PR | Commits | Content | Author | Approved by | Merged by |
   |---|---|---|---|---|---|
   | #3337 | 5 | LimitedCache capacity | 6d7770 | ctz, djc | djc |
   | #3339 | 1 | bogo only, not in the crate | ctz | djc | |
   | #3354 "Prepare 0.23.46" | 22 | the backport batch and the version bump | djc | ctz | |
   | #3355 | 1 | the KX-hint fix | ctz | djc | |

5. **What the delta is.** The release notes name every change:
   - **The four advisory fixes:**
     - -0346 → #3299 (`dcdb9464d3`, `6d0ba089d6`);
     - -0347 → #3300 (`2bd5c0cefa`, `4de14a508f`);
     - -0348 → #3297 (`1aa987af37`);
     - -0349 → #3355 (`f04804fa13`).
   - **Five more PRs from the same 13-finding disclosure, with no RustSec id yet:** #3312, #3332,
     #3333, #3340 and #3342.
   - **Four hardening PRs:** #3294, #3295, #3318 and #3325.
   - **Also:** #3337 and the version bump.

**Verdict.** The delta is more than the four advisory fixes, and every line of it is explained. The
director accepted 0.23.46 on that basis. The rule's intent is "no unexplained code", and the trace
meets it. No smaller release is fixed.

**Exposure.**
- -0348 cannot reach Presto. `rustls` has no `brotli` or `brotli-decompressor` dependency in any of
  the three locks, so the built-in decompressor is off.
- -0349's hint-writing code runs in the reqwest clients. `cargo tree -e features -i rustls` shows
  no `prefer-post-quantum` in any of the three builds, so X25519 is already the first key share. A
  downgrade would also need a later connection sharing that client's session store.
- -0346 needs a custom `ClientSessionStore` that formats values with `Debug`.
- -0347 needs `EchMode::Enable`.

## Gates

These ran on the bump commit, before `main` was merged in. Everything was green:
- `bun run audit:dependencies` with cargo-audit 0.22.2: "0 blocked, 13 accepted, 31 moderate/low
  reported, 8 RustSec informational warnings";
- `cargo test --locked` for core, server and src-tauri: 562 passed, 0 failed, 11 ignored;
- `bun run lint:clippy` and `cargo check --target x86_64-pc-windows-gnu --lib`: no warnings;
- `bun install --frozen-lockfile`, `bun run test`, `bun run lint`, `bun run lint:actions` and the
  four TS builds.

# Phase 1: core pin, label gate, inspection, test run

## Status (2026-10-15)

- Steps 1, 2 and 4 are done. Step 3 (`custom_bb` in `DeveloperSettings`) and the second half of
  T6 (a full config keeps its origins; turning developer mode off clears the record) wait until the
  RC-channel developer-mode arc reaches `main` (A4). T6's tolerance half runs today on a stand-in
  struct with the same `#[serde(default, deserialize_with = "de_custom_bb")]` field.
- Gate, all exit 0 on Linux x86_64:
  - `cargo test --locked --manifest-path packages/presto/core/Cargo.toml`: 409 passed (15 `custom_bb`);
  - `bun run lint:clippy`;
  - `bun run lint`;
  - `bun run lint:actions`;
  - the Windows cross-check: `cargo check --locked --target x86_64-pc-windows-gnu --lib --bins` from
    `src-tauri`, plus `--tests` on core.

## Assumptions checked

- **I2:** the release `bb --version` (bb.js 6.0.0-rc.6, `amd64-linux`) prints `6.0.0-rc.6` and
  exits 0, so the suggestion parser takes it as the label.
- **I3:** the `arm64-macos` bb in the same package has `LC_CODE_SIGNATURE`, with CodeDirectory flags
  `0x0`. That means a certificate signature, not ad hoc or linker-signed. This was read by parsing
  the Mach-O here, because `codesign` runs only on the macOS lane. The dev sidecar is that same file.

## Mutation check (accept-everything stubs, each restored after)

| Stub | Tests that fail |
|---|---|
| path policy returns `Ok` | writable file and folder; POSIX ACL |
| `verify_file` returns `Ok` | the canonical-path test; writable; ACL; changed bytes before a test run |
| test permit always granted | busy prover |
| format check returns `Ok` | inspection |
| label gate skips the presto-noir rule | label gate; malformed-record load |
| test run skips the rehash | changed bytes before a test run |

## Deviation from the plan's D7 mechanics (principle unchanged)

- **The file:** it may be group-writable through the user's private group, as an ancestor may. A
  private group reaches no other account. Under Debian's `umask 002`, every rebuild is `0775`, so
  the plan's stricter file rule would refuse every rebuild.
- **Sticky folders:** a sticky folder is exempt from group write as well as world write. Read
  literally, the plan refuses `/tmp` (`root:root 1777`), because gid 0 is not a private group.
- The pure mode table in `path_policy.rs` pins both rules. Group write through a shared group stays
  refused, for files and folders.

## Notes

- The Linux ACL test writes `system.posix_acl_access` directly with `lsetxattr`, because this host
  has no `setfacl`. The named-user write entry is masked to `r-x`, so only the ACL rule refuses it.
  It ran here; it did not skip.
- macOS code cannot compile on this host: `aws-lc-sys` needs a Darwin C toolchain. The `libc`
  bindings it uses (`getxattr`, `XATTR_NOFOLLOW`, `ENOTSUP`, `getpwuid_r`, `getgrgid_r`) were
  checked against the libc 0.2.189 source. The first real compile is the new macOS step in
  `presto.yml`'s Cert Trust job.
- `bb.rs`: `run_bb` is now a spawn followed by `supervise`, and the version probe reuses
  `supervise`. Containment registration, the kill-tree path and the drains still exist once. The
  probe pipes stdout, because the prove path leaves it inherited.
- `frontend:build` must run once before any `src-tauri` cargo command in a fresh worktree, and empty
  `binaries/bb-<triple>` placeholders satisfy the sidecar check. Both are gitignored.

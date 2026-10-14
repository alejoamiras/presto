# Phase 7: store and fetch (core)

## Shipped

- `core/src/verified_sites/store.rs`: `ListStore { load, save_if_newer }`. `load` reads the cache
  without a lock through a mirrored capped `O_NONBLOCK` reader (regular files only, at most the
  96 KiB document cap) and verifies it under the pinned key. `save_if_newer` takes the sibling
  `.json.lock` for at most 1 s, re-reads and re-verifies the disk under it, and answers `Saved`,
  `DiskNewer(list)`, `Equivocation` or `WriteFailed(io::Error)`; an unreadable or unverifiable file
  protects nothing and is replaced through `write_private_atomic` (0600 in 0700). `path: None` is
  the memory-only store WebDriver builds use.
- `core/src/verified_sites/fetch.rs`: `Feed { url, key, timeout, https_only }`,
  `Feed::production(key)` (the constant HTTPS URL, 30 s, `https_only`), and `fetch_document`:
  no redirects, 10 s connect, the feed's total timeout (which bounds the body too), `User-Agent:
  presto`, 200 only, an early `Content-Length` refusal and a running byte count, no retries.
- Tests live inline in each file. The fetch tests use an ephemeral-port `TcpListener` server that
  records request heads; each case runs under an outer 5 s deadline.

## Decisions

- **A FIFO at the cache path is replaced, not a failed save.** The plan's case 19 says a FIFO or a
  directory fails the save. `rename(2)` replaces a FIFO like any other file on Linux and macOS, and
  that heals the cache; only a directory makes the save fail. The tests pin that split.
- **The forged-cache test uses list 5 signed by TEST 2**, not a TEST 2 list at version 2^53 − 1: no
  such fixture exists, and adding one means editing PR 1's generator. List 5's exact bytes under the
  wrong key still discriminate: trusting the forgery would make the fetched list 5 a no-op and leave
  the forgery on disk, and the test asserts the disk holds the legitimate envelope afterwards.
- **"Unwritable store directory" uses a regular file where the directory should be**, which fails on
  every OS and as root; a `chmod` would not stop root, and `write_private_atomic` re-chmods the
  parent anyway.

## Gate (2026-10-13)

- `cargo test --locked --manifest-path packages/presto/core/Cargo.toml`: 392 + 5 pass, 4 ignored.
- `cargo clippy --locked --manifest-path packages/presto/core/Cargo.toml --all-targets -- -D warnings`:
  clean.
- Windows cross-check: `cargo check --target x86_64-pc-windows-gnu --all-targets` for core: clean
  apart from a pre-existing `unused_mut` in `update_schedule/tests.rs` (untouched file).
- `bun run test`, `bun run lint:actions`: pass (after `cargo fmt` on the two new files).
- Mutations, each failing its test, then reverted (byte-compared):
  - remove the byte counter → `a_chunked_body_is_counted_up_to_the_cap` fails;
  - save without re-reading → `the_disk_never_moves_backwards` and
    `a_different_list_at_the_stored_version_is_equivocation` fail;
  - drop the `Content-Length` check → `an_advertised_oversized_body_is_refused_before_reading_it`
    fails;
  - load without verifying → `a_forged_file_is_refused_and_replaced` fails.

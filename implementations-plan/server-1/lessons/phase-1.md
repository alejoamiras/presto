# Phase 1: `download_failed` carries a coarse cause

- The regression test fails against forwarding: with `download_failed` temporarily returning
  `ProveFailed(format!("…{error}"))` (the old behaviour), `a_failed_download_tells_the_site_its_step_and_never_the_error`
  panicked at its `!text.contains(&path)` assertion; restored, it passes.
- Gated live run, 2026-10-25: `PRESTO_DOWNLOAD_TEST=1 cargo test --locked --manifest-path packages/presto/core/Cargo.toml -- an_unpublished_release_is_reported_as_not_found --nocapture`
  printed `test versions::downloader::tests::an_unpublished_release_is_reported_as_not_found ... ok` (0.25 s): GitHub answered 404, filed as `ReleaseNotFound`.

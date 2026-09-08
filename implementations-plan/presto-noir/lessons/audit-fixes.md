
## Step 3c — F-003 (`fix/bb-download-budget`)

Design choices:
- **Digest first.** `download_bb` fetches the GitHub release digest before the tarball; once the
  unauthenticated API is rate-limited the request fails in one small round trip instead of after
  streaming 64 MiB it will discard.
- **Budget = serial lock + two sliding windows.** `versions::DownloadBudget` lives on
  `HeadlessState`. `download_if_needed` takes the lock, re-checks the cache (a request that waited
  for the same version spends nothing), then spends one token per actual download attempt — success
  or failure — against a per-origin bucket (3 per 10 min; origin-less callers share one) and a
  global bucket (6 per 10 min, so `--allow-all` origin rotation is bounded too). Over budget →
  `429 download_budget_exhausted`, which the SDK already classifies as `transient` → WASM.
- **Activity marks only at execution.** `verify_cached_bb` is now side-effect free;
  `take_cached_bb` (used by `find_bb` on the execution path) writes `.last-used`. A malformed
  request can no longer keep a version "recently active" and exempt from the size cap; only a proof
  that reaches bb can, and that costs a real serialized proof. With downloads budgeted, the
  over-cap excess is bounded, so I did not add a re-arming cleanup loop (a perpetual sleeping task
  for a case the budget already bounds).
- Not done: moving `decode_and_check` before `acquire_prover` — the current ordering is deliberate
  (`plan.md:135`) and the budget makes it safe.

### Codex loop (session `01a082d3-b42e-7881-b44b-95d09214cf5d`, GPT-6 Astra, high)

**Round 1** — "request changes: churn is bounded, but the cache-cap bypass remains material."
- Medium (accepted): `find_bb` marked the version active before bb ran, so a body bb rejects at
  once still refreshed residency for free. The mark now happens only after `run_bb` succeeds, under
  the lease; the deferred size-cap pass repeats up to an hour while entries stay active or held.
- Low (accepted): between `resolve_version`'s verification and the lease, an eviction can complete;
  the lease then succeeds on an absent entry and the job dies later as `500 prove_failed`. Now an
  existence check under the lease answers `503 version_evicting`.
- Low (accepted): the server test depended on the real `~/.presto` cache and raced the cache-layout
  test's process-global `PRESTO_HOME`. Added `ScopedPrestoHome` (private temp home, restored on
  drop) and `#[serial]` on every reader/writer; pinned the "a waiter spends nothing" claim.
- Comment nits accepted. Codex confirmed: tokens are spent before any network on both routes, no
  cross-origin token theft or window reset, no lock cycle, refusal precedes the Downloading status
  and releases admission seats, digest-first keeps the sidecar path and fail-closed behaviour,
  429 → SDK `transient` is right.

**Round 2** — "download protection looks sound; the lease-race fix and test isolation remain
incomplete." Two Lows accepted: the post-lease existence check skipped a request whose version was
installed by another request's download (`needs_download` describes the initial resolution), so
it now runs for every non-bundled version; two unannotated tests (`resolve_version_flags_uncached
_for_download`, `version_bb_path_format`) read the cache root without `#[serial]` and could race
the private `PRESTO_HOME` — both serialized, the former on its own private home. Comment on the
deferred-cleanup loop corrected: the passes bound retry duration, not residency.

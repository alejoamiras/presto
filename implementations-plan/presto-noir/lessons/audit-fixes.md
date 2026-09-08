
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

# release-2 phase 0: consults

## Codex round 1 (plan audit), 2026-10-28

gpt-6.1-sol at high, read-only, fresh session. Verdict: conditional approve (correct the exposure
evidence, qualify the desktop assumption, specify a precise cache/test invariant).

- Medium, accepted: recon said miniflare's only undici `Pool` targets the local dev origin. It has
  three local `Pool`s and also fetches `https://workers.cloudflare.com/cf.json` through undici's
  global dispatcher (verified: `dist/src/index.js:78691`). Recon and Security corrected; the
  acceptance stands, since the traced worst case (qrxm) is a crash of local tooling.
- Low, rejected: use a literal `$HOME/.cache` because `${XDG_CACHE_HOME:-$HOME/.cache}` differs
  from `dirs::cache_dir` for a relative value (verified: dirs 6.0.0 drops non-absolute values).
  The XDG spec calls a relative value invalid, while the literal differs for a valid absolute
  one; the XDG form has the smaller mismatch.
- Medium, accepted: "every desktop home has a cache dir" was unproven. Reworded; the known limit
  states a demonstrated path with unverified prevalence, not unsupported conditions.
- Low, accepted: anchor the contract test on the executable `mkdir` line before the `source` of
  the modes file, not on five launch-function names.
- Low, accepted: trim duplication (192 lines over a 150 target).

## Codex final fresh pass, 2026-10-28

gpt-6.1-sol at high, read-only, new session with the plan and its audit ledger. Verdict: approve.
Applied: the expiry caps the waiver, not the exposure; the contract test asserts both lines exist
before comparing their order. Upheld: D2's rejection of the literal `$HOME/.cache`, the known
limit (demonstrated path, unknown prevalence, upstream fix), the qrxm residual risk, and 2m5v and
4w7w needing conditions miniflare and node-gyp do not create.

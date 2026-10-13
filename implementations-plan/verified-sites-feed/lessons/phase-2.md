# Phase 2: `sign` command, provisioning and round trip

## Shipped

- `scripts/verified-sites-signer.ts` gained the `sign` and `pubkey` commands. `sign` checks the seed
  against the pinned `key.pub`, the list against `--expect-sha256` and the 64 KiB cap before signing,
  self-verifies both signatures, and prints only `version`, `sha256` and `key_id`.
- `scripts/provision-verified-sites-key.ts` and its keyed-run template
  `verified-sites/signing-key.env.example` (`# op: generate hex32` for the seed, `# op: import` for the
  provisioning token). The script reads both variables once and deletes them from its own environment,
  hands `gh` only `PATH`, `HOME` and `GH_TOKEN`, and passes the seed on standard input. It refuses a
  published RFC 8032 key and the updater key, checks the environment (required reviewer, no admin
  bypass, exactly `branch:main`) before anything is stored, and confirms the secret is listed after.
- Unknown exceptions print "unexpected failure", never their message: a parse error from elsewhere
  could quote its input.

## Gate (2026-10-08)

- `bun test` on the signer and provisioning tests: 9 pass. `bun run --cwd packages/presto typecheck`:
  clean. `bun run test`: exit 0.
- Round trip: `sign` with the RFC 8032 TEST 1 seed reproduces `list-5.json.minisig` byte for byte;
  the CLI's `document` then `verify --expect-sha256 --expect-version 5` accepts it, and `verify` under
  `test2.pub` refuses it ("signed by a different key").
- Mutation: printing `Buffer.from(seed).toString("base64")` after the key document fails the leak test,
  before and after the test's refactor. Reverted.

## Bitten

- A signer test meant to run with the seed absent passed `undefined`, which a default parameter
  replaced with the real test seed, so the test exercised the wrong case. A `null` sentinel now means
  "absent".
- The stub `gh` sees only what the script hands it, so its responses live under the stub's `$HOME`
  rather than in variables the test sets.

## Codex review (2026-10-08)

Six findings, all accepted (R1–R6 in the plan's audit verdicts); each fix has a test that fails
against the old behaviour, checked by mutation (a second reviewer accepted, a malformed updater key
returning an empty key, `GH_HOST` dropped).

- **`bun --config /dev/null <script>` (and `-c /dev/null`) exits 0 without running the script.**
  Only the `=` form (`--config=/dev/null`) works; Codex confirmed it and found `--env-file`, `--cwd`,
  `--preload` and `--tsconfig-override` take a spaced value safely. A signing step written the other way would "succeed" and sign nothing.
  `--no-env-file --config=/dev/null` together block both a bunfig preload and `.env` loading
  (checked with a throwaway preload and `.env`).
- A duplicate `const` in the script failed at load time with Bun printing the offending source lines
  to stderr, outside the script's own error handling. Harmless here (no secret in source), but a load
  error is the one path that bypasses the fixed-message rule; typecheck catches it first.

## Owner steps

- O1 done on 2026-10-09 with the owner's `gh`; the read-back matched the plan (reviewer
  `alejoamiras` only, self-review allowed, no admin bypass, `main` only, no secrets).
- O1b declined on 2026-10-13, so its four-403 verification never ran. Agents keep the owner's token;
  the approval gap is accepted without that mitigation (decision ledger). The provisioning script and
  template are unchanged from their reviewed revision: `git diff 6599d42 HEAD` over both, and over the
  signer, is empty.

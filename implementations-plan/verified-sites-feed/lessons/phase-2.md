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

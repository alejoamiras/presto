# Phase 0 (arc 0)

- **Reserved host.** The plan named `updater-smoke.invalid`. RFC 6761 §6.4 lets resolver APIs
  answer `.invalid` with NXDOMAIN before reading the hosts file, so a smoke's hosts line could stop
  working on some platform. Switched to `updater-smoke.test` (§6.2: not special-cased); recorded as
  D23 after the director accepted it.
- **Production-key assertion.** The contract test stubs the Tauri CLI to record the key each `sign`
  call receives and checks all four payloads of a prerelease are signed with it. Mutation: skipping
  one payload's signature fails one test; reverting the guard and host fails three.
- **Real round trip.** `S/release-signer-roundtrip.sh` runs the real signer with `bunx tauri signer
  generate` keys in a temp repo root (symlinked `node_modules/.bin/tauri`, jq-stamped pubkey).
  Passes locally; runs in `presto.yml`'s `updater-feed-e2e`.
- **Shellcheck.** Clean on 0.11 and on `koalaman/shellcheck:v0.9.0` (CI's version).
- **Dispatches.** `updater-feed-e2e` and the ephemeral `positive` runs need the branch on origin,
  which waits for 1.2.0 to publish.

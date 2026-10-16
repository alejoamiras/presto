# Phase 3: envelope and admission (core)

- Steps 1–3 landed in b275a55. There is a second schema, `presto-update-manifest-rc-v1`.
  `verify_manifest` returns its kind and refuses an rc-v1 envelope whose version has no prerelease
  part. The envelope builder takes the kind and refuses the same mismatch. `admits` and `Refusal`
  live in `core/src/update_channel.rs`.
- The fixtures under `core/tests/fixtures/updater/rc/` are signed with a second throwaway key; only
  its pubkey is committed. `candidate-stable-version.json` is the rc-v1-without-prerelease case.
- Mutations, each red on its test (rerun after merging arc 1's head, 4f17ca7):
  - admit `(Stable, Candidate)` fails `update_channel::tests::admission_table`;
  - admit a v1 prerelease fails `admission_table`;
  - dropping the rc-v1 ⇒ prerelease check at verify fails
    `update_manifest::tests::signed_candidate_for_a_stable_version_rejected`.
- Steps 4–6 (the `update-manifest` tool's modes, the `updater-feed-e2e` round trip and
  `sign-smoke-feed.sh`) waited for arc 0, because they extend its round trip. Arc 0 reached this
  branch through the arc 1 merge.
- **Step 4: the `update-manifest` tool.**
  - `envelope --schema v1|rc-v1` defaults to the version's schema.
  - `verify` takes exactly one of `--channel stable|rc` or `--smoke`. No mode, both modes or an
    unknown channel is a usage error (exit 2); a refusal exits 1 with its reason; the kind is
    printed.
  - Callers now pass a mode:
    - `--channel stable`: both release-presto calls (promote pre-flight, live-feed check), the
      signer's production feed, and CI's happy path.
    - `--smoke`: the signer's smoke twins and the ephemeral feed.
  - The CI tamper check now requires exit 1 with `OuterMismatch("version")`, so a usage error
    can't pass for a refusal.
- **Step 5: the round trip.** It runs the committed fixtures through every mode, plus the three
  usage errors. It runs every signed output through its modes: the stable `latest.json` passes both
  channels and fails `--smoke` on its host, and the prerelease's v1 twins pass `--smoke` and fail
  both channels with `PrereleaseNotCandidate`.
- **Step 6: `sign-smoke-feed.sh`.** It derives the schema from the version, ignoring build metadata,
  and accepts an explicit `--schema v1|rc-v1`. The contract test runs it against a stub `bunx`.
- **Contract pins.**
  - `--smoke` appears only in `make_smoke_feed`, in the ephemeral `feed()` and in the round trip.
  - Both release verify calls name `--channel stable`.
  - The stubbed signer records each envelope's schema and each verify's mode.
- **Mutations, all red:**
  - smoke twin verified as stable;
  - production feed verified as smoke;
  - the smoke signer always using v1;
  - the live feed verified as smoke;
  - the tool's `--smoke` skipping the host check (round trip);
  - the tool's `--channel` skipping admission (round trip).

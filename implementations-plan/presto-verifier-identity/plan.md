---
plan: presto-verifier-identity
tier: light
driver: claude-code
eli5_mode: off
code_review: off
codex_model: sol
explainer: off
status: approved 2026-10-14 (director, decision A)
created: 2026-10-14
worktree: .claude/worktrees/presto-verifier-identity
branch: worktree-presto-verifier-identity
base: main @ 6835714
---

## Summary

The verifier binds a provenance statement to its signing identity. Before any claim in an SLSA
statement is used, the Sigstore bundle that carries it is verified against an explicit identity
policy:
- the GitHub Actions issuer;
- the signing workflow;
- the top-level workflow;
- the repository and its owner, by URI and by immutable ID;
- the ref;
- the runner environment;
- the source commit.

The statement's own claims must then agree with the certificate. Every consumer that trusts
registry bytes inherits this property:
- the release plan;
- promotion;
- the production playground build;
- the verifier CLI, which re-points the interop fixture by hand;
- `_publish-npm.yml`'s `verify` job.

The OIDC-holding `publish` job keeps registry-consistency checks only. See "Where third-party code
may run" below.

## Library: `@sigstore/verify`'s policy

The verification uses `@sigstore/verify` directly:
- `Verifier`, with a `VerificationPolicy` whose `oids` values are `Buffer`s;
- trust material from `@sigstore/tuf`'s `getTrustedRoot`;
- `@sigstore/bundle`'s `bundleFromJSON`.

The certificate is never parsed by hand. The glue mirrors `sigstore.createVerifier` line for line.
The umbrella `sigstore` package is not used, for three reasons:
- Its `certificateOIDs` option takes string values and applies `Buffer.from(value)`. Fulcio's v2
  extensions are DER `UTF8String`s, so a matching string would have to smuggle the DER tag and
  length bytes. That works only while every value stays under 128 bytes.
- It drags `@sigstore/sign` into a verify-only path.
- `@sigstore/verify` lets the thresholds be explicit.

Two library facts shape the policy:
- **The SAN is a regular expression.** `@sigstore/verify` matches it with `String.prototype.match`,
  which is unanchored. So the policy passes an anchored `RegExp` built from the escaped exact URI.
- **OIDs compare raw bytes.** Each is compared byte for byte against the extension's encoded value.
  So each expected value is encoded as a DER `UTF8String` (`0x0c`, a short length, then the bytes),
  and a value of 128 bytes or more throws rather than encoding.

**Dependencies.** All are root `devDependencies`, exact-pinned, and older than the 7-day gate:

| Package | Version | Published |
|---|---|---|
| `@sigstore/verify` | 4.1.2 | 2026-08-04 |
| `@sigstore/tuf` | 5.0.0 | 2026-06-01 |
| `@sigstore/bundle` | 5.0.0 | 2026-06-01 |
| `@sigstore/mock` | 0.13.0 | 2026-06-01; tests only |
| `@sigstore/protobuf-specs` | 0.5.2 | 2026-08-21; tests only, the version the three above already resolve |

All are maintained by `bdehamer` in sigstore-js. Root `devDependencies` are what CI, the release
and Workers Builds install (`bun install --frozen-lockfile`).

## Identity policy

The expected values are read from the certificates of every publication on npm, across all four
packages. The repository and owner IDs are cross-checked against GitHub's API.

| Field | Expected |
|---|---|
| SAN (anchored) and OID 1.3.6.1.4.1.57264.1.9 (build signer URI) | `https://github.com/alejoamiras/presto/.github/workflows/_publish-npm.yml@refs/heads/main` |
| Issuer (`extensions.issuer`, from .1.8 or .1.1) | `https://token.actions.githubusercontent.com` |
| .1.11 runner environment | `github-hosted` |
| .1.12 source repository URI | `https://github.com/alejoamiras/presto` |
| .1.13 source repository digest, and .1.19 build config digest | the commit (see below) |
| .1.14 source repository ref | `refs/heads/main` |
| .1.15 source repository identifier | `1357428613` |
| .1.17 source repository owner identifier | `2982991` |
| .1.18 build config URI | `https://github.com/alejoamiras/presto/.github/workflows/release-sdk.yml@refs/heads/main` |

**The commit.**
- When the caller passes `expectedCommit`, that is the expected value.
- Otherwise the policy uses the commit the statement claims, read only to choose the value. The
  verification then requires the certificate to carry exactly that commit, so a statement can never
  name a commit its certificate does not.
- After verification, the statement's own claims must equal the certificate's:
  - `workflow.repository` must equal .1.12;
  - `workflow.path` must equal .1.18's path;
  - `workflow.ref` must equal .1.14;
  - the resolved commit must equal .1.13.

**Signers.**
- `release-sdk.yml` is signed through `_publish-npm.yml`.
- The rollback path (`promote-sdk-latest.ts` with `rollback`) also accepts `_publish-sdk.yml`. That
  workflow was the reusable signer before #22 renamed it, and presto 5.2.0 is the only publication
  it signed.
- `publish-testnet.yml` (`LEGACY_SDK_RELEASE_WORKFLOW`) signed no publication on npm for any of the
  four packages. It gets no identity, so a statement naming it fails closed.

**Verifier options.** `tlogThreshold: 1` and `ctlogThreshold: 1`, stated explicitly; these are the
library defaults. The trusted root is Sigstore public-good through TUF. That is the same network
path npm's own `audit signatures` already takes in every environment that runs the verifier.

**Order.** The full bundle is verified before any claim is trusted.
- The only value read beforehand is the claimed commit, used solely to choose the policy's commit.
  It is taken from the same envelope payload bytes that are verified and later decoded.
- `verifyProvenanceStatement` keeps its claim checks and also receives the verified identity.

**Where third-party code may run.** Decision: A (director, 2026-10-14). B is filed at close-out, after
the merge, as an `owner-decision` issue. `_publish-npm.yml`'s `publish` job holds
`id-token: write` and installs no dependencies, so every CLI it runs imports only repository modules
and runtime built-ins. Importing the `@sigstore/*` packages into those modules would run third-party
code beside the OIDC identity, however the packages got installed. Two ways keep it out:

- **A (recommended): bind identity at every consumer; keep the publish job dependency-free.**
  - The identity policy and `verifySigningIdentity` go in a new module,
    `scripts/provenance-identity.ts`.
  - `verifySdkPackageSignatures` binds identity by default, and its CLI does too.
  - The publish job keeps its two consistency checks on registry claims. Its comment says that
    those checks are registry consistency, not identity.
  - Those checks move to a small `scripts/registry-consistency.ts`, which imports no dependency. The
    CLI the publish job runs is that module; the identity-bound verifier is never invoked there.
  - The `verify` job (no OIDC, `contents: read`) gains checkout, `setup-bun`,
    `bun install --frozen-lockfile --ignore-scripts`, and the identity-bound
    `verify-sdk-package-signatures.ts`. A publication whose signing identity does not bind fails the
    release run right after publishing.
  - Every consumer that trusts registry bytes binds identity: `release-plan.ts`,
    `promote-sdk-latest.ts`, `published-playground.ts` and the verifier CLI.
  - A contract test asserts that the publish job never runs the identity-bound CLI, and that every
    consumer imports the bound function.
- **B: move tagging out of the OIDC job.** A new `tag` job (no OIDC, `contents: write`) installs
  with `--ignore-scripts`, runs the identity-bound verification, then creates the tag and the
  release. The `publish` job loses `contents: write`. This is stronger least privilege, but it
  restructures the release pipeline, and no dry run exercises that before the next real release.

## Scope

| # | Commit | Change |
|---|---|---|
| 1 | `build(deps)` | The three `@sigstore/*` runtime packages, and `@sigstore/mock` with `@sigstore/protobuf-specs` for tests. The lock diff adds only their subtree. |
| 2 | `feat(release)` | Under option A: `scripts/provenance-identity.ts` holds the identity policy and `verifySigningIdentity(bundle, expectation, trust?)`. `trust` is injectable for tests; production uses TUF. `verifySdkPackageSignatures` binds identity. The publish job's checks move to the dependency-free `registry-consistency.ts`, and the `verify` job runs the bound CLI. |
| 3 | `test(release)` | The tests below. |
| 4 | `docs(ci)` | Rewrite the comment at `.github/workflows/_e2e-packaged.yml:254-255` to say what the step does. |

**Out of scope:**
- the payload claim checks that already exist, apart from the identity cross-check;
- the npm signature audit step;
- removing `LEGACY_SDK_RELEASE_WORKFLOW`.

## Tests

They are in `scripts/provenance-identity.test.ts` and `scripts/__fixtures__/`.

1. **A mock Sigstore world.** It is built with `@sigstore/mock`'s v1 primitives:
   - a CA with a CT log, so the leaf certificate carries an SCT;
   - the v1 tlog `log()`, fed a correctly built `dsse` entry, whose inclusion promise goes into a
     v0.1 bundle (the mock's `logV2()` emits no promise and a random proof, so it is not used);
   - a trusted root assembled from those keys.

   The production thresholds stay as they are, and the real v0.3 bundles (2 and 3 below) cover
   production bundle compatibility. A leaf key signs a DSSE statement whose claims are exactly ours.
   - **Positive control:** a leaf certificate with our identity passes. This proves the mock world
     is complete.
   - **Table test:** each row mutates exactly one pinned field, and must fail with `PolicyError`.
     There is one row per field, including the SAN and .1.9 independently, and .1.13 and .1.19
     independently.
   - **Entry points:** both bundle-consuming entry points get the passing control and a
     foreign-identity bundle. The entry points are the audit-report path and the injected-bundle
     path that `verifySdkPackageSignatures` uses.
   - **Tampering:** a payload changed after signing, another signer's certificate, a second envelope
     signature, a log entry with another integrated time and another signature's log entry are each
     refused by the cryptographic checks, never as a `PolicyError`, with the release and the
     rollback signers alike.
2. **Real publications, offline.** These use a committed snapshot of the public-good trusted root
   and real `npm audit signatures` reports:
   - presto 6.0.0-rc.3 and presto-core 1.2.1 must pass, at their own commits, and rc.3 fails at
     any other;
   - presto 5.2.0, signed by `_publish-sdk.yml`, must pass with the rollback allowance and fail
     without it, through both entry points.

   The committed presto-core 1.0.0 report is trimmed to its statement payloads, so it covers claim
   extraction only.
3. **Live.** `describe.skipIf(!process.env.PRESTO_LIVE_PROVENANCE)` runs `verifySdkPackageSignatures`
   against npm and TUF for presto 6.0.0-rc.3 and core 1.2.1.
4. **Contract (option A).** In `scripts/sdk-release-contract.test.ts`:
   - `publish` runs `registry-consistency.ts` before the publication records and never the bound CLI.
   - The `verify` job runs the bound CLI after a frozen, script-free install with no restored
     package cache, keeping `--package`, the version and `$GITHUB_SHA`. Its failure fails the
     reusable workflow, which blocks the later publications and the pin update.
   - Bun runs only repository script files in `publish`, and those import, transitively, only
     repository modules and runtime built-ins. This is checked on the import graph, which also
     refuses computed imports, `require` and spawned interpreters or package runners.
   - Every consumer named above imports the bound function.

## Gates

- `bun install --frozen-lockfile`, `bun run test`, `bun run lint`, `bun run lint:actions`;
- `bun scripts/verify-sdk-package-signatures.ts` passes for:
  - `--package presto 6.0.0-rc.3 b842a53…`;
  - `5.2.0-revision.5`;
  - `--package presto-core 1.2.1`;
  - `--package presto-noir 2.0.0-rc.2`;
  - `--package presto-banners 1.2.0`.

  The same check with a wrong expected commit fails.

## Security & Adversarial Considerations

- **Pinned identity fields:** the issuer (.1.8), the SAN and build signer URI (.1.9), the runner
  environment (.1.11), the repository URI (.1.12), digest (.1.13), ref (.1.14), the immutable
  repository and owner IDs (.1.15, .1.17), so a renamed or recreated repository with the same URI
  does not match, and the build config URI and digest (.1.18, .1.19).
- **Not pinned:** the build signer digest (.1.10), owner URI (.1.16), trigger (.1.20), run invocation
  URI (.1.21) and visibility (.1.22). The signer is a reusable workflow called from the same commit
  that .1.19 pins, `release-sdk.yml` is dispatch-only, and the owner ID binds the owner.
- **The verifier runs locked bytes.** The `verify` job installs from the registry against
  `bun.lock` with no restored cache, so no file saved by a job that ran dependency code reaches it.
- **The SAN is anchored and escaped.** It is never a bare string pattern.
- **The commit is bound in both directions:** the certificate's commit equals the statement's, and
  the expected commit when one is given.
- **One source of bytes.** Claims come only from the payload of the bundle that was verified.
- **New dependencies** sit in the verification path, so each is exact-pinned and past the 7-day
  gate.
- **Committed text describes the property only.**

## Post-implementation

Run `/codex high` on `gpt-6.1-sol`. The ask is the completeness of the identity policy and any
bypass: regex, encoding, threshold, order, or source of the statement. Stop at 3 rounds. Then open
the PR, run `gh pr checks --watch`, and send `DONE presto-verifier-identity: <PR url>; CI <state>`.

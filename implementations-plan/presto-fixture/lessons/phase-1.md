# Phase 1: re-point the interop fixture

## Before

On `main` @ cfe86f1, `bun scripts/install-legacy-sdk.ts` throws this:

```
@alejoamiras/presto@6.0.0-rc.3 targets Aztec 6.0.0-rc.3: point audit/fixtures/interop-sdk.json at it
```

This is the designed stale-fixture failure. The fixture's 6.0.0-rc.1 targets another Aztec version,
and npm now has a presto built for the workspace's version.

## Verification

1. **presto.** `bun scripts/verify-sdk-package-signatures.ts 6.0.0-rc.3 b842a53…` reported "verified
   registry signatures and SLSA provenance for @alejoamiras/presto@6.0.0-rc.3 (b842a53…,
   sha512-P++0W…YLA==)". b842a53 is the head of release run 38599643298 (Release SDK,
   `workflow_dispatch` on `main`). npm records publication at 2026-10-14T16:54:13Z.
2. **presto-core.** The published manifest pins presto-core 1.2.1. The verifier with
   `--package presto-core 1.2.1` reported commit bc3eeee and `sha512-AkDFA0…5Q==`. That is the
   publication the old fixture already named; this release reused it.
3. **Registry cross-check.** For both packages, `npm view <pkg>@<v> dist.integrity` equals the
   verified digest.
4. **Fixture writer.** A script, not part of the repo, ran the verifier and `npm view` for the SDK
   and each `@alejoamiras/*` dependency. It refused to write unless the two values agreed, and only
   then set `sdkVersion`, `sdkIntegrity` and `sdkDependencies`. No value was typed.
5. **Shape.** Importing the installed entry shows that `PrestoProver` is exported and that
   `checkPrestoStatus` is a prototype method. `dist/lib/presto-prover.d.ts` declares
   `presto?: PrestoConfig`. So the fixture's other three fields still hold.

## After

`bun scripts/install-legacy-sdk.ts` exits 0 and prints the extracted `package/dist/index.js`. The
dormant notice is gone, and the gate is awake.

## Gates

On 887b0c1, all green:
- `bun install --frozen-lockfile`;
- `bun run test`, with 0 failures in every suite;
- `bun run lint` and `bun run lint:actions`;
- the legacy step: exit 0, the entry printed, and no dormant notice.

The proof itself, `legacy-compatibility.test.ts`, needs a local Aztec network and a running server.
It runs in `sdk.yml`'s sandbox e2e, which the fixture path routes.

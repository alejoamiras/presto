# Phase 1: the SDK sends its bb.js version

Values stay at rc.1 in this phase, so the wire behaviour is unchanged.

## Change

- `packages/sdk/package.json` gains `"@aztec-foundation/bb.js": "6.0.0-rc.1"` in `dependencies`,
  the exact pin `@aztec-labs/bb-prover@6.0.0-rc.1` declares. `bun install` added no package; the
  lock gained only the workspace edge.
- `sdkAztecVersion()` became `sdkBbVersion()`, reading that pin. `index.ts` never exported it.
- `presto.packaged-e2e.spec.ts` compares `/health.aztec_version` with the SDK's bb.js pin, because
  that is what a release must bundle so a request never downloads. Moved here from phase 3: it is
  the same property.
- Docs: root `README.md` (versions section), `packages/sdk/{README,MIGRATION,AGENTS}.md`, and the
  shipped skill. `presto-core`'s `aztecVersion` doc comment still gives the stdlib pin as an example;
  core is unchanged by decision, so it is left for core's next release.

## Gate

- Drift test: `bb-prover`'s installed manifest exports no `./package.json`, so the test walks up
  from `Bun.resolveSync` to the manifest whose `name` matches. It checks two things: bb-prover's
  declared pin, and the version of the bb.js that resolves from bb-prover's directory.
- Mutation: SDK pin set to `6.0.0-rc.6` by hand → `the handshake version is the bb.js
  @aztec-labs/bb-prover pins and loads` failed (expected `6.0.0-rc.6`, received `6.0.0-rc.1`),
  13 pass / 1 fail. Restored → 14 pass.
- `bun run test`: exit 0 (lint, typecheck, every unit suite). The two biome warnings it prints
  (`docs-examples.test.ts:262`, `sdk-release-contract.test.ts:83`) predate this branch.
- `pack-candidate.ts --package presto --version 0.0.1-local`, then `sdk-tarball-consumer.sh` with
  the printed `--with` pair (presto-core): exit 0, "packed tarball resolves + typechecks;
  exact-host @aztec-labs/stdlib graph is a singleton". The packed manifest's dependencies include
  `"@aztec-foundation/bb.js": "6.0.0-rc.1"`.

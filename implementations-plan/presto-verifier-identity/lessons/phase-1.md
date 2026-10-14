# Phase 1: identity-bound verification

## Library behaviour that shaped the code

- `@sigstore/verify` matches the SAN with `String.prototype.match`: the policy passes an anchored,
  escaped `RegExp`. Removing the anchors makes the suffixed-SAN test row fail.
- `verifyOIDs` compares raw extension bytes, so expected values are DER `UTF8String`s.
- `@sigstore/mock` 0.13.0: the root certificate is valid from its creation, so the leaf and the log
  entry are dated a second or two later; its byte outputs are `ArrayBufferView`s, not `Uint8Array`s.
- `Bun.Transpiler.scanImports` drops type-only imports and reports only literal specifiers, so the
  isolation contract also refuses `require`, computed `import(...)` and spawned interpreters.

## Gates

- Live, against the registry and TUF: the bound CLI passes for presto 6.0.0-rc.3 and 5.2.0-revision.5,
  presto-core 1.2.1, presto-noir 2.0.0-rc.2 and presto-banners 1.2.0, at the tag commit and at the
  claimed commit; a mutated commit, signer, issuer, repository, repository ID, owner ID, ref, build
  config or runner is refused for each, through both entry points (70 checks).

## Foreign-reviewer consults

- Plan audit, GPT-6.1 Sol at `high`, 2 rounds: sound after the mock recipe, the per-field mutation
  table, the 5.2.0 fixture and the publish-job dependency boundary were folded in.
- Fix loop round 1, GPT-6.1 Sol at `high`: no identity-policy bypass found. Applied: the `verify`
  job installs with no restored package cache; the isolation contract refuses inline Bun, computed
  imports, `require` and spawned interpreters (each mutation-checked); tamper rows prove the
  cryptographic checks refuse altered payloads, certificates, signatures and log entries; presto
  5.2.0 runs through the report path; a complete presto-core 1.2.1 bundle replaces the trimmed
  core report as offline verification coverage; the plan describes the final state and the exact
  pinned fields. One finding outside this plan's scope went to the director.

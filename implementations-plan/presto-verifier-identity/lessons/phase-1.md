# Phase 1: identity-bound verification

## Library behaviour that shaped the code

- `@sigstore/verify` matches the SAN with `String.prototype.match`: the policy passes an anchored,
  escaped `RegExp`. Removing the anchors makes the suffixed-SAN test row fail.
- `verifyOIDs` compares raw extension bytes, so expected values are DER `UTF8String`s.
- `@sigstore/mock` 0.13.0: the root certificate is valid from its creation, so the leaf and the log
  entry are dated a second or two later; its byte outputs are `ArrayBufferView`s, not `Uint8Array`s.
- `Bun.Transpiler.scanImports` drops type-only imports and reports only literal specifiers, so the
  isolation contract also refuses `require`, non-literal `import(...)` and any subprocess other than
  npm reading the registry or installing without scripts.

## Gates

- Live, against the registry and TUF: the bound CLI passes for presto 6.0.0-rc.3 and 5.2.0-revision.5,
  presto-core 1.2.1, presto-noir 2.0.0-rc.2 and presto-banners 1.2.0, at the tag commit and at the
  claimed commit; a mutated commit, signer, issuer, repository, repository ID, owner ID, ref, build
  config or runner is refused for each, through both entry points (70 checks).

## Foreign-reviewer consults

- Plan audit: GPT-6.1 Sol at `high`, sound after 2 rounds.
- Fix loop: GPT-6.1 Sol at `high`; what it changed is in this branch's commits.

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

## Runtime

- Bun 1.4.0, the repository's `.bun-version`, has no default digest for EC keys:
  `crypto.verify(null, …)` throws `ERR_OSSL_EVP_NO_DEFAULT_DIGEST`. sigstore-js (SETs) and tuf-js
  (root metadata) verify that way and read the throw as a bad signature, so every verification fails
  closed. Node, OpenSSL and Bun 1.4.2 use SHA-256. `scripts/ec-default-digest.ts` supplies SHA-256
  for that case on such a runtime only.
- The first local gates ran on this machine's Bun 1.4.2 and missed it; CI caught it. Verification
  gates run under the pinned Bun.

## Gates

- Live, against the registry and TUF, under the pinned Bun 1.4.0: the bound CLI passes for presto
  6.0.0-rc.3 and 5.2.0-revision.5, presto-core 1.2.1, presto-noir 2.0.0-rc.2 and presto-banners
  1.2.0, at the tag commit and at the claimed commit; a mutated commit, signer, issuer, repository,
  repository ID, owner ID, ref, build config or runner is refused for each, through both entry
  points (70 checks).

## Foreign-reviewer consults

- Plan audit: GPT-6.1 Sol at `high`, sound after 2 rounds.
- Fix loop: GPT-6.1 Sol at `high`, 3 rounds; no identity-policy bypass found, and what it changed is
  in this branch's commits.

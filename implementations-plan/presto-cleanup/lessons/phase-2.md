# Phase 2 — dependency refresh and age policy

## Selection and policy

- Fixed the selection instant before editing manifests and checked the complete current Aztec graph
  before changing files.
- Bun's unconstrained Cargo refresh selected 27 crates inside the seven-day window. Each was pinned
  back to the newest eligible compatible release; the full resolved-entry check then passed.
- Removed both Aztec age exemptions. Automatic and explicit Aztec updates now validate every managed
  package and lockstep companion before their first write, and partial releases fail closed.
- The dependency-free checker compares resolved npm/Cargo identities including source and scans
  workflows plus composites. It uses registry publication timestamps and proves Action release tags
  resolve to the pinned commits. CI caches only successful checks under a content-addressed key.

## Compatibility fixes

- Wrangler 4.127.1 required regenerated Worker runtime types.
- rcgen 0.14 replaced the certificate-plus-key signing call with an `Issuer`; the CA key remains
  zeroized immediately after leaf signing. Certificate-chain and live TLS-handshake tests pass.
- Vite 8's native config loader requires `import.meta.dirname`; the existing Aztec dev-server
  resolver remains on the still-supported esbuild hook for behavioral compatibility.
- reqwest 0.13 moved HTTP TLS to rustls with platform verification, removing the headless Linux
  OpenSSL build dependency. This also supersedes Dependabot #11 by removing its package graph.
- quick-xml 0.41 removed two RustSec findings, so their stale audit exceptions were deleted.

## Validation

- `bun run test`: passed.
- `bun run lint:actions`: passed.
- `bun run audit:dependencies`: passed with no blocked findings or stale exceptions.
- The live seven-day sweep checked 94 npm and 215 Cargo resolved changes; all passed.
- SDK, playground, and landing production builds: passed.
- Core: 266 Rust tests passed. Server: 12 passed. Desktop: 134 passed, 7 prepared-platform tests
  ignored locally; certificate generation and real loopback TLS handshake passed.
- The same three Rust suites passed after moving the pinned compiler from 1.97.0 to eligible 1.98.0.
- `bun run bb:download 5.2.0` downloaded and verified the current Linux binary through the reqwest
  0.13 HTTPS path.
- Desktop compilation initially failed because rcgen 0.14 changed its issuer API. The focused API
  migration above compiled and passed the full desktop suite on the next attempt.

## Claude review — round 1

Verdict: conditional approve. The reviewer found two real policy gaps: the generated Aztec lockfile
check had no event base on manual dispatch, and the successful-result cache omitted nested workflow
files from its content hash. Both were fixed. It also identified Rust 1.98.0 as the newest eligible
toolchain, requested explicit documentation of reqwest's TLS-backend change and the unverifiable
`dtolnay/rust-toolchain` release model, and requested focused Cargo/Action edge-case tests. Those
changes were adopted without relaxing the seven-day policy.

Session: `60045700-6f8d-449e-a1a2-55dc57a423ca`.

## Claude review — round 2

Verdict: approve. Claude verified all eight round-one findings were closed and found no remaining
policy, security, behavioral, compression, or indirection issue. Two low-severity documentation
corrections were adopted: the AWS-LC/CMake native build dependency is now explicit, and the core
crate comment distinguishes `tokio-rustls` serving code from reqwest's headless rustls client.

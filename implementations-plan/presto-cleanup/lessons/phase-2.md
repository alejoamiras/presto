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
- quick-xml 0.41 removed two RustSec findings, so their stale audit exceptions were deleted.

## Validation

- `bun run test`: passed.
- `bun run lint:actions`: passed.
- `bun run audit:dependencies`: passed with no blocked findings or stale exceptions.
- SDK, playground, and landing production builds: passed.
- Core: 266 Rust tests passed. Server: 12 passed. Desktop: 133 passed, 7 prepared-platform tests
  ignored locally; certificate generation and real loopback TLS handshake passed.
- Desktop compilation initially failed because rcgen 0.14 changed its issuer API. The focused API
  migration above compiled and passed the full desktop suite on the next attempt.

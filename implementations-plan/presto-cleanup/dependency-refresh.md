# Dependency refresh evidence

Selection cutoff: `2026-08-31T15:16:24Z` (seven full days before the refresh). Publication age
came from the [npm registry](https://registry.npmjs.org/),
[crates.io](https://crates.io/api/), official Rust channel dates, and GitHub release timestamps.
Commit dates were not used as publication evidence.

## Selected direct versions

- JavaScript tooling: Biome 2.5.11, TypeScript 7.0.2, Vite 8.2.2 for the landing site,
  Vite 7.3.6 for the playground, Wrangler 4.127.1, lint-staged 17.4.1,
  sort-package-json 4.0.0, Node typings 24.13.3, and the existing Bun 1.4.0.
- Browser/test tooling: happy-dom 20.12.0, Tailwind 4.3.3, PostCSS 8.5.26,
  Autoprefixer 10.5.4, msgpackr 2.1.0, WebdriverIO 9.31.5 (spec reporter 9.31.2), and the
  existing Playwright 1.62.1.
- Runtime packages: LogTape 2.3.2 and Aztec standards 5.2.0, aligned with every managed Aztec
  package and the `@aztec/viem` npm alias.
- Rust: base64 0.23, which 8, tower-http 0.7, reqwest 0.13, uuid 1.26.0,
  tauri-plugin-updater 2.11, rcgen 0.14, and serial_test 4. All three independent lockfiles were
  regenerated and every newly resolved crates.io entry was age-checked.
- CI tools: Node 24.20.0, npm 12.0.2, cargo-audit 0.22.2, and Rust 1.98.0. Rust 1.98.0 was
  [released on 2026-08-20](https://blog.rust-lang.org/2026/08/20/Rust-1.98.0/), before the cutoff.
  The declared Rust requirement is 1.93.1 because serial_test 4.0.1 is the highest selected
  dependency MSRV.

The SHA-pinned Actions were already the newest eligible stable releases: checkout 7.0.1,
cache 6.1.0, setup-node 7.0.0, setup-bun 2.2.0, upload-artifact 7.0.1,
download-artifact 8.0.1, paths-filter 4.0.3, create-github-app-token 3.2.0,
rust-cache 2.9.2, and foundry-toolchain 1.9.1. Their release timestamps and exact
tag-to-commit relationships were checked; unchanged pins remain outside the stacked diff.
`dtolnay/rust-toolchain` publishes no GitHub Releases, so its unchanged SHA-pinned documented `v1`
ref cannot satisfy the release-timestamp policy. A future pin change will fail closed until the
upstream provides timestamped stable release evidence; no commit-date substitute or exemption was added.

## Withheld candidates and constraints

- Too young at the cutoff: Biome 2.5.12 (`2026-09-03`), happy-dom 20.14.0 (`2026-09-03`),
  LogTape 2.3.3 (`2026-09-04`), Playwright 1.63.0 (`2026-09-04`), Bun typings 1.4.1
  (`2026-09-04`), WebdriverIO 9.31.6 (`2026-09-06`), Autoprefixer 10.5.5 (`2026-09-04`),
  lint-staged 17.5.0 (`2026-09-05`), PostCSS 8.5.28 (`2026-09-03`), Wrangler 4.129.1
  (`2026-09-07`), and Rust 1.98.1 (`2026-09-01`).
- Node typings stay on the eligible Node 24 line rather than adopting Node 26 typings that exceed
  the supported runtime.
- Foundry stays at 1.4.1: Aztec 5.2's deployment wrapper passes a CLI combination rejected by
  Foundry 1.7 and later. The independently reviewed Windows bb checksum remains unchanged.
- Playground Vite 8.2.2 is withheld. Its Rolldown production build miscompiles the Aztec
  sqlite-opfs ordered-key path, which then calls `utf8Write` on an undefined target during browser
  initialization. The same dependency graph passes the existing production smoke on Vite 7.3.6;
  the landing site remains on Vite 8 because its smaller graph passes its production build.
- reqwest 0.13 replaces the OpenSSL/native-tls graph with rustls plus the platform verifier and
  native certificate roots. Rustls's AWS-LC provider adds `aws-lc-sys` and a CMake build dependency.
  Headless Linux CI therefore no longer installs `libssl-dev`; desktop jobs retain it as part of
  the existing Tauri system-dependency bundle. Existing Windows/macOS CI compilation is the
  prepared-platform validation for the native crypto backend.
- The stable Wrangler release depends on an alpha-labelled Miniflare build. That transitive is an
  upstream exact compatibility choice, not a direct prerelease selection, and its publication age
  is still enforced.

## Dependabot baseline

Open at implementation start: #8 (`tar 0.4.46`), #9 (`tauri 2.11.1`), #10 (`serde_with 3.22.0`),
and #11 (`openssl 0.10.81`). This refresh supersedes their dependency changes; #11 is superseded by
removing OpenSSL from all three resolved graphs. They should be marked superseded only after this
stacked dependency PR merges.

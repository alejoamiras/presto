# Repo Map — Two Areas

## AREA A — Playground Noir Panel (`packages/playground`)

### A.1 Module inventory

| File | Purpose | LOC |
|---|---|---|
| `packages/playground/src/noir.ts` | Noir fixture proving core: decodes the base64 fixture, owns the lazy `PrestoUltraHonkBackend` singleton, drives `proveNoirFixture()` called by the UI | 164 |
| `packages/playground/src/noir-stub.ts` | Dev-only fake `Barretenberg` that answers with fixture bytes instead of running WASM (backs `?noirStub=true`) | 26 |
| `packages/playground/src/main.ts` | App bootstrap/wiring: mode toggle, all button click handlers (`#noir-btn`, `#deploy-btn`, `#token-flow-btn`), `setActionButtonsDisabled`, `walletReady` flag, HTTP-consent modal, `init()` | 447 |
| `packages/playground/src/results.ts` | `showResult()` / `renderSteps()` — renders proof results into the DOM via `textContent`/`className`, never `innerHTML` | 175 |
| `packages/playground/src/ui.ts` | DOM helpers: `$`, `$btn`, `setStatus`, `appendLog`, `formatDuration`, clock | 78 |
| `packages/playground/index.html` | Static shell: services panel, mode toggle, actions (incl. `#noir-btn`), results panels (`#noir-results` etc.), log, HTTP-consent dialog | 295 |
| `packages/playground/vite.config.ts` | Dev/build config: `bbWorkerPlugin`, `sqliteWasmAssetsPlugin`, `noirFixturePlugin`, COOP/COEP dev headers, `resolve.dedupe` | 256 |
| `packages/playground/public/_headers` | Cloudflare Pages/Workers static headers (copied verbatim into `dist/_headers` at build) | 14 |
| `packages/playground/wrangler.jsonc` | Cloudflare Worker/Pages deployment config (assets-only SPA, custom domain `playground.presto.build`) | 12 |
| `packages/playground/e2e/noir.mocked.spec.ts` | Playwright, network-mocked: Presto success/mismatch/error/offline-fallback/local-mode-never-talks-to-presto | 208 |
| `packages/playground/e2e/noir.production-smoke.spec.ts` | Playwright against the **built** bundle: real bb.js WASM, `?noirStub=true` must be dead code in prod | 38 |
| `packages/playground/e2e/noir.smoke.spec.ts` | Playwright against the **dev server**: real WASM in-browser, and native Presto when `PRESTO_URL` is set | 58 |
| `packages/playground/src/noir.test.ts` (unrequested but load-bearing) | Bun unit tests for `noir.ts` (fixture decode, in-browser stub proving, native + fallback via mocked `fetch`) | 104 |
| `fixtures/noir/*` | Vendored/generated Noir fixture circuits consumed by `noirFixturePlugin` and the e2e specs (see §7) | — |

### A.2 Entrypoints

- **Page load**: `index.html` → `<script type="module" src="/src/main.ts">` → `init()` (main.ts:328) — installs diagnostics, wires every button, checks Aztec node + Presto status, then `initWallet()`.
- **User action**: click `#noir-btn` (main.ts:165-203) → `proveNoirFixture(state.uiMode, appendLog, onPhase)` (noir.ts:130) → `getNoirBackend()` (noir.ts:107) lazily builds one `PrestoUltraHonkBackend` per page load, seeded with the fixture's VK.
- **Dev-only test hook**: `configureNoir()` (noir.ts:95) lets `noir.test.ts` swap in a fixture/API source; resets the singleton `backend`.
- **Build-time virtual module**: `virtual:noir-fixture` (vite.config.ts:114-148) is the entrypoint every consumer of the committed fixture (`noir.ts:loadNoirFixture`, tests via `decodeNoirFixture`) goes through.

### A.3 Trust boundaries — untrusted inputs → sinks

| Untrusted input | Path | Validation | Sink |
|---|---|---|---|
| URL query params `noirStub`, `httpsOnly`, `forceProofs` | `window.location.search` (noir.ts:114, aztec.ts:111/211/224) | Strict `=== "true"` string match only; `noirStub` additionally gated by `import.meta.env.DEV` (noir.ts:119) so it is dead code in the production bundle (asserted by `noir.production-smoke.spec.ts`) | Boolean flags controlling backend construction (`httpsOnly`) and stub wiring (`noirStub`) — not reflected into the DOM |
| Presto HTTP response body (`proof`, `public_inputs` from `/prove/ultra-honk`) | Handled entirely inside `@alejoamiras/presto-noir`'s `PrestoUltraHonkBackend.generateProof()` (outside Area A's files) | The SDK adapter validates/decodes bytes; `noir.ts` only compares byte arrays (`matchesFixture`, `same`) — no string ever reaches the DOM from this path except the fixed literal `"differs from fixture"` / `"identical to fixture"` | `results.ts:showResult` sets `tagEl.textContent` — a **static string chosen by the app**, not attacker data |
| `err.message` from a failed proof (`main.ts:192`, `240`, `285`) | Caught exception, `err instanceof Error ? err.message : String(err)` | None beyond coercion to string | `appendLog(msg, "error")` (ui.ts:33) → `line.textContent = ...` — **always `textContent`, never `innerHTML`**, so even attacker-influenced error text can't inject markup |
| `appendLog`'s optional `url` param | Only ever passed by trusted call sites in this codebase (none in the Noir path currently) | N/A (not used by noir flow) | Builds an `<a>` element via `document.createElement`, sets `.href`/`.textContent` (not innerHTML); `rel="noopener noreferrer"` set explicitly (ui.ts:45-53) |
| Fixture bytes (`circuit.json`, `witness.gz`, `vk`, `proof`, `public_inputs`) | Committed repo files → `noirFixturePlugin.load()` (vite.config.ts:123-146) reads them from disk and base64-embeds them into a generated JS module at **build/dev-serve time** | `scripts/noir-fixture.ts --verify` (run in CI, see Area B overlap) checks sha256/size/field-count against `manifest.json` before the files are trusted at all; no runtime validation in the plugin itself (it trusts the filesystem) | `decodeNoirFixture()` (noir.ts:46) → typed `Uint8Array`s fed to the backend — never rendered as text |
| bb.js Worker/WASM traffic redirect (`bbWorkerPlugin`) | Incoming dev-server request `req.url` (vite.config.ts:59-74) | Matches only exact basenames from a fixed allow-list built from `require.resolve()` at server start (`workerFiles`), using `Object.hasOwn` to dodge prototype-pollution basenames like `"constructor"` | Rewrites `req.url` to an absolute `/@fs/<resolved-path>` — dev-server only, not present in the production build |

No CSP header is set anywhere (`public/_headers`, `dist/_headers`, `vite.config.ts` dev/preview headers) — confirmed by an explicit grep for `Content-Security-Policy` across `packages/playground` returning no hits. The only defense-in-depth headers are COOP/COEP (for cross-origin isolation, required by bb.js's threaded WASM workers), `X-Content-Type-Options: nosniff`, and `Referrer-Policy: strict-origin-when-cross-origin` (`packages/playground/public/_headers:1-5`).

### A.4 Dependency graph (one level)

- `src/noir.ts` → `@alejoamiras/presto` (types only), `@alejoamiras/presto-noir` (`PrestoUltraHonkBackend`, `ProofData`, `VerifierTarget`, `BarretenbergSource`), `./aztec` (types), dynamic `@aztec/bb.js` (browser Barretenberg), dynamic `./noir-stub` (dev only), dynamic `virtual:noir-fixture` (vite virtual module).
- `src/noir-stub.ts` → `@aztec/bb.js` (type only), `./noir` (type only).
- `src/main.ts` → `./aztec`, `./diagnostics`, `./noir`, `./presto-status`, `./results`, `./spark-orbit`, `./ui`, `./version`.
- `src/results.ts` → `./aztec` (types), `./phase-queue` (types), `./ui`.
- `src/ui.ts` → `./diagnostics`.
- `vite.config.ts` → `vite-plugin-node-polyfills`, resolves `@aztec/bb-prover`/`@aztec/bb.js`/`@aztec/kv-store`/`@aztec/sqlite3mc-wasm` paths via `node:module`'s `createRequire`, reads `../sdk/package.json` for `@aztec/stdlib` version, reads `../../fixtures/noir/square/*`.
- `index.html` → `/src/main.ts`, Google Fonts (`fonts.googleapis.com`, `fonts.gstatic.com`), external anchors to `presto.build` and `github.com` (not fetched by JS).

### A.5 Frameworks

- **Vite 7** (build/dev server) + `vite-plugin-node-polyfills` (Buffer/path shims for the Aztec/bb.js stack).
- **Tailwind CSS 4** (`@tailwindcss/postcss`) + PostCSS/autoprefixer for `style.css`.
- **TypeScript 7** (`tsc --noEmit` across `tsconfig.json` / `tsconfig.tests.json` / `tsconfig.e2e.json`).
- **Bun test** for unit tests (`bun test`), with `@happy-dom/global-registrator` for DOM shims.
- **Playwright 1.62** for e2e (`@playwright/test`), driven by `playwright.config.ts` (`mocked`, `smoke`, `local-network` projects — see `packages/playground/playwright.config.ts`, not in the requested file list but the runner behind all three noir specs).
- **Cloudflare Workers/Pages** (via `wrangler`) as the deploy target — `wrangler.jsonc` ships `dist/` as a single-page-application asset bundle.
- Runtime deps: `@aztec/aztec.js` family 5.2.0, `@aztec/bb.js` 5.2.0 (bb.js WASM, deduped with `@aztec/bb-prover` via `resolve.dedupe`), `@alejoamiras/presto` / `@alejoamiras/presto-noir` (workspace SDK packages).

### A.6 Test surfaces

- **Unit** (Bun): `src/noir.test.ts` — fixture decode/round-trip, in-browser stub proving, native proving + offline fallback via a mocked `globalThis.fetch`.
- **E2E — mocked** (`e2e/noir.mocked.spec.ts`, Playwright project `mocked`): fully network-mocked; asserts the exact HTTP job sent to Presto (`bytecode`/`witness`/`verifier_target`/`vk`), asserts WASM/CRS/worker traffic is **forbidden and recorded empty** (`forbidWasmTraffic`), and covers: success, tampered-proof (`differs from fixture`), 500 error, offline fallback, and "local mode never talks to Presto".
- **E2E — production smoke** (`e2e/noir.production-smoke.spec.ts`): runs against the built bundle with `?noirStub=true` but asserts real WASM traffic occurs anyway (proves the stub is dead code once built) and `crossOriginIsolated === true`.
- **E2E — dev-server smoke** (`e2e/noir.smoke.spec.ts`): real bb.js WASM in Chromium against the dev server; second `describe` block skips unless `PRESTO_URL` is set, then proves natively and asserts no fallback occurred.
- Query params exercised across these specs: `noirStub=true` (mocked + smoke specs use it to avoid real WASM or force it dead in prod), no test exercises `httpsOnly`/`forceProofs` from within the noir specs specifically (those are exercised by `demo.*` specs and `aztec.ts`).

### A.7 Generated / vendored / fixture code

- `fixtures/noir/square/*` and `fixtures/noir/nopub/*` — committed Noir circuit source (`Nargo.toml`, `Prover.toml`, `src/main.nr`), compiled/executed artifacts (`target/*.json`, `target/*.gz`), and the bb.js-WASM-generated reference outputs (`vk`, `proof`, `public_inputs`, `witness.gz`) plus `manifest.json` (sha256/size/field-count/toolchain record). Regenerated only by `bun scripts/noir-fixture.ts --regenerate` on a dev box with `aztec-nargo`; verified in CI by `--verify` (default). The playground never reads these files directly — `noirFixturePlugin` (vite.config.ts) inlines them as base64 into the `virtual:noir-fixture` module at build/serve time.
- `packages/playground/dist/*` — build output (gitignored normally, but present in this worktree): `dist/_headers` (identical to `public/_headers`), `dist/index.html`, minified bundled JS (including huge inlined Aztec circuit ABIs — not hand-written, purely generated).
- `node_modules/` — third-party, untouched.

---

## AREA B — npm release path for `@alejoamiras/presto-core` and `@alejoamiras/presto-noir`

### B.1 Module inventory

| File | Purpose | LOC |
|---|---|---|
| `scripts/npm-packages.ts` | Single source of truth: the 3-entry `NPM_PACKAGES` registry (`presto`, `presto-core`, `presto-noir`), version-mode regexes, `EXACT_SEMVER`, `--package` arg parsing, `readManifest`/`workspaceDependencies` | 155 |
| `scripts/release-plan.ts` | Pure planning DAG (`planRelease`) + fact-gathering CLI (`npm view`, `git ls-remote`, `gh release view`, lockfile diffing) that decides publish/reuse/collision per package before anything is published | 420 |
| `scripts/pack-candidate.ts` | Packs one package + its `workspace:` deps in dependency order using `preparePublishManifest`, for bootstrap-mode CI/tarball testing | 144 |
| `scripts/prepare-sdk-publish.ts` | Pure manifest rewrite (`preparePublishManifest`): dist-based `exports`/`main`/`types`, exact-pins `workspace:` ranges | 130 |
| `scripts/get-sdk-publish-version.ts` | Computes the version string to publish per package's `versionMode` (`aztec-derived` revision-suffixing vs `manifest` exact-once) | 113 |
| `scripts/sdk-release-verification.ts` | Fetches + cryptographically verifies npm SLSA provenance (subject, workflow repo/path/ref, resolved git commit) for a published version | 152 |
| `scripts/verify-sdk-package-signatures.ts` | Fresh `npm install` in a temp dir + `npm audit signatures --include-attestations`, asserts a verified provenance attestation exists | 81 |
| `scripts/promote-sdk-latest.ts` | Interactive/CLI promotion of a verified `testnet`-tagged version to `latest` (or rollback), with a fresh-registry-state race check immediately before the mutating `npm dist-tag add` | 272 |
| `scripts/published-playground.ts` | Verifies the playground's exact published dependency graph (SDK/core/noir manifests + peer pins), then drives `.github/scripts/packaged-e2e-swap-sdk.sh` to install them | 190 |
| `scripts/npm-pack-result.ts` | Validates the shape of `npm pack --json` output (handles npm 11 array vs npm 12 record shape) | 37 |
| `scripts/sdk-tarball-consumer.sh` | Bash: installs a packed tarball as a fresh-`npm install` consumer, typechecks + runtime-loads against packed `dist`, and (for `aztec-derived` packages) asserts a singleton `@aztec/stdlib` graph | 121 |
| `scripts/tarball-consumer/host-manifest.ts` | Builds the consumer host's `package.json` (tarball `file:` dep, optional `@aztec/stdlib` pin, optional local `--with` tarball deps); rejects the tested package name appearing as an "extra" | 70 |
| `scripts/tarball-consumer/assert-local-dependency.ts` | Post-install: proves a `--with` dependency resolved to exactly the supplied tarball's SHA-512, via `node_modules/.package-lock.json` | 60 |
| `scripts/tarball-consumer/assert-singletons.ts` | Walks the consumer's `node_modules` tree to prove every declared peer (`host-dependencies.json`) is installed exactly once | 74 |
| `scripts/tarball-consumer/assert-core-pin.ts` | Asserts an SDK/adapter's `@alejoamiras/presto-core` dependency range matches the core actually installed beside it | 48 |
| `scripts/tarball-consumer/exact-pin.ts` | Extracts `@aztec/stdlib` pin from a tarball's `package.json` (via `tar -xzOf`); required exact for `aztec-derived` packages, optional for `manifest` packages | 58 |
| `scripts/tarball-consumer/{presto,presto-core,presto-noir}/{index.ts,runtime-check.mjs,tsconfig.json}` | Per-package consumer-profile fixtures: typechecked + runtime-loaded against the packed dist | small |
| `scripts/tarball-consumer/presto-noir/host-dependencies.json` | Declares the `@aztec/bb.js@5.2.0` peer the Noir consumer host must install as a singleton | 1 |
| `.github/scripts/packaged-e2e-swap-sdk.sh` | Swaps packed (or published) SDK/core/noir tarballs into `packages/playground/node_modules/...` in place, links workspace `node_modules` deps in, verifies resolution from the *consumer's* perspective | 169 |
| `.github/workflows/release-sdk.yml` | Top-level manual-dispatch release orchestrator: plan → e2e/dependency-audit → publish-core → noir-gates → publish-presto/publish-noir → deploy-app | 238 |
| `.github/workflows/_publish-npm.yml` | Reusable `workflow_call`: builds, packs, tarball-consumer-tests, `npm publish --provenance`, verifies registry+provenance, tags + creates a GitHub release, re-verifies with a fresh install | 251 |
| `.github/workflows/_ts-package-ci.yml` | Reusable PR-gate CI: lint, typecheck, unit tests, tarball-consumer, optional `identity`/`live`/`e2e_presto` jobs | 253 |
| `.github/workflows/sdk-noir.yml` | Per-package PR workflow: path-filtered, calls `_ts-package-ci.yml` with `identity: true, live: true` | 81 |
| `.github/workflows/sdk-core.yml` | Per-package PR workflow: path-filtered, calls `_ts-package-ci.yml` (no identity/live) | 70 |
| `.github/actions/start-headless-presto/action.yml` | Composite action: launches a built `presto-server` binary in the background with a private `PRESTO_HOME`, polls `/health`, outputs `pid`/`url` | 78 |
| `scripts/noir-fixture.ts` | Fixture lifecycle: `--verify` (CI default, sha256/size/field/bb.js-version cross-check against `manifest.json`) and `--regenerate` (dev box, drives `aztec-nargo` + bb.js WASM) | 342 |

### B.2 Entrypoints

- **CLI/dispatch**: `bun scripts/release-plan.ts --packages <key|all> [--dry-run]` (release-plan.ts:408-420) — the release's decision point, invoked by `release-sdk.yml`'s `plan` job.
- **`workflow_dispatch`**: `.github/workflows/release-sdk.yml` — human-triggered with inputs `mode` (`sdk-and-playground`/`sdk-only`/`playground-only`), `packages` (`presto`/`presto-core`/`presto-noir`/`all`), `dry_run`.
- **`workflow_call`**: `.github/workflows/_publish-npm.yml` (called per package from `release-sdk.yml`'s `publish-core`/`publish-presto`/`publish-noir` jobs) and `.github/workflows/_ts-package-ci.yml` (called from `sdk-noir.yml`, `sdk-core.yml`, `sdk.yml`, and `release-sdk.yml`'s `noir-gates`).
- **`pull_request`** (branches `main`, `security-hardening`): `sdk-noir.yml`, `sdk-core.yml` — path-filtered via `dorny/paths-filter`, run the shared PR-gate CI.
- **Manual CLI**: `bun run sdk:promote -- [--package <key>] <version> [--dry-run] [--rollback]` (root `package.json:29` → `promote-sdk-latest.ts:255`).
- **CI-only CLI**: `bun scripts/published-playground.ts [version]` — invoked from `release-sdk.yml`'s `deploy-app` job before building/deploying the playground Worker.
- **Shell entrypoint**: `bash scripts/sdk-tarball-consumer.sh <tarball> [package-key] [--with name=tarball ...]` — invoked from both `_publish-npm.yml` (post-pack) and `_ts-package-ci.yml`'s `tarball-consumer` job (post `pack-candidate.ts`).

### B.3 Trust boundaries — untrusted inputs → sinks

| Untrusted / external input | Path | Validation between | Sink |
|---|---|---|---|
| `${{ inputs.packages }}` / `${{ inputs.mode }}` / `${{ inputs.dry_run }}` (human `workflow_dispatch` choice inputs) | `release-sdk.yml:99-105` interpolated into `env.PACKAGES`/`DIST_TAG`/`DRY_RUN`, then into a `run:` bash array `args=(--packages "$PACKAGES")` | GitHub Actions `type: choice` restricts `packages`/`mode` to a fixed enum in the UI, but a raw API dispatch could send an arbitrary string; **the interpolation is via an `env:` var, not directly into the script body**, so it is not a shell-injection vector even for an off-enum string — `release-plan.ts`'s own `selectPackages`/`resolvePackage` reject anything not in `NPM_PACKAGES` | `bun scripts/release-plan.ts "${args[@]}"` — fails closed on `isPackageKey` |
| `${{ github.token }}` (`GH_TOKEN`) | `release-plan.ts` fact-gathering (`githubReleaseExists`), `_publish-npm.yml`'s tag-existence preflight and release creation | Scoped to the default `contents: read` at the job level except where jobs explicitly elevate to `contents: write`/`id-token: write` (publish jobs) | `gh release view`/`gh release create`, GitHub REST API calls (`curl` in `_publish-npm.yml:135-143`) |
| npm registry responses (`npm view ... --json`) | `release-plan.ts:npmViewJson/publishedVersions/publishedPins`, `promote-sdk-latest.ts:npmJson` | `JSON.parse` on trusted-format npm CLI output; no schema validation beyond TypeScript's optimistic casts (`as Record<string, unknown>` etc.) — a malformed/compromised registry response could in principle produce `undefined` fields that later throw, but nothing is executed from it | Feeds `planRelease` decisions (never a shell command) |
| npm provenance attestation JSON (fetched via `fetch(url)` from `dist.attestations.url`, itself obtained via `npm view`) | `sdk-release-verification.ts:fetchAndVerifySdkProvenance` (105-136) | `verifyProvenanceStatement` (58-103) requires: (1) subject name exactly `pkg:npm/<name>@<version>` and (2) subject digest equals the npm tarball's own reported SHA-512 integrity, (3) `workflow.repository === SDK_REPOSITORY` exactly, (4) `workflow.path` in an explicit allow-list (default `[release-sdk.yml]`), (5) `workflow.ref === "refs/heads/main"` exactly, (6) a resolved dependency whose `uri === SDK_SOURCE_DEPENDENCY` with a 40-hex-char `gitCommit`, optionally pinned to an `expectedCommit` | `VerifiedProvenance.commit/ref/repository/workflow` — consumed by `release-plan.ts`'s `releaseFacts` and `promote-sdk-latest.ts`'s `verifyPromotionCandidate`, gating whether a version may be *reused* or *promoted* |
| `${{ inputs.version }}` / `${{ inputs.dependency_versions }}` passed into `_publish-npm.yml` from `release-sdk.yml`'s `needs.plan.outputs.*` | `_publish-npm.yml:96-105` (`PLANNED` re-checked against a **freshly recomputed** `get-sdk-publish-version.ts` — "the registry moved since planning" guard), then `:145-156` interpolated as `IFS=',' read -ra pins <<< "$DEPENDENCY_VERSIONS"` building `--dep "$pin"` args | `dependency_versions` is producer-controlled (comes from `release-plan.ts`'s own `workflowOutputs`, format `name=version` — regex-unconstrained at this hop, but every `name`/`version` pair ultimately originated from `NPM_PACKAGES` entries and `EXACT_SEMVER`-validated versions upstream) — passed via `env:` then read into a bash array, not directly spliced into a command string, so it is not directly shell-injectable even though the values aren't re-validated at this exact line | `prepare-sdk-publish.ts <version> package.json --dep name=version...` → `preparePublishManifest`'s `rewriteWorkspaceRanges` re-validates every pin with `EXACT_SEMVER.test(pinned)` before writing it into `package.json` (prepare-sdk-publish.ts:70-73) |
| The published tarball itself (after `npm publish`) | `_publish-npm.yml:169-184` "Verify npm version, dist-tag, and provenance" retry loop, then `:187-190` "Cryptographically verify registry signatures and provenance" | `sdk-release-verification.ts` (provenance) **and** `verify-sdk-package-signatures.ts` (fresh install + `npm audit signatures --include-attestations`, `hasVerifiedSdkProvenance` requires `predicateType === "https://slsa.dev/provenance/v1"`) — both must pass before a git tag/GitHub release is created | `git tag` + `gh release create` (only after both verifications succeed) |
| `assert-local-dependency.ts` / `assert-singletons.ts` reading `node_modules/.package-lock.json` after `npm install` | Consumer-host install output (files on disk, not attacker-controlled in this trust model, but the *registry* content that `npm install` resolved is) | SHA-512 integrity comparison against the exact supplied tarball's own hash (`tarballIntegrity`, computed locally from the tarball bytes) — proves the installed copy came from *this* tarball, not a same-named registry substitute | Throws (`process.exit(1)`) on any mismatch or wrong install count |
| `promote-sdk-latest.ts`'s registry mutation (`npm dist-tag add ... latest`) | Human confirms via `prompt()` (line 197) after `verifyPromotionCandidate` (assert no active release runs, npm tag state, provenance, remote git tag == provenance commit, GitHub release tag match) | `assertFreshPromotionState` re-checks `dist-tags.latest`/`testnet` haven't moved and `assertNoActiveReleaseRuns` re-checks GH Actions state **immediately before** the single mutating call (narrowing, not eliminating, a TOCTOU race — explicitly documented as such in the comment at line 234-236) | `npm dist-tag add <pkg>@<version> latest`, then a **read-back** loop against `registry.npmjs.org` with a cache-busting query param, up to 10 attempts |
| `.github/scripts/packaged-e2e-swap-sdk.sh`'s tarball args (`$1`/`$2`/`$3`) | Either self-packed from workspace (`pack()` function) or supplied by `published-playground.ts` as provenance-and-signature-verified tarball paths | `test -f "${tarball}"` existence checks; `assert-core-pin.ts` after extraction; a final **consumer-side** resolution check (`Bun.resolveSync`) proving the playground actually resolves into the swapped directory, not silently falling back to the workspace source (explicitly called out at lines 96-99 as a regression that happened once) | Extracts (`tar -xzf --strip-components=1`) directly into `packages/playground/node_modules/@alejoamiras/{presto,presto-core,presto-noir}` |

### B.4 Dependency graph (one level)

- `npm-packages.ts` — leaf; imported by every other script here (the shared registry).
- `release-plan.ts` → `get-sdk-publish-version.ts` (`baseVersionFor`, `resolvePublishVersion`), `npm-packages.ts`, dynamic `sdk-release-verification.ts` + `verify-sdk-package-signatures.ts` (lazy-imported inside `releaseFacts`).
- `pack-candidate.ts` → `npm-packages.ts`, `prepare-sdk-publish.ts`.
- `prepare-sdk-publish.ts` → `npm-packages.ts` (`EXACT_SEMVER` only).
- `get-sdk-publish-version.ts` → `npm-packages.ts`.
- `sdk-release-verification.ts` → `npm-packages.ts`.
- `verify-sdk-package-signatures.ts` → `npm-packages.ts`.
- `promote-sdk-latest.ts` → `npm-packages.ts`, `sdk-release-verification.ts`, `verify-sdk-package-signatures.ts`.
- `published-playground.ts` → `npm-pack-result.ts`, `npm-packages.ts`, `sdk-release-verification.ts`, `verify-sdk-package-signatures.ts`, `tarball-consumer/assert-core-pin.ts`; shells out to `.github/scripts/packaged-e2e-swap-sdk.sh`.
- `sdk-tarball-consumer.sh` → `npm-packages.ts` (via inline `bun -e`), `tarball-consumer/{host-manifest,exact-pin,assert-local-dependency,assert-singletons}.ts`, plus the profile dirs `tarball-consumer/{presto,presto-core,presto-noir}/*`.
- `tarball-consumer/exact-pin.ts` → `npm-packages.ts`.
- `.github/scripts/packaged-e2e-swap-sdk.sh` → `tarball-consumer/assert-core-pin.ts`.
- `release-sdk.yml` → `_e2e.yml`, `dependency-audit.yml`, `_publish-npm.yml` (×3 calls), `_ts-package-ci.yml` (as `noir-gates`), `presto-release-readiness.ts` (assert-main job, not in the requested file list but gates the whole run).
- `_publish-npm.yml` → `scripts/get-sdk-publish-version.ts`, `scripts/prepare-sdk-publish.ts`, `scripts/sdk-tarball-consumer.sh`, `scripts/sdk-release-verification.ts`, `scripts/verify-sdk-package-signatures.ts`, `scripts/npm-packages.ts` (via inline `bun -e`).
- `_ts-package-ci.yml` → `scripts/pack-candidate.ts`, `scripts/sdk-tarball-consumer.sh`, `scripts/npm-packages.ts`, `.github/actions/setup-presto`, `.github/actions/start-headless-presto`.
- `sdk-noir.yml` / `sdk-core.yml` → `_ts-package-ci.yml` (`workflow_call`), `dorny/paths-filter`.
- `start-headless-presto/action.yml` — leaf composite action, no repo-script dependency; launches a caller-built binary directly.
- `noir-fixture.ts` → `packages/presto/scripts/copy-bb.ts` (`resolveAztecBb`), dynamically imports `@aztec/bb.js` resolved from `packages/sdk`'s `node_modules`.

### B.5 Frameworks / tooling

- **Bun** (`bun` CLI, `Bun.spawnSync`/`Bun.spawn`, `Bun.semver.order`, `Bun.file`, `Bun.resolveSync`) — the primary scripting runtime for all `scripts/*.ts`.
- **GitHub Actions** — reusable workflows (`workflow_call`), `workflow_dispatch`, `pull_request`; composite action (`start-headless-presto`).
- Third-party actions pinned by full commit SHA + version comment (consistent across every workflow read): `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1`, `oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0`, `actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0`, `actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0`, `dorny/paths-filter@ceb8a2b8f2d89434be7ff52d3de7ec3738c5cc9d # v4.0.3` (in the two per-package PR workflows), `actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1`.
- **npm CLI** — required ≥ `11.5.1` for OIDC trusted publishing (`_publish-npm.yml:61-68` hard-fails otherwise); `npm pack`, `npm publish --provenance --access public --tag <dist_tag> --workspaces=false`, `npm view`, `npm audit signatures --include-attestations`, `npm dist-tag add`, `npm ls`.
- **GitHub CLI (`gh`)** — `gh release view`/`gh release create`, `gh run list`.
- **`tar`** — extracting `package/package.json` from tarballs for pin inspection (`exact-pin.ts`, `published-playground.ts`) and installing packed SDKs in place (`packaged-e2e-swap-sdk.sh`).
- **git** — `git ls-remote --tags` (existence/commit lookups, never mutating except the one `git tag`+`git push origin "$tag"` in `_publish-npm.yml:202-205`), `git diff --quiet` (build-input-changed check), `git show <tag>:bun.lock`.
- **npm trusted publishing / OIDC** — `environment: npm-publish`, `permissions: id-token: write` set both at the reusable workflow's job level and re-declared by the calling jobs in `release-sdk.yml` (`publish-core`/`publish-presto`/`publish-noir`); **no `NODE_AUTH_TOKEN`/npm token secret is used anywhere** — publish authenticates purely via OIDC.
- **SLSA provenance / npm signature audit** — `https://slsa.dev/provenance/v1` predicate type checked explicitly in both `sdk-release-verification.ts` and `verify-sdk-package-signatures.ts`.

### B.6 Test surfaces

Nearly every script has a co-located `*.test.ts` (Bun test, run via `bun test` / the `unit-tests` job in `_ts-package-ci.yml` and the root `bun run test:scripts` + `bun run typecheck:scripts`):
`scripts/npm-packages.test.ts`, `release-plan.test.ts`, `pack-candidate.test.ts`, `prepare-sdk-publish.test.ts`, `get-sdk-publish-version.test.ts`, `sdk-release-verification.test.ts` (and the related `sdk-release-contract.test.ts`), `verify-sdk-package-signatures.test.ts`, `promote-sdk-latest.test.ts`, `published-playground.test.ts`, `npm-pack-result.test.ts`, `noir-fixture.test.ts`, and `scripts/tarball-consumer/{host-manifest,assert-local-dependency,assert-singletons,assert-core-pin,exact-pin}.test.ts`. There is also `scripts/action-pins.test.ts` (guards that third-party Action refs stay pinned by SHA) and `scripts/ts-package-ci.test.ts`.

**Integration/CI-level surfaces** (not unit tests, but exercised end-to-end by the workflows):
- `_ts-package-ci.yml`'s `tarball-consumer` job — packs the real candidate + workspace deps and runs `sdk-tarball-consumer.sh` against a genuine `npm install` on Node 24.
- `_ts-package-ci.yml`'s `identity` job (`test:identity`, gated by `inputs.identity`, run for `presto-noir`) — bb.js WASM must reproduce the committed `fixtures/noir/*` byte-for-byte.
- `_ts-package-ci.yml`'s `live` job (`test:e2e`, gated by `inputs.live`, run for `presto-noir`) — builds a real `presto-server` from the current ref, starts it headless via `start-headless-presto`, points the adapter's `test:e2e` at it via `PRESTO_URL`.
- `release-sdk.yml`'s `deploy-app` job runs `published-playground.ts` as an integration check on the **actual published** artifacts before deploying.
- `_publish-npm.yml`'s final two steps ("Verify npm version, dist-tag, and provenance" + "Verify release records and a fresh registry install") are themselves integration tests against the live npm registry, run inline in the publish job.

### B.7 Generated / vendored / fixture code

- `fixtures/noir/*` — see A.7; also directly gated in Area B by `scripts/noir-fixture.ts` (verify/regenerate) and by the `sdk-noir.yml` path filter (`fixtures/noir/**` triggers CI) and by `release-sdk.yml`'s `noir-gates` job (`_ts-package-ci.yml` with `identity: true`).
- `packages/sdk-core/dist/`, `packages/sdk-noir/dist/` — build output of `tsc` (`"build": "rm -rf dist && tsc"` in each package's `package.json`), what `prepare-sdk-publish.ts` repoints `main`/`types`/`exports` at; not committed, produced fresh by every packing step (`pack-candidate.ts`, `_publish-npm.yml`, `packaged-e2e-swap-sdk.sh`'s `pack()`).
- `scripts/tarball-consumer/{presto,presto-core,presto-noir}/*` — hand-written but effectively fixture/test-double code: minimal `index.ts` (typecheck surface), `runtime-check.mjs` (load surface), `tsconfig.json` per profile; `presto-noir/host-dependencies.json` is a small vendored-pin fixture (`{"@aztec/bb.js": "5.2.0"}`).
- `node_modules/` — third-party, untouched; `scripts/sdk-tarball-consumer.sh` and `assert-singletons.ts` specifically *audit* the shape of a consumer's freshly-installed `node_modules` tree as their core mechanism, but never modify vendored code, only ephemeral temp-directory installs (`mktemp -d`, cleaned via `trap ... EXIT`).

# Recon: lna-consent

Base: `main` at `8edbbca` (equals `origin/main`). Two read-only sweeps: (A) SDK, core, Noir adapter,
banners, docs, release; (B) playground, landing, E2E, CI. Findings below are what the plan builds on.

## Reuse map

| Capability needed | Existing code (or absence + search trail) | Verdict |
|---|---|---|
| Prompt-free read of the loopback permission, with the `loopback-network` → `local-network-access` name fallback | Three copies. `sdk-core/src/lib/presto-transport.ts:176-197` `isLoopbackPermissionExplicitlyDenied()` (private, denied-only boolean). `landing/src/presto-detection.ts:45-68` (returns the raw `PermissionStatus`, plus a denied-only wrapper). `playground/src/presto-status.ts:30-68` (query folded into the watcher). | **adapt**: one public `loopbackPermission()` in core; the transport's denied check delegates to it; landing copy is deleted; playground imports it. |
| Four-way permission state (`granted` / `prompt` / `denied` / `unsupported`) | Absent. `grep -rn "loopbackPermission" packages` → no hits; none of the three copies returns all four states. | **build new** (core). |
| Permission-change watcher | `landing/src/presto-detection.ts:71-91` and `playground/src/presto-status.ts:30-68`, near line-for-line duplicates (dedupe repeat states, swallow query errors, return unsubscribe). | **adapt**: export `watchLoopbackPermission()` from core; both copies go. |
| Barrel re-exports core → `presto` / `presto-noir` | `packages/sdk/src/index.ts`, `packages/sdk-noir/src/index.ts` re-export curated subsets of core (neither re-exports `PrestoClient`). | **adapt**: add the new names to all three barrels. |
| Export-list pinning | `packages/{sdk-core,sdk,sdk-noir}/src/lib/public-contract.test.ts` assert `typeof barrel.X` per runtime export and resolve type exports through typed consts; they do not fail on *unlisted* exports. | **adapt**: add assertions, or the new surface is unpinned. |
| Packed-tarball check | `scripts/pack-candidate.ts` + `scripts/sdk-tarball-consumer.sh` (the `Tarball Consumer` job in `_ts-package-ci.yml`). Typechecks + runtime-loads a fixed per-profile fixture; does not enumerate exports. `assert-core-pin.ts` accepts `workspace:*`. | **reuse-as-is** as a gate; no fixture change required. |
| Banner state machine | `banners/src/types.ts` (`BannerState`, `BANNER_STATES`, `BANNER_EVENTS`), `strings.ts` (`STRINGS`, `VARIANT_COPY`, `VARIANT_STATES`), `render.ts` (six templates), `element.ts` (`#update`, `#onClick`, `persistKey` = `<prefix>:<variant>:<state>`). Only Ribbon reads `STRINGS[state]`; the other five templates hard-code the install pitch. `ctaLink()` always renders a navigating `<a data-action="cta">`. | **adapt**: new state + copy + a non-navigating `data-action="connect"` button + `BANNER_EVENTS.connect`; five templates gain a state branch. Dismissal buckets come free. |
| `stateFromStatus` | `banners/src/status.ts` maps `PrestoStatusLike` → state. | **reuse-as-is**; `connect` is host-set (`banner.state = "connect"`), never derived from a status. |
| Consent dialog shell | `playground/index.html` `#http-session-confirmation` + `HttpSessionConsentController` (`presto-status.ts:260-313`, callback-driven, generic apart from hard-coded announce strings). The Escape/Tab trap (`main.ts:375-400`) is hard-wired to that element id, and `setPending` toggles both HTTP buttons together. | **adapt**: extract a per-dialog modal helper (trap, Escape, backdrop, focus return) and reuse the controller shape for the connect dialog. |
| Playground status view | `prestoStatusView(status)` (`presto-status.ts:71-161`) — single source of truth for label, log, panels, ribbon; only knows post-probe `PrestoStatus` arms. | **adapt**: wrap in a connection view that adds the pre-probe states and delegates to it for checked results. |
| Startup gate on `granted` | Absent: `init()` always calls `checkServices()` (`main.ts:431`). | **build new** (small). |
| Force-local proving | `setUiMode()` (`aztec.ts:307-310`), `PrestoProver.setForceLocal` (`presto-prover.ts:138-140`), `PrestoUltraHonkBackend.setForceLocal` (`presto-ultra-honk-backend.ts:177-179`); Noir path already follows `uiMode` (`noir.ts:141`). | **reuse-as-is**. Note: `setForceLocal` gates proving only, never `checkPrestoStatus()`. |
| "Connect Presto" link in Services | Absent: Services has only `#presto-cta` "Get Presto". | **build new**. |
| Landing detection | `landing/src/presto-detection.ts` (286 lines), its test (220), `main.ts:128-210`, `index.html` notice panels, CSS `.hero-sub.detected`, `.accel-dot`, `.notice*`, `.landing-permission-notice`, `.btn-outline` use there. `race.ts`, `feed.ts`: no loopback. | **delete**. |
| Real-LNA harness | `playwright.lna.config.ts` (Chromium `--ip-address-space-overrides`, serves landing + playground + `lna-health-server.ts`), `lna.real.spec.ts` (`context.grantPermissions(["local-network-access"])`, asserts the queried state). | **reuse** for the playground; delete its two landing tests and the landing web server. |
| Agent pointer file | Absent: `find . -iname AGENTS.md` → none; CLAUDE.md silent. `packages/sdk/package.json` `files` = `src, dist, .claude, MIGRATION.md`. | **build new** `packages/sdk/AGENTS.md`, add it to `files`. |

## Facts the plan leans on

- Nothing probes on construction: `PrestoProver`, `PrestoClient`, `PrestoTransport`, `EmbeddedWallet.create`
  (`splitPxeOptions` only threads the prover) and `PrestoUltraHonkBackend` (built lazily in the Noir click
  handler). The only pre-click loopback request today is `init()` → `checkServices()`.
- Other loopback paths are click-gated: deploy / token flow / Noir proofs in Presto mode, the fallback
  refresh, Retry, "Use HTTP". The permission watcher re-probes on *any* state change — including a reset
  to `prompt`, which would re-open the browser prompt unprompted.
- Production playground deploys only through `release-sdk.yml` `deploy-app`, which swaps in the
  **published** `presto` / `presto-core` / `presto-noir` (`scripts/published-playground.ts`). PR previews
  and `production-smoke` build from the workspace. A playground import of a new SDK export therefore
  needs that export on npm before the next production deploy.
- The presto SDK version is release-computed (`scripts/get-sdk-publish-version.ts`, aztec-derived);
  core, noir, banners are manifest-versioned at `1.1.0`. `workspace:*` pins need no lockstep edit.
- Root `bun run test` does not include `packages/landing`; `landing.yml` runs `bun run --cwd packages/landing test`.
- `app.yml` `chromium-lna-e2e` routes on `packages/landing/**` (line 55) among others.
- Doc strings pinned by `packages/sdk/src/lib/public-contract.test.ts` (README / MIGRATION / SKILL):
  `` `denied` ``, `PrestoHttpError`, `version-mismatch`, `permission-blocked`, `forceRefresh: true`,
  `secure-connection-unavailable`, `tls-or-trust-failure`, `httpsOnly: false`,
  `allowInsecureDowngrade: true`, and the absence of `Peer dependency` / `interface PrestoStatus {`.
  Banners has no doc-sync test.
- `packages/banners/README.md` Usage probes on load (`banner.status = await prover.checkPrestoStatus()`),
  and `docs/PLATFORM_SUPPORT.md:78` narrates "triggers the browser prompt on first use".
- User-facing playground copy says "loopback", "local access", "Presto detected on loopback"
  (`presto-status.ts:76-159`, `index.html` panels).

## Collision / dedup risks

1. Two dialogs sharing one hard-wired trap and one `setPending` would cross-wire; parameterize first.
2. Bolting pre-probe states on as loose booleans beside `prestoStatusView` would fork the view's single
   source of truth that both the mocked and the real-LNA specs assert against.
3. The watcher must not probe on `prompt`; otherwise a permission reset re-opens the prompt.
4. The five non-Ribbon banner templates must not route `connect` through `ctaLink()` (it navigates).
5. `setForceLocal` is not a probe kill switch; docs must not claim it is.
6. `isLoopbackPermissionDenied` (sentinel check) vs the new `loopbackPermission` (query): distinct names, keep them apart.
7. The Noir adapter ignores the page's HTTP-session consent (open follow-up); the connect flow must not
   claim to configure it.

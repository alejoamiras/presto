---
plan: lna-consent
tier: mid
driver: claude-code
eli5_mode: artifact
code_review: off
status: approved 2026-09-25 (A1–A4 resolved)
created: 2026-09-25
worktree: .claude/worktrees/lna-consent
branch: worktree-lna-consent
base: main @ 8edbbca
---

# lna-consent: ask before contacting Presto

## Summary

presto.build and the playground contact the local Presto app the moment they load, so Chrome and
Firefox show a Local Network Access prompt ("Access other apps and services on this device") before
the visitor has done anything. This plan removes that request from the landing entirely, makes the
playground ask through an explained dialog before its first request, gives integrators a
prompt-free permission helper and a `connect` banner state, and rewrites the SDK docs, examples and
agent skill so generated integrations ask first too.

User decisions already taken (design review artifact, 2026-09-25):

| # | Decision |
|---|---|
| D1 | Landing: option C. No loopback request on presto.build, ever. "Already installed?" links to the playground. |
| D2 | Playground: option C plus the Services-row link. The page starts in In-browser mode; choosing Presto (mode switch or "Connect Presto" in Services) opens an explainer; Continue makes the first request. |
| D3 | Retail-friendly copy: no `127.0.0.1`, "loopback" or "local network" jargon in user-facing strings. |
| D4 | Export a prompt-free permission helper from `presto-core`, re-exported by `presto` and `presto-noir`. |
| D5 | `<presto-banner>` gains an opt-in `connect` state on all six variants; the owner approves the visuals (ELI5 mockups at the approval gate; phase 3's gate compares the real component against them). |
| D6 | `packages/sdk/AGENTS.md` points non-Claude agents at the skill. |
| D7 | Validation: fast gates + tarball consumer on every phase; playground mocked E2E, the real-browser LNA suite, the local-network sandbox E2E, and a banners visual check where they apply. |
| D8 | `code_review: off`. Manifests of `presto-core`, `presto-noir`, `presto-banners` bump to `1.2.0`; the owner publishes. |

## Outcome & Quality Bar

**For whom.** (1) A first-time visitor to presto.build or the playground who knows enough to be wary
of a site asking to reach their computer. (2) A dApp developer, or the coding agent they use, wiring
Presto into their app from our README and skill.

**What excellent looks like.**

1. **No surprise prompt.** On every page load where the visitor has not already allowed access, zero
   requests to either Presto port leave the page, proven by a real-browser test that records requests
   at the page (the only witness for a request the browser holds) and counts them at the server. The
   landing makes none on any visit, whatever the permission says.
2. **The ask explains itself before the browser does.** Every surface that offers Connect tells the
   visitor, in plain words, that their browser may ask to let the site reach apps on this device;
   the dialog and the larger banners also say what the site uses it for and how to undo it. No
   `127.0.0.1`, no "loopback".
3. **Every state after the click is honest.** While a browser prompt may be open the UI says so (or,
   where the browser cannot report its answer, says it could not connect and to allow the prompt if
   one appeared), never a flat "Presto not found"; a Block shows how to undo it; a reset to "ask"
   starts no new request and discards results of any operation already running (the residuals are
   named in A3 and A4); a definitive answer from Presto (error, version, HTTPS trouble, blocked) is shown as
   such, never masked as "waiting"; returning visitors who allowed access connect with no extra click.
4. **Integrators get it right by default.** The README and skill examples, copied as-is, make no
   request before consent (proofs included), using the exported helpers; the banner kit has the
   explained button built in.

**Good enough.** The Noir adapter's missing HTTP-session consent (open follow-up) stays. No
SDK-enforced consent mode (see trade-offs). No abort for an SDK operation already in flight (A3).
Banner `connect` copy is fixed English, like every other banner state. Firefox and Safari behaviour
is covered by the fail-closed rule, not by a browser-specific test (the harness is Chromium).

## Scope

**In:** `presto-core` helpers + tests + re-exports + consumer fixtures; banner `connect` state on six
variants and a retail pass on the banner's `permission-blocked` copy; SDK README, SKILL.md,
AGENTS.md, banners README, sdk-noir README, root README (examples and pointers), `docs/PLATFORM_SUPPORT.md`, landing and
playground READMEs, CLAUDE.md "Current State"; landing detection removal; playground consent flow,
copy pass, native dialogs, and every E2E spec that selects Presto mode; version bumps.

**Out:** mobile-specific behaviour (hiding Connect on phones and tablets, where Presto cannot be
installed, is left to the separate mobile-aware-detection work; this plan already removes the
load-time probe that made Android Chrome prompt on both sites); publishing or deploying anything; an SDK-level consent mode or an abortable status check;
the Noir HTTP-consent gap; banner localisation; the desktop app; `app.yml` permission hardening
(follow-up).

## Architecture & Implementation

### Proposed architecture

- **`presto-core` owns the permission read and the watcher** (`src/lib/loopback-permission.ts`),
  reading `navigator.permissions` at call time. The transport's private denied check becomes a call
  into it. `presto` and `presto-noir` re-export both functions and the type. The landing copy is
  deleted (D1); the playground imports the helpers.
- **The banner kit gains a host-set pre-probe state.** `connect` is never derived from a
  `PrestoStatus` (`stateFromStatus` untouched). A host sets `banner.state = "connect"` when its read
  says `prompt` or `unsupported`, handles `presto-banner:connect`, runs its check and assigns the
  result.
- **The playground's `PrestoStatusController` becomes the single owner** of authorization, the
  connection phase and rendering. It already owns epochs, coalescing and forced refresh; it gains an
  `authorized` gate checked when any refresh starts *and again after it waits out an in-flight probe*,
  `revoke()` that bumps the epoch (dropping queued and stale results), and result classification. Its
  one `render` callback receives a `ConnectionPhase`; a pure `connectionView(phase)` beside
  `prestoStatusView` (which it wraps for checked results) is the single view source.
- **Both playground dialogs become native `<dialog>` elements** opened with `showModal()` (focus
  containment, inert background, Escape as `cancel`), like the banner Sheet. The hand-written Tab trap
  in `main.ts` goes. `HttpSessionConsentController` is generalised into a confirm-dialog controller
  with per-dialog messages and pending state, used by both.

### Key interfaces

```ts
// packages/sdk-core/src/lib/loopback-permission.ts — exported from all three SDK barrels
export type LoopbackPermissionState = "granted" | "prompt" | "denied" | "unsupported";

/**
 * This origin's stored decision for reaching the local Presto app (Chrome/Firefox Local Network
 * Access), read without prompting. `unsupported`: no Permissions API, neither descriptor
 * (`loopback-network`, then `local-network-access`) recognised, or the query failed — the browser
 * may or may not prompt on the first request. Never throws.
 */
export function loopbackPermission(): Promise<LoopbackPermissionState>;

/**
 * Calls `onChange` when the stored decision changes (a prompt answered after a check gave up, a
 * site-settings edit, or a decision made in another tab of the same site). Resolves to an
 * unsubscribe; a no-op one where changes cannot be observed. Never prompts, never probes.
 */
export function watchLoopbackPermission(
  onChange: (state: Exclude<LoopbackPermissionState, "unsupported">) => void,
): Promise<() => void>;
```

```ts
// packages/banners/src/types.ts, strings.ts
export type BannerState = /* existing seven */ | "connect";
BANNER_EVENTS.connect = "presto-banner:connect";
// PrimaryKind gains "connect"; STRINGS.connect; VARIANT_COPY.<variant>.connect;
// VARIANT_STATES: "connect" added to ribbon, billboard, dock, card, sheet (tile is "any").
```

```ts
// packages/playground/src/presto-status.ts
export type ConnectionPhase =
  | { kind: "not-connected"; permission: "prompt" | "unsupported" }
  | { kind: "blocked" }                                // stored decision "denied"; nothing sent
  | { kind: "checking"; browserMayAsk: boolean }       // a consented check is running
  | { kind: "awaiting-browser" }                       // inconclusive result while the decision is still "prompt"
  | { kind: "checked"; status: PrestoStatus; unsupportedHint: boolean }; // hint: permission unreadable, no answer

export interface ConnectionView extends PrestoStatusView {
  prestoModeHint: "connect" | "checking" | "waiting" | "blocked" | "not-found" | "unreachable" | "fastest";
  showConnectLink: boolean;
  showAwaitingHelp: boolean;
  showMayAskHint: boolean;
}
export function connectionView(phase: ConnectionPhase): ConnectionView;

// PrestoStatusController (extended): start(permission), authorize(), revoke(state),
// refresh(opts), retry(), refreshAfterPermissionChange(), refreshAfterFallback(), get authorized.
```

### Data & control flow (playground)

```
load ─► loopbackPermission() ─┬─ granted ───────► authorize(); mode Presto; refresh ─► settle
                              ├─ denied ────────► blocked (permission help); mode In-browser; nothing sent
                              └─ prompt|unsupported ► not-connected; mode In-browser; nothing sent
Presto mode click / "Connect Presto →" ─► not-connected: open connect dialog
                                        ─► blocked: focus the permission help (no dialog)
Continue ─► authorize(); mode Presto; checking{browserMayAsk: permission ≠ granted} ─► refresh ─► settle
before any operation ─► loopbackPermission(), result ignored if the epoch moved during the read:
  explained click (Continue, Try again, Retry from the permission help):
      granted|prompt|unsupported ─► proceed (a prompt read is expected: the browser has not asked yet)
      denied ─► revoke(); blocked
  automatic (load auto-connect, watcher refresh, fallback refresh, proof start):
      granted ─► mark seenGranted; proceed
      unsupported ─► proceed
      prompt, seenGranted ─► revoke(); not-connected                  (a reset the watcher missed)
      prompt, no seenGranted, reached ─► proceed   (Presto answered anyway: a browser that reports but does not gate, e.g. localhost)
      prompt, no seenGranted, not reached ─► send nothing; this proof runs in-browser; phase stays awaiting-browser
      denied ─► revoke(); blocked
  seenGranted: a permission read or watcher event returned `granted` since authorize().
  reached: a check since authorize() got a definitive answer from Presto. Both reset on revoke().
  Force-local is recomputed at every proof start from (mode, this decision); a one-proof hold never sticks.
settle(status):
  permission-blocked ─► revoke(); blocked; mode In-browser            (no watcher event needed)
  available / error / version-mismatch / secure-connection-unavailable with a definitive diagnosis ─► checked
  offline or secure-connection-unavailable/unconfirmed (inconclusive) ─► loopbackPermission():
      prompt ─► awaiting-browser ("If your browser is asking, choose Allow. Closed it? Try again")
      denied ─► revoke(); blocked; mode In-browser
      unsupported ─► checked + unsupportedHint: "couldn't connect", not "not found"
      granted ─► checked (the watcher's refresh corrects it)
watcher ─┬ granted ─► authorize(); mark seenGranted; mode Presto; refreshAfterPermissionChange()
         │           (a grant read before an operation does the same; cross-tab grants connect too)
         ├ denied ──► revoke(); blocked; mode In-browser; nothing new sent
         └ prompt ──► revoke(); not-connected; mode In-browser; nothing new sent
```

`revoke()` stops new checks and discards results. The SDK has no abort, so an operation already
running when access is revoked can still send what it has left (A3): a status check its remaining
attempts (worst case about 13 s: two HTTPS attempts and one HTTP diagnostic, each with a 2 s header and
a 2 s body deadline, plus the 1 s retry delay, `presto-transport.ts:8-10,24,779-807`), and a proof that
passed its force-local check before the revocation its whole request sequence
(`presto-client.ts:309-331`): detection, the proof request (header deadline 10 min,
`presto-transport.ts:27`) and, where the site allowed the insecure downgrade, a plaintext retry
(`presto-client.ts:445-470`). A mode flip from revocation
applies immediately, even mid-proof: a run reports "With Presto" only if the mode stayed Presto for
the whole run. The Noir path reads the current mode after its lazy backend init, immediately before
proving. Consent is in memory only; the browser's permission is the durable record.

### File-level change map

| File | Change |
|---|---|
| `packages/sdk-core/src/lib/loopback-permission.ts` (+ test) | **new**: helper + watcher |
| `packages/sdk-core/src/lib/presto-transport.ts` | private denied check delegates to the helper |
| `packages/{sdk-core,sdk,sdk-noir}/src/index.ts` | export `loopbackPermission`, `watchLoopbackPermission`, `LoopbackPermissionState` |
| `packages/{sdk-core,sdk,sdk-noir}/src/lib/public-contract.test.ts` | pin the exports; sdk's also pins the new docs text and `AGENTS.md` in `files` |
| `scripts/tarball-consumer/{presto-core,presto,presto-noir,presto-banners}/*` | fixtures import the new exports / reference `connect` |
| `packages/{sdk-core,sdk-noir,banners}/package.json` | version `1.2.0` |
| `packages/sdk-core/README.md` | document the helpers |
| `packages/banners/src/{types,strings,render,element,styles}.ts` (+ `element.test.ts`) | `connect` state, primary kind, per-variant copy/templates, non-navigating button, pending, event, Sheet focus; retail `permission-blocked` copy |
| `packages/banners/demo/*`, `packages/banners/README.md` | `connect` option; states/events tables; Usage asks first; note on `BANNER_STATES` iteration and exhaustive switches |
| `packages/sdk/.claude/skills/presto/SKILL.md` | description; "Ask before you probe"; steps 2–3, 5 and 6 examples gated; checklist; warning that probing on load is unsafe |
| `packages/sdk/README.md` | quick start and EmbeddedWallet examples gated; "Ask before you probe" subsection; suggested copy |
| `packages/sdk/AGENTS.md` (+ `files`) | **new**: pointer to the skill and the README section |
| `packages/sdk-noir/README.md` | opening example gated; pointer |
| `README.md` | Aztec and Noir quick-start examples gated; pointer |
| `docs/PLATFORM_SUPPORT.md` | pointer; "first use" sentence corrected |
| `packages/sdk/examples/consent.ts` (+ tsconfig include) | **new**: the consent wiring the README and SKILL quote verbatim |
| `packages/sdk/src/lib/docs-examples.test.ts` | **new**: executes the consent module; lints every other example across the five integration docs (phase 2) |
| `packages/landing/src/presto-detection.ts` (+ test) | **delete** |
| `packages/landing/src/main.ts`, `index.html`, `style.css`, `README.md` | drop detection wiring, panels, dead CSS; hero link copy |
| `packages/playground/src/presto-status.ts` (+ test) | controller extension, `ConnectionPhase`, `connectionView`, confirm-dialog controller, retail copy; local watcher removed |
| `packages/playground/src/aztec.ts`, `noir.ts` | default mode `local`; run-mode reporting; Noir reads mode at prove time |
| `packages/playground/src/main.ts`, `index.html`, `style.css` | startup gate, native dialogs, Services link, mode hints, awaiting/may-ask help, retail copy |
| `packages/playground/e2e/{helpers or fullstack.helpers}.ts` | shared `connectPresto(page)` |
| `packages/playground/e2e/{demo.mocked,noir.mocked,lna.real,http-consent.local-network,demo.local-network,demo.smoke,noir.smoke,presto.packaged-e2e,demo.production-smoke}.spec.ts` | connect-first flows; request recording; landing tests replaced |
| `packages/playground/README.md`, `CLAUDE.md` | behaviour, versions, test counts |

### Non-obvious mechanics

- **Why the gate is checked twice.** `refreshAfterPermissionChange()` waits for in-flight probes before
  forcing a fresh one; a `granted → prompt` change during that wait must cancel it, so the
  authorization check runs after the wait, not only before.
- **What "waiting for your browser" may claim.** A permission read of `prompt` does not prove a
  prompt is open, so the copy is conditional ("If your browser is asking…"), and only inconclusive
  transport results (no answer) are reclassified; any answer from Presto is shown as itself.
- **Banner pending.** Clicking Connect sets pending *before* emitting (a synchronous host response
  must win), patches the button in place (disabled, "Connecting…") rather than repainting, so the
  Sheet keeps its checkbox and focus. `attributeChangedCallback` skips its equal-value early return
  for `state` while pending, so both `banner.state = "connect"` and `setAttribute("state",
  "connect")` clear it.
- **Request witnesses.** A request the browser holds or blocks never reaches the health server, so the
  server counter alone proves nothing (`lna.real.spec.ts:173` already shows 0 hits after an attempted
  probe). Tests record at the page (`page.on("request")`, installed before navigation, both ports, all
  paths) and include a validity check: after Continue the recorder must see at least one request.
- **LNA harness is HTTP-only** (`playwright.lna.config.ts:38`): after Allow, the page reaches
  `secure-connection-unavailable`; connecting still requires the separate "Use HTTP for this session"
  confirmation. Browser access is never treated as consent to plaintext proving.

### Trade-offs & alternatives not taken

- **Outline B: SDK-enforced consent** (a client option that refuses all loopback traffic, status
  included, until `connect()`, with a new `not-connected` status arm). Protects opted-in callers from
  every accidental status or proof call, which helper + docs cannot; that is its real advantage. Not
  taken now: it widens `PrestoStatus` a third time (source-breaking for exhaustive switches), must
  default off (so safety still rides on docs for everyone else), and its prompt-aware deadline
  interacts with the single-flight/generation machinery. Its useful parts are folded in: one
  authorization owner in the playground, negative tests on every path, and an explicit "probing on
  load is unsafe" warning in the banners README and skill. Kept as a candidate additive option if
  integrators keep probing on load.
- **SDK waits on an open prompt.** Changes the latency contract of every status check and first
  proof; still needs a pending state in the UI. Not taken; the exported watcher covers it.
- **A core `awaitLoopbackDecision()` helper.** Redundant with `watchLoopbackPermission()`.
- **A separate `presto-connection.ts` controller over `PrestoStatusController`.** Two owners of
  rendering and two layers of invalidation; rejected for the single extended controller.
- **A hand-written focus trap helper.** Native `showModal()` already gives containment and inertness.

### User-facing copy (retail pass)

Playground connect dialog (`prompt`; `unsupported` swaps "will ask" for "may ask"):

> **Connect Presto?**
> Presto proves on your computer, much faster than this tab can. To reach it, your browser will ask
> for permission to connect to apps on this device. Some browsers word it as devices on your network.
> - This site only uses that permission to talk to Presto.
> - The first time you prove, Presto asks you to approve this site.
> - You can turn either off later: in your browser's site settings, or in Presto's Settings.
>
> [Not now] [Continue]

Presto row labels: `not connected` · `checking…` · `waiting for your browser` · `running` ·
`not found, in-browser` · `couldn't connect, in-browser` · `blocked by your browser` · `unexpected
answer, in-browser` (the HTTPS and version labels stay). Services link `Connect Presto →`. Presto mode
hint: `connect`, `checking…`, `waiting`, `blocked`, `not found`, `couldn't connect`, `fastest`. May-ask
hint while checking: "If your browser asks for permission, choose **Allow**." Awaiting help: "If your
browser is asking whether this site can reach apps on this device, choose **Allow**. Closed it? [Try
again]". Couldn't-connect help (permission unreadable, no answer): "If your browser asked for
permission, allow it and try again. Otherwise, check that Presto is running." Permission help: "Your browser blocked
this site from reaching Presto. Open the site settings next to the address bar, allow access to apps
on this device (Chrome: **Apps on device**), then retry. Work computers and embedded pages may need
an administrator." Logs: "Presto not connected. Proofs run in this tab until you connect",
"Connecting to Presto…", "Waiting for your browser's answer", "Presto found on this computer",
"Presto not found, proving stays in-browser", "Your browser blocked access to Presto. Allow it in site
settings, then Retry", "Access to Presto was turned off. This run continues in the browser".

Landing hero link: "Already installed? See it prove in the playground →".

Banner `connect` copy (fixed; approved with the mockups, A1):

| Variant | Copy | Controls |
|---|---|---|
| Ribbon | **Already have Presto? Connect it** · Your browser may ask to let this site reach apps on this device | Connect Presto · × |
| Billboard | **Fast proofs. Like magic** — Have Presto installed? Connect it and this app proves at native speed. Your browser may ask to let this site reach apps on this device. | Connect Presto · Get Presto (link) · × |
| Dock | **Proving in your browser…** Have Presto? Connect it and the next proof runs natively. Your browser may ask to let this site reach apps on this device. | Connect · × |
| Card | Faster proofs / **Connect Presto** — If Presto is on this computer, connect it and this app proves at native speed. Your browser may ask to let this site reach apps on this device; you can turn that off in site settings. | Connect Presto · "Don't have it? Get Presto" (link) · × |
| Tile | **Fast proofs. Like magic.** Have Presto? Connect it to prove at native speed. Your browser may ask to let this site reach apps on this device. | Connect Presto · Get Presto (link) |
| Sheet | **Connect Presto?** Presto proves on your computer, at native speed, instead of in this tab. To reach it, your browser may ask to let this site reach apps on this device. You can turn that off in site settings. | Connect Presto · Continue in browser · "Don't ask again" · "Don't have Presto? Get it for <OS>" |

Banner `permission-blocked` (existing, retail pass): **Your browser blocked this site from reaching
Presto** · Allow it in site settings, then retry · Retry.

## Security & Adversarial Considerations

- **Threat model.** The change narrows surface: fewer unsolicited loopback requests, and a visitor
  who understands the prompt is less likely to allow a hostile site out of habit. Residual concerns:
  (a) consent laundering through copy that understates the permission; (b) a path that sends a
  request despite the gate; (c) the unchanged unauthenticated-loopback discovery boundary
  (`docs/SECURITY_MODEL.md` §2).
- **Honest scope.** Every Connect surface says the browser may ask to let the site reach apps on this
  device. The dialog also says older browsers word it as devices on the network (Chrome 142–144,
  where the permission is the wider local-network one); the banners do not, for space, and the
  browser's own prompt states the true scope before anything is granted. Copy says this site uses the
  permission only for Presto, never that the permission is Presto-only.
  Browser access is not consent to plaintext: the HTTP confirmation stays separate.
- **No persisted consent.** In memory only; nothing in storage, cookies, the URL or desktop config;
  no URL switch skips the dialog.
- **Fail closed.** `unsupported` and query errors mean "ask first"; the watcher probes only on
  `granted`; authorization is re-checked after every wait and the permission is re-read before every
  consented operation, so a browser that fires no change events still cannot re-prompt after a reset.
- **Every path gated.** Startup, mode switch, Services link, Retry, Try again, fallback refresh,
  HTTP confirmation, watcher, Aztec proofs (`setForceLocal(true)` until consent) and Noir proofs (mode
  read at prove time). The real-browser tests record requests at the page before navigation.
- **Banner.** The `connect` control is a `<button>` with no `href`; copy is static; `href` stays
  escaped; no host data enters events.
- **Supply chain.** No new dependencies; publishing stays on trusted publisher + provenance.
- **Release coupling (A2).** `scripts/published-playground.ts:141-160` checks that the *published*
  `presto` and `presto-noir` pin `presto-core` at the *workspace* version. Once arc 1 bumps core to
  1.2.0, every `deploy-app` run, including playground-only hotfixes, fails that check until a
  `packages: all` release has published core 1.2.0, noir 1.2.0 and a new presto revision. Landing
  deploys automatically on push to `main` (`deploy-landing.yml`), so merging arc 2 ships the landing.
  Rollback: revert arc 2 before arc 1.

## Assumptions

### Facts

1. The ordinary playground startup makes one pre-click loopback request, `init()` → `checkServices()`
   (`packages/playground/src/main.ts:431`); the permission watcher (`main.ts:342-346`) re-probes on
   any change; the landing probes on load (`landing/src/main.ts:203`). Prover, client, transport,
   `EmbeddedWallet.create` and the Noir backend construct without probing.
2. `setForceLocal(true)` gates proving only (`presto-prover.ts:156`, `presto-ultra-honk-backend.ts:124`);
   `checkPrestoStatus()` probes or serves the 10 s cache (`presto-client.ts:127-130`).
3. The permission query with fallback exists three times (`presto-transport.ts:176-197`,
   `landing/src/presto-detection.ts:45-91`, `playground/src/presto-status.ts:30-68`).
4. `refreshAfterPermissionChange()` waits for in-flight operations, then starts a forced refresh
   unconditionally (`presto-status.ts:213-228`).
5. A browser-HTTPS-only check can take about 13 s in the worst case before an inconclusive result
   (two HTTPS attempts and one HTTP diagnostic, each with a 2 s header and 2 s body deadline, plus a
   1 s retry delay, `presto-transport.ts:8-10,24,779-807`). A proof checks force-local once, before
   `client.prove()`, which then detects and posts (`presto-prover.ts:156`,
   `presto-ultra-honk-backend.ts:124`, `presto-client.ts:309-331`). The SDK has no abort for either.
6. Production playground builds against published SDK packages and asserts their core pin against the
   workspace version (`scripts/published-playground.ts:141-160`, `release-sdk.yml` `deploy-app`);
   previews and `production-smoke` use the workspace; landing auto-deploys on push to `main`.
7. Headless Chromium in `playwright.lna.config.ts` reports `loopback-network` state, honours
   `context.grantPermissions(["local-network-access"])` (`lna.real.spec.ts:18-41`), and serves only
   an HTTP health endpoint (`playwright.lna.config.ts:38`); a blocked or held request never reaches
   the server (`lna.real.spec.ts:173`).
8. The mocked harness's permission stub has no `addEventListener` (`demo.mocked.spec.ts:43-57`), so
   watcher transitions are provable only in unit tests and the real-LNA suite.
9. `presto.packaged-e2e.spec.ts:63`, `demo.smoke.spec.ts:36`, `noir.smoke.spec.ts:53`,
   `demo.local-network.spec.ts:37,87` click `#mode-accelerated` and expect a native proof.
10. Root `bun run test` excludes `packages/landing`; `landing.yml` runs its tests.
11. Banner templates other than Ribbon hard-code the install pitch; `ctaLink()` navigates
    (`banners/src/render.ts:34-36`); `attributeChangedCallback` returns early on equal values
    (`element.ts:127`); `#openSheet` focuses `[data-action="cta"]` (`element.ts:185`).
12. Chrome 145+ prompt text: "Access other apps and services on this device"; toggle "Apps on device";
    Chrome 142–144: "Look for and connect to any device on your local network" / "Local network
    access" (Okta help centre, Chrome for Developers blog, checked 2026-09-25).
13. `STRINGS`, `VARIANT_COPY`, `VARIANT_STATES` are public banner exports (`banners/src/index.ts:6`);
    `scripts/published-playground.test.ts` `1.1.0` values are deliberate scenario fixtures.
14. Existing unit tests prove `setForceLocal(true)` sends nothing (`presto-prover.test.ts:209`,
    `presto-ultra-honk-backend.test.ts:235`). `test:e2e:smoke` runs in no workflow (`_e2e-app.yml`
    defaults to it but its one caller, `app.yml:161-163`, passes `test:e2e:local-network`) and needs
    an HTTPS presto (`noir.smoke.spec.ts:4-8`); the headless server is TLS-free. Packaged acceptance
    runs from `build-test-bundle.yml` (`workflow_dispatch`, `platform: all`) and the release pipeline.

### Inferences

- **I1.** Chrome stores the decision per origin (not load-bearing after D1).
- **I2.** In Playwright Chromium on a `localhost` page (mocked, local-network, smoke, packaged
  projects) the `loopback-network` query returns a stable value or throws. The shared
  `connectPresto(page)` helper works either way; phase 5 records which.
- **I3.** Firefox 153+ answers `loopback-network` queries and fires change events (carried from the
  SDK README; unverified, no Firefox harness). If not, Firefox reads `unsupported`: the dialog still
  comes first, but automatic recovery after a late Allow and auto-connect for returning visitors do
  not; the unsupported hint and Try again cover it.
- **I4.** Adding `connect` to the exported `BannerState` union is a minor change (repo precedent,
  `packages/sdk/MIGRATION.md`); consumers iterating `BANNER_STATES` or switching exhaustively will see
  it. Flagged in the banners README.
- **I5.** Chrome keeps its prompt open after the SDK aborts the held request. Unproven (headless has
  no prompt UI); the conditional copy and Try again make it recoverable either way.

### Asks

Resolved by the owner at the approval gate, 2026-09-25: **A1** approved as mocked; **A2** approved as
recommended (merge both PRs, then run a `packages: all` release before the next playground deploy;
both PR bodies say so); **A3** accepted; **A4** accepted. Scope and tier approved as written.

- **A1.** Banner `connect` visuals and copy for all six variants. The ELI5 mockups use the banner's real
  stylesheet; approving them approves the visuals, and phase 3 stops for sign-off only if the real
  component deviates.
- **A2.** Release coupling: after arc 1 merges, playground deploys fail until a `packages: all` release;
  merging arc 2 deploys the landing.
- **A3.** Revocation cannot stop an SDK operation already running. A status check may finish its
  remaining attempts (about 13 s worst case). A proof that started before the revocation may finish
  its whole request sequence: detection, the proof request (which may run for minutes) and, where the
  site allowed the insecure downgrade, a plaintext retry. If the browser was reset to "ask" meanwhile,
  one of those requests can raise the browser prompt. The page starts nothing new, discards the
  check's result, and labels the run by what actually happened. Accept (recommended: the proof was
  started under the visitor's consent, and the trigger is the visitor changing the permission while
  their own proof runs), or add cancellation to core's `checkStatus` and `prove` (new published API,
  more scope).
- **A4.** Safari, Chrome before 142 and any browser whose permission cannot be read see the dialog
  ("may ask") even if no prompt follows: one extra click, by the fail-closed rule. On those browsers a
  mid-session reset cannot be seen either; the next request is simply refused or re-prompted by the
  browser itself.

## Phases

Every gate includes the fast layers. `SCRATCH` = the session scratch directory.
**Tarball check** for package `P` (`presto-core`, `presto`, `presto-noir`, `presto-banners`):
`bun scripts/pack-candidate.ts --package P --version 0.0.1-tarball-ci --out "$SCRATCH/candidate-P"`,
then `bash scripts/sdk-tarball-consumer.sh <tarball> P --with <pair>...` with the printed `tarball`
and `with` values (the two steps of the `Tarball Consumer` job in `_ts-package-ci.yml`).

### Phase 1 — core helpers and re-exports ✓

`loopback-permission.ts` + tests (four states, name fallback, missing API, throwing query, call-time
read, watcher dedupe/unsubscribe/no-op); transport's denied check delegates (existing transport tests
stay green); three barrels; three contract tests; consumer fixtures for core/presto/noir import the
new names; `sdk-core/README.md`; core and noir to `1.2.0`.

**Validation gate**
- Commands: `bun run test`; tarball check for `presto-core`, `presto`, `presto-noir`.
- Pass: exit 0; new tests pass; the three consumers install, typecheck and load with the new imports.
- Layers: lint, typecheck, unit, packed artifact.

### Phase 2 — docs, examples and agent pointer ✓

SKILL.md (description; "Ask before you probe"; steps 2–3 examples build one prover with
`setForceLocal(true)` and pass that instance to the wallet; step 5's example gated the same way; step
6 after consent; checklist; "probing on load is unsafe" warning); SDK README quick start and
EmbeddedWallet examples gated the same way, "Ask before you probe" subsection (read → gate → click →
check → watcher → re-read before each proof, plus suggested copy); sdk-noir README opening example and
root README Aztec and Noir quick starts gated; `packages/sdk/AGENTS.md` + `files`; pointers in root
README and `docs/PLATFORM_SUPPORT.md`; `sdk/public-contract.test.ts` pins the section heading,
`loopbackPermission`, and `AGENTS.md` in `files`, keeping every existing pinned string.

The consent wiring is one real module, `packages/sdk/examples/consent.ts` (in the package's
typecheck, not in `files`). It takes the one prover instance the app uses, forces it local, and
exports `askBeforeConnecting(prover, show)`, where `show` receives `"ask"`, `"blocked"` or a
`PrestoStatus`. Consent is a click or a reported `granted`; `denied`, or `prompt` after a grant (a
reset), revokes it and discards any check in flight. It connects with no click only on a `granted`
read, and returns `connect()` for the explained click, `beforeProving()` (recomputes force-local per
proof for browsers without change events) and `stop()`. The README's "Ask before you probe" block and the SKILL's step are that file's body
verbatim, and every other example that proves or builds a wallet uses the same gated instance.
`docs-examples.test.ts` then does two things:
- **Executes** the module on the stubbed prover `presto-prover.test.ts` already uses (fake step,
  WASM stub) under a stubbed `navigator.permissions` and a recording `fetch`, calling both status
  and `createChonkProof` through that instance: before consent (`prompt`, `unsupported`, `denied`)
  neither load nor a proof sends anything; `connect()` sends with `prompt` and sends nothing with
  `denied`; after connection a proof reaches `/prove`; after a
  watcher change to `prompt` a proof sends nothing again, and so does an unreported reset after
  `beforeProving()`; with `granted` at load, the module connects with no click. It also asserts the two docs contain the file's body verbatim.
- **Lints** every other fenced `ts`/`typescript`/`js` block, and the `<script>` of every `html` block,
  in `README.md`, `packages/sdk/README.md`, `packages/sdk-noir/README.md`, SKILL.md and
  `packages/banners/README.md`: a block that calls `generateProof(`, `EmbeddedWallet.create(` or
  passes a Presto prover to an account or PXE constructs exactly one Presto instance, assigns it to a
  variable, calls `setForceLocal(true)` on that variable before any send, and passes that variable
  (never an inline `new PrestoProver(`); a block that calls `checkPrestoStatus(` (force-local does
  not gate it, `presto-prover.ts:149`) must carry the marker comment `// after the user connects`.
  The lint and marker are review aids that stop regressions; the behavioural evidence is the executed
  module. The banners README Usage is rewritten around `loopbackPermission()`, a click-driven
  `connect()` and the `presto-banner:connect` event.

**Validation gate**
- Commands: `bun run test` (includes `docs-examples.test.ts`; its lint half must fail against the
  current docs before the edits); tarball check for `presto`;
  `cd packages/sdk && npm pack --dry-run 2>&1 | tee "$SCRATCH/sdk-pack.txt"`, then
  `grep -q "AGENTS.md" "$SCRATCH/sdk-pack.txt" && grep -q "SKILL.md" "$SCRATCH/sdk-pack.txt"`.
- Pass: exit 0 on every command.
- Layers: lint, typecheck, unit (doc-sync), packed artifact.

### Phase 3 — banner `connect` state ✓

Types, strings, `PrimaryKind` `connect`, six templates (non-navigating button; secondary install link
per the copy table), pending set before emit and patched in place, equal-value exception in
`attributeChangedCallback`, `#onClick` `connect` case, Sheet focuses the connect button,
`BANNER_EVENTS.connect`, `VARIANT_STATES`, styles (disabled pending button; Billboard's narrow
container query wraps its now three controls, which otherwise clip the × at phone width; link style
for Billboard), retail `permission-blocked` copy, demo option,
README, banners consumer fixture, `1.2.0`. Tests: every variant paints `connect` with a button and no
`href` on it; click emits and does not navigate; pending clears on property *and* equal attribute
assignment; a synchronous host response inside the event handler is not overwritten; dismissal
bucket separate; Sheet focus lands on Connect.

**Validation gate**
- Commands: `bun run test`; tarball check for `presto-banners`; start `bun run --cwd packages/banners dev`,
  then run `$SCRATCH/banner-shots.ts` (a Playwright script executed from `packages/playground`, which
  owns the Playwright dependency) that screenshots all six variants in `connect`, light and dark, into
  `$SCRATCH/banners-connect/`.
- Pass: exit 0; the screenshots match the mockups approved at the plan gate (A1) in copy, controls and
  layout, and are shown in the transcript. Any visible deviation from the approved mockups needs the
  owner's sign-off before the phase is marked ✓.
- Layers: lint, typecheck, unit, packed artifact, visual.

### Phase 4 — landing: remove detection

Delete `presto-detection.ts` and its test; strip `main.ts`, panels, dead CSS; hero link copy; rewrite
`packages/landing/README.md`. Replace the two landing tests in `lna.real.spec.ts` with one landing test
run twice (permission `prompt`, then granted): page recorder installed before navigation, both ports,
all paths, zero requests after load settles. The landing web server and the `packages/landing/**`
routing in `app.yml` stay.

**Validation gate**
- Commands: `bun run --cwd packages/landing test && bun run --cwd packages/landing build`; `bun run test`;
  tarball check for all four packages (D7);
  `bun run --cwd packages/playground test:e2e:lna -g landing`;
  `rg -n "127.0.0.1|permissions.query|presto-detection" packages/landing/src packages/landing/index.html`.
- Pass: exit 0 on the first three; the `rg` finds nothing; both landing runs record zero requests.
- Layers: lint, typecheck, unit, build, real-browser E2E.

### Phase 5 — playground: consent flow

Controller extension (`authorize`/`revoke`, gate re-checked after waits, epoch bump on revoke,
`settle` classification) with unit tests for every transition in the flow, including: reset to
`prompt` during a queued refresh starts nothing; a stale result after revoke is dropped; granted at
load probes once; denied at load sends nothing and opens no dialog; inconclusive + `prompt` →
awaiting; `error`/`version-mismatch` + `prompt` → checked; `permission-blocked` result → blocked with no
watcher event; inconclusive + `unsupported` → checked, "couldn't connect"; Continue and Try again
proceed on a `prompt` read; with a persistent `prompt`, Continue → `available` → proof goes native
and Continue → `error` → proof falls back without a new detection loop; a proof start with `prompt`
before any answer sends nothing and proves in-browser, and the next proof after a grant goes native;
`prompt` after a seen grant revokes with no change event fired; revoke → grant (by watcher event, and
by a pre-operation read with no event) → Presto mode → native proof; a watcher transition during the
pre-operation read wins over the read. `connectionView` tests. Native dialogs + generalised confirm-dialog controller; `aztec.ts`
default `local` and run-mode reporting; `noir.ts` reads mode at prove time; `main.ts`/`index.html`
wiring and retail copy; shared `connectPresto(page)` helper. Mocked E2E: route counter on both ports
stays at zero after load (`prompt`) and after "Prove Noir Circuit" with `?noirStub=true` before consent;
connect flow → running; granted auto-connect; denied panel with no dialog; Cancel sends nothing;
dialogs inert background, Escape cancels, focus returns. Record I2.

**Validation gate**
- Commands: `bun run test`; tarball check for all four packages (D7);
  `bun run --cwd packages/playground test:e2e`; `bun run --cwd packages/playground build`;
  `rg -n -i "loopback|127\.0\.0\.1" packages/playground/index.html` plus a review of every string
  literal passed to the log or rendered by `connectionView`.
- Pass: exit 0; mocked suite green with the zero-request assertions; no jargon in user-facing strings.
- Layers: lint, typecheck, unit, mocked E2E, build.

### Phase 6 — real browser, sandbox, release-gate specs, repo docs

`lna.real.spec.ts` playground tests: recorder before navigation, both ports, all paths; zero requests
≥ 8 s after load with `prompt`; recorder validity (Continue → at least one request); Continue → grant →
secure help → "Use HTTP for this session" → confirm → running; deny → blocked → same-context grant
recovers; grant arriving after the check gave up → running; reset to `prompt` while a check is queued →
no request after the in-flight one settles, UI back to not-connected. Move `demo.local-network`,
`http-consent.local-network`, `demo.smoke`, `noir.smoke`, `presto.packaged-e2e` onto `connectPresto`;
`demo.production-smoke` asserts the In-browser default. Update `packages/playground/README.md` and
CLAUDE.md.

**Validation gate**
- Commands: `bun run --cwd packages/playground test:e2e:lna`;
  `bun run --cwd packages/playground test:e2e:local-network` (Aztec sandbox + headless presto per
  `_e2e-app.yml`; if the sandbox cannot run here, dispatch `app.yml` on `lna-consent-sites`
  (`gh workflow run app.yml --ref lna-consent-sites`) and quote the green `local-network-e2e` job);
  packaged acceptance (covers `presto.packaged-e2e` and
  `http-consent.local-network` against the real app): dispatch `build-test-bundle.yml` with
  `platform: all` on `lna-consent-sites` and quote the green run ID; `test:e2e:smoke` only if an HTTPS
  presto is reachable here, with `PRESTO_URL` set so its native tests do not skip, otherwise recorded
  as unexercised (Fact 14); `bun run --cwd packages/playground test:e2e:production-smoke`;
  `bun run test`; tarball check for all four packages (D7); `bun run lint:actions`.
- Pass: every command exit 0 or its run ID green and quoted; the smoke lane either ran with
  `PRESTO_URL` and no skipped native test, or is named as unexercised in the PR body.
- Layers: real-browser E2E, sandbox E2E, release-gate specs, lint.

## Delivery

Two arcs, stacked with `gh stack`. `code_review: off` for both.

| Arc | Branch | Phases | Stacks on | `/code-review` |
|---|---|---|---|---|
| 1 — packages | `worktree-lna-consent` (adopted as layer 1) | 1, 2, 3 | `main` | off |
| 2 — sites | `lna-consent-sites` | 4, 5, 6 | arc 1 | off |

Arc 1 is additive (exports, docs, banner state). Arc 2 consumes arc 1 from the workspace; roll back arc
2 before arc 1. PRs open only after arc 2's loop and the cross-arc pass converge. Both PR bodies carry
the release coupling (A2); arc 2's also notes the automatic landing deploy.

## Post-implementation

1. **No `/code-review`** (`code_review: off`).
2. **Arc boundary loop (after phase 3, and after phase 6).** Send `/codex high` the arc's diff,
   plan.md, the decision ledger, the arc map ("arc N of 2; arc 2 removes landing detection and builds
   the playground consent flow on arc 1's helpers and banner state"), an adversarial/security ask,
   and these two rules verbatim:
   - *"Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone."*
   - *"Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact."*
3. **Fix loop.** Verify each finding against the repo, apply accepted fixes, commit, log the round in
   `lessons/arc-N-review.md`, resume the same Codex session with the fix diff. Repeat until a round has
   no new material findings; still material after 3 rounds → stop and surface. Only then
   `gh stack add lna-consent-sites` (after arc 1).
4. **Cross-arc pass.** Fresh `/codex high` session over the net diff from `8edbbca`, asking for seams
   between arcs, duplication across arcs and drift from this plan, with the same two rules. Same loop.
5. **Delivery.** `gh stack init --adopt worktree-lna-consent` at the start of arc 1; at delivery
   `gh stack sync` if `main` moved, `gh stack submit --auto`, `gh pr edit` each body, `gh pr checks
   --watch`. `gh stack merge` is the owner's call.
6. **Close-out (in arc 2's PR):** `## Outcome` after the front matter; promote gotchas to
   `implementations-plan/lessons.md`; move follow-ups (at least: `app.yml` workflow-level
   `permissions: contents: read`; optional SDK consent mode / abortable check) to `follow-ups.md`;
   archive after merge.

**Post-implementation hardening:** no `/harden` scheduled; the change narrows surface and touches no
secrets, auth, CI permissions or publishing.

## Decision ledger

| # | Decision | Source | Status |
|---|---|---|---|
| L1 | Outline A (helper + docs + banner state + page gating) over outline B (SDK-enforced consent) | draft; both audits agree | adopted; B's claim of "same result" corrected; B kept as a future additive option |
| L2 | Fold B's single authorization owner and negative tests into A | Codex §4, Fable §4 | adopted |
| L3 | Extend `PrestoStatusController` as the single owner instead of a separate `presto-connection.ts` layer | Codex §3 (High); Fable §3 asked for one writer | adopted |
| L4 | Re-check authorization after waits; `revoke()` bumps the epoch; stale results dropped | Codex §1 (High) | adopted |
| L5 | In-flight SDK check may finish after revoke (no abort) | Codex §1, §2 Asks (High) | surfaced as A3 |
| L6 | Noir reads the mode at prove time | Codex §1 (High) | adopted |
| L7 | Revocation flips mode immediately, even mid-proof; run reports Presto only if it stayed Presto | Fable §1 asked to queue mode flips; Codex requires no new requests | adopted (no-surprise-prompt wins; labelling fixed instead of queuing) |
| L8 | Executable examples in README, SKILL and sdk-noir README gated on one force-local instance | Codex §1 (High) | adopted |
| L9 | Every Connect surface mentions the browser ask; revocation in dialog, Card, Sheet; retail pass on banner `permission-blocked`; "devices on your network" for older Chrome | Codex §1, Fable §1 | adopted |
| L10 | Awaiting-browser only after an inconclusive result; conditional copy; definitive answers shown as themselves | Codex §2 (High) | adopted |
| L11 | Fable: enter awaiting-browser at Continue whenever the permission read `prompt` | Fable §3 (Medium) | adopted in part: a may-ask hint shows at once in `checking`; the awaiting phase still waits for an inconclusive result, because a `prompt` read does not prove a prompt is open and an immediate "waiting" would mask a definitive answer from Presto (Codex §2, High) |
| L12 | Fable: `unsupported` + inconclusive → awaiting-browser | Fable §2 (I3) | rejected for not-found + an "if your browser asked, allow it and try again" hint: `unsupported` includes Safari and older Chrome, which never prompt, so "waiting for your browser" would be false indefinitely for every visitor without Presto |
| L13 | Granted at load + Presto offline: stay in Presto mode, hint `not found` | Fable §3 | adopted |
| L14 | Release coupling restated (core pin check; `packages: all`; landing auto-deploy; rollback order) | Codex §2, Fable §1 | adopted; surfaced as A2 |
| L15 | Release-gate specs (packaged, smoke, noir.smoke, local-network, http-consent) on a shared `connectPresto` | Fable §1 (High), Codex §3 | adopted |
| L16 | Page-level request recorder before navigation, both ports, all paths, plus a validity check; landing tested with `prompt` and granted | Codex §3 (High), Fable §3 | adopted |
| L17 | LNA "connected" flow keeps the separate HTTP confirmation | Codex §3 | adopted |
| L18 | Consumer fixtures import the new exports; dry-run pack asserts each file separately | Codex §3 | adopted |
| L19 | Banner pending set before emit, patched in place, equal-value exception in `attributeChangedCallback`; `connect` click and Sheet focus cases | Codex §3, Fable §3 | adopted |
| L20 | Native `<dialog>` for both playground dialogs | Codex §3 (Low) | adopted |
| L21 | `loopbackPermission()` reads `navigator.permissions` at call time | Fable §1 | adopted |
| L22 | Keep the landing web server and `packages/landing/**` LNA routing | Codex §3, Fable §3 (recon said delete) | adopted |
| L23 | Phase 6 CI fallback dispatches `lna-consent-sites` | Codex §3 | adopted |
| L24 | Unify "Connect Presto" naming; "Connecting to Presto…" log; drop "health check error" jargon | Fable §3 | adopted |
| L25 | Add workflow-level `permissions: contents: read` to `app.yml` | Codex §1 (Low) | deferred to follow-ups (plan no longer edits `app.yml`) |
| L26 | Core `awaitLoopbackDecision()` helper | Fable §4 | rejected: redundant with `watchLoopbackPermission()` |
| L27 | Cross-tab grants auto-connect | Fable §1 | accepted, documented in the watcher's contract |
| L28 | Unsupported browsers see the dialog even without a prompt | Fable §2 | surfaced as A4 |
| L29 | Proofs already past their force-local check can still detect and POST after revocation | Codex final #1 (High) | named in the flow notes and A3 with the corrected ~13 s bound; accept vs. core cancellation left to the owner |
| L30 | Browsers that report state but fire no change events cannot see a reset | Codex final #2 (High) | adopted: re-read the permission before every consented operation; the unreadable case named in A4 |
| L31 | SKILL step 5, root README Aztec and Noir quick starts, banners README still ungated; string pins do not prove behaviour | Codex final #3 (High) | adopted: examples gated; `docs-examples.test.ts` rule over five docs + existing force-local tests (Fact 14) |
| L32 | Dock and Tile copy did not say what the browser asks | Codex final #4 (Medium) | adopted; the older-Chrome caveat stays in the dialog only (space; the browser prompt states its own scope) |
| L33 | `permission-blocked` status had no transition | Codex final #5 (Medium) | adopted: settle → blocked without a watcher event, unit-tested |
| L34 | "Not found" when the permission is unreadable overclaims | Codex final #6 (Medium) | adopted: "couldn't connect" + help; Quality Bar 3 reconciled |
| L35 | Smoke gate could not be proven by an `app.yml` run; smoke needs HTTPS | Codex final #7 (Medium) | adopted: packaged acceptance via `build-test-bundle.yml`; smoke runs only with an HTTPS presto and `PRESTO_URL`, else named unexercised |
| L36 | D7 tarball check missing from phases 4–6 | Codex final #8 (Low) | adopted: all four packages in each gate |
| L37 | Re-read before operations would revoke the first Continue (permission still `prompt`) | Codex final r2 (High) | adopted: explained clicks proceed on `prompt`; automatic operations revoke only after a seen grant; epoch-checked reads |
| L38 | The docs rule was a lint, not behaviour; missed HTML and status-only blocks | Codex final r2 (High) | adopted: one executed example module included verbatim in README and SKILL; lint extended to HTML scripts and `checkPrestoStatus(` blocks |
| L39 | A3 understated proof continuations (10 min POST, HTTP retry); "one residual" vs A4 | Codex final r2 (Medium) | adopted |
| L40 | Phase 6 relied on a push trigger `app.yml` does not have | Codex final r2 (Medium) | adopted: explicit `gh workflow run app.yml --ref lna-consent-sites` |
| L41 | A persistent `prompt` read after Presto answered would hold every proof in-browser | Codex final r3 (High) | adopted: separate `reached` (Presto answered) from `seenGranted` (reset signal) |
| L42 | Recovery after revoke did not restore Presto mode; one-proof hold could stick | Codex final r3 (Medium) | adopted: grant (event or read) → Presto mode; force-local recomputed per proof |
| L43 | The executed example tested status, not proving; lint allowed two instances | Codex final r3 (Medium) | adopted: example takes the app's one instance, test proves through it before consent, after connect and after revoke; lint requires one gated variable |

**Unresolved disagreements:** three Fable proposals are resolved differently than proposed, each with
its reason in the ledger: queuing mode flips while deploying (L7, conflicts with Codex's no-new-requests
condition), immediate awaiting (L11) and unsupported → awaiting (L12).

## Audit verdicts

- **Codex (GPT-6 Astra, high), round 1:** `conditional approve (with conditions: close revocation and
  Noir races; establish one authorization/render owner; gate executable integration examples; correct
  pending-state classification and consent copy; strengthen request-counting and packed-consumer
  tests; reconcile release, CI-branch, and rollback instructions)`. All conditions addressed (L3–L10,
  L14–L18, L22–L23).
- **Fable (Claude, Plan agent), round 1:** `conditional approve (with conditions: add the
  packaged/smoke/local-network/noir-smoke specs to the change map with a shared connect helper and a
  phase-6 gate for them; give phase a single writer; correct the release-coupling note and surface it
  as an Ask; guard watcher-driven mode changes while deploying; resolve I3 by defining
  unsupported-after-Continue; move the pending repaint exception into attributeChangedCallback and add
  the connect click/focus cases)`. Addressed by L3, L14, L15, L19; the `deploying` guard (L7) and
  the I3 definition (L12) are resolved differently, with reasons.
- **Codex final fresh-context pass (GPT-6 Astra, high):** `conditional approve (with conditions:
  resolve both revocation residuals; complete and behaviorally validate executable examples; correct
  consent copy and missing state transitions; make smoke and per-phase tarball gates prove their stated
  criteria)`. Addressed by L29–L36. Round 2 (resumed): `conditional approve (with conditions:
  distinguish explicit-click authorization from permission reset; behaviorally validate documentation
  wiring; correct A3's timing and residual scope; restore explicit App workflow dispatch)`, addressed
  by L37–L40. Round 3 (resumed): `conditional approve (with conditions: resolve persistent-prompt
  behavior after definitive responses; specify restoration of native proving on recovery; exercise
  proof behavior through the documented instance)`, addressed by L41–L43 **without a further review
  round**: the final pass reached its three-round cap. The implementation's arc-2 Codex loop is the
  next check of these transitions. The proof-continuation residual goes to the owner as A3.

## Seeds

ELI5 artifact: https://claude.ai/artifact/USTTMPBY1XgTZwS5nPoALS — source
`implementations-plan/lna-consent/eli5.html` (local only; republish the same path to keep the URL).

Final seeds (post-approval). Run inside this worktree (`agent-worktree resume lna-consent`). Use
exactly one per session; they do not compose. **Recommended: `/goal`**, since every completion signal
is visible in the transcript.

```
/goal All six phases marked ✓ in implementations-plan/lna-consent/plan.md (the phase headers in the file — not the chat, not the task list), each ✓ backed by that phase's validation gate as written in plan.md reported passing in the transcript (phase 3: the banner screenshots shown in the transcript and matching the approved mockups, or the owner's sign-off on any deviation quoted); for each phase the agent has printed `LESSONS_FILE=implementations-plan/lna-consent/lessons/phase-N.md` in the transcript; plan.md's `code_review` is `off`, so `/code-review` was NOT run; the codex fix loop converged at the arc 1 boundary (after phase 3), at the arc 2 boundary (after phase 6) and in the final fresh cross-arc pass, each convergence evidenced by a resumed codex pass reporting no new material findings, quoted in the transcript; the two-PR stack (worktree-lna-consent, then lna-consent-sites on top) exists on GitHub, created only after all loops converged, and both PR bodies state the approved release order (merge both, then a `packages: all` release before the next playground deploy; arc 2's also notes the automatic landing deploy) (`gh stack view` output in the transcript); `bun run test`, `bun run lint` and `bun run lint:actions` all report exit 0 in the transcript. Never publish packages, deploy, dispatch a release, or merge.
```

Fallback:

```
/loop 15m Drive implementations-plan/lna-consent forward. Never idle waiting for my input. Each firing:
1. **Reality check**: read implementations-plan/lna-consent/plan.md and lessons/ (authoritative state — not the chat), including its Outcome & Quality Bar section: every step is judged against those criteria, not just against "it runs". If that path is gone, look for implementations-plan/archive/lna-consent/plan.md — the plan closed and was archived: STOP the loop and say so. If plan.md carries an `## Outcome` block, it is closed: STOP. Otherwise, task list empty (fresh session)? Rebuild it from plan.md, one task per remaining step; run `git status` and `git log --oneline -5`. If a PR exists, `gh stack view` and `gh pr view --json statusCheckRollup` (no --watch). Without a PR, `gh run list --branch $(git branch --show-current) --limit 1 --json status,databaseId`.
2. **Waiting on CI is fine** — confirm it is progressing (`gh run watch <run-id>` up to 10 minutes; stuck past that → inspect logs, log it as blocked in lessons). Use the wait: review the diff, prep the next phase, strengthen tests. Don't start work that conflicts with the in-flight change.
3. **No task in hand?** Pick the next pending step from plan.md and start it. After each meaningful edit run the fast layers for the touched packages (`bun run lint` + `bun run test`, or the specific test file first). Commit (signed, conventional) → `gh stack push`; `gh stack sync` if main or arc 1 moved.
4. **Stuck, or facing a decision you'd normally bring to me?** Don't wait. Call `/codex high` with full context and go back and forth until you reach a defensible decision, then act. Log every consult + verdict in lessons/phase-N.md. Hard limits stay hard: never merge, never publish npm packages, never deploy or dispatch a release, never expand scope beyond plan.md; if a decision needs one, surface it and hold.
5. **Same step failed 5 times?** Stop retrying; reassess with codex, then continue down the agreed path.
6. **Phase green?** Green means THE PHASE'S VALIDATION GATE in plan.md passes (commands + pass criteria). Run the full gate, paste the result, mark ✓ in plan.md, write lessons/phase-N.md, print `LESSONS_FILE=implementations-plan/lna-consent/lessons/phase-N.md`, advance. Phase 3 also needs the banner screenshots in the transcript; if they deviate from the approved mockups, ask me and hold phase 3 only. Arc boundary (after phase 3, and after phase 6)? `/code-review` is off — run the codex loop per plan.md's Post-implementation (arc diff, plan.md, ledger, arc map, adversarial ask, both verbatim rules) until a round has nothing material; after arc 1's loop, `gh stack add lna-consent-sites` before phase 4.
7. **All phases ✓?** Run the final fresh cross-arc codex pass over the net diff from 8edbbca (seams between arcs, duplication across arcs, plan drift, both verbatim rules), same loop-until-clean. Then Delivery per plan.md: `gh stack sync`, `gh stack submit --auto`, `gh pr edit` both bodies (approved release order: merge both, then a `packages: all` release before the next playground deploy; arc 2 notes the automatic landing deploy; any unexercised CI lane named), `gh pr checks --watch`. Then the wrap-up report: what shipped, every contentious decision codex and I debated with ELI5 context, open items. Surface and stop.

Keep the task list current (TaskUpdate as steps start and finish); plan.md stays the source of truth.
```

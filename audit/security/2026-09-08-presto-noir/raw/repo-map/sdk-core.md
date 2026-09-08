# `packages/sdk-core` (`@alejoamiras/presto-core`) — Module Map

Repo: `alejoamiras/presto`, package root `packages/sdk-core/`.

## 1. Module inventory (`src/`)

| File | Purpose | LOC |
|---|---|---|
| `packages/sdk-core/src/index.ts` | Public barrel — re-exports the entire package surface. | 20 |
| `packages/sdk-core/src/lib/logger.ts` | One-line `@logtape/logtape` logger bound to category `["presto","core"]`. | 3 |
| `packages/sdk-core/src/lib/schemes.ts` | `PrestoScheme` union + the two scheme string constants (`chonk`, `ultra_honk`). | 8 |
| `packages/sdk-core/src/lib/base64.ts` | Standard padded base64 encode/decode; strict decoder that throws on bad alphabet/padding; uses native `Uint8Array.toBase64/fromBase64` when present, else `Buffer`, else manual chunked `btoa`/`atob`. | 36 |
| `packages/sdk-core/src/lib/errors.ts` | `PrestoHttpError` (the one typed error surfaced to callers) + `parseServerError` (recovers `{code, message}` from the presto's `text/plain` JSON-string or JSON error body). | 53 |
| `packages/sdk-core/src/lib/config.ts` | `resolvePrestoConfig` — turns a caller `PrestoConfig` into a fully-resolved config via explicit-option > `PRESTO_*` env > runtime default precedence; browser-runtime detection for the `httpsOnly` default. | 74 |
| `packages/sdk-core/src/lib/types.ts` | All shared types: `PrestoConfig`, `PrestoPhase`, `PrestoStatus` (discriminated union), `PrestoClientOptions`, `ProveRequest`, `ProveOutcome`, `FallbackReason`, `PRESTO_API_VERSION`, etc. | 239 |
| `packages/sdk-core/src/lib/presto-client.ts` | The policy layer: `PrestoClient` — health probing/caching, protocol/version classification, the `prove()` state machine, HTTP-error-to-fallback classification. | 555 |
| `packages/sdk-core/src/lib/presto-transport.ts` | The I/O layer: `PrestoTransport` — endpoint validation (`assertLoopbackHost`/`assertPort`/`assertFlag`), dual HTTP/HTTPS `/health` racing, bounded body readers, protocol pin/HTTPS-history state, the prove-route `post()`. | 1020 |
| `packages/sdk-core/src/lib/base64.test.ts` | Unit tests for base64. | 18 |
| `packages/sdk-core/src/lib/legacy-wire-compatibility.test.ts` | Wire-compatibility test against a fixture (see §7). | 58 |
| `packages/sdk-core/src/lib/public-contract.test.ts` | Doc-sync guard for the barrel/README/manifest. | 55 |
| `packages/sdk-core/src/lib/presto-client.test.ts` | Unit tests for `PrestoClient`. | 1163 |
| `packages/sdk-core/src/lib/presto-transport.test.ts` | Unit tests for `PrestoTransport`. | 1283 |

Total non-test source: 8 files, ~2008 LOC. Total including tests: 4585 LOC.

## 2. Entrypoints / public exports (`src/index.ts`, lines 1–21)

```
1  export { fromBase64, toBase64 } from "./lib/base64.js";
2  export { PrestoHttpError } from "./lib/errors.js";
3  export { PrestoClient } from "./lib/presto-client.js";
4  export type { PrestoScheme } from "./lib/schemes.js";
5  export { PRESTO_SCHEME_CHONK, PRESTO_SCHEME_ULTRA_HONK } from "./lib/schemes.js";
6-19 export type { FallbackReason, PrestoClientOptions, PrestoConfig, PrestoPhase,
      PrestoPhaseData, PrestoProtocol, PrestoStatus, PrestoStatusCheckOptions,
      PrestoVersionPair, ProveOutcome, ProveRequest, SecureConnectionDiagnosis }
      from "./lib/types.js";
20 export { PRESTO_API_VERSION } from "./lib/types.js";
```

- `PrestoClient` — the class every adapter (`@alejoamiras/presto`, `@alejoamiras/presto-noir`) instantiates; owns `configure()`, `setOnPhase()`, `checkStatus()`, `prove()`.
- `PrestoHttpError` — the one thrown error, for a genuine caller misconfiguration (see §6).
- `toBase64`/`fromBase64` — strict standard-base64 helpers for JSON prove routes.
- `PRESTO_SCHEME_CHONK` / `PRESTO_SCHEME_ULTRA_HONK` / `PrestoScheme` — scheme identifiers a route declares and the presto advertises via `/health.schemes`.
- `PRESTO_API_VERSION` (`= 1`) — the wire-contract version this client speaks; also used at runtime in `isRecognizedHealthBody`.
- Type-only exports: `PrestoConfig` (connection/policy knobs), `PrestoClientOptions` (ctor options), `PrestoPhase`/`PrestoPhaseData` (UI phase callback payloads), `PrestoStatus` (discriminated availability union), `PrestoStatusCheckOptions` (`forceRefresh`), `PrestoProtocol` (`"http"|"https"`), `SecureConnectionDiagnosis` (best-effort HTTPS-down diagnosis), `PrestoVersionPair`, `ProveRequest`/`ProveOutcome`, `FallbackReason`.

Note: `PrestoTransport` and `TransportHttpError` are deliberately **not** exported from the barrel (`presto-transport.ts:487-489` doc comment: "internal — it is **not** exported from the package barrel").

## 3. Trust boundaries

### Untrusted-data entry points
1. **`/health` HTTP response body** from the loopback presto (`presto-transport.ts`). Treated as fully untrusted wire data.
2. **`/prove` HTTP response body/headers** (success and error) from the loopback presto.
3. **Caller-supplied `PrestoConfig`** (`host`, `port`, `httpsPort`, `httpsOnly`, `allowInsecureDowngrade`) passed to the constructor or `configure()` — may originate from JSON/env/URL params, so types are not trusted at runtime.
4. **Caller-supplied `ProveRequest`** (`path`, `contentType`, `body()`, `scheme`, `responseCap`) passed to `prove()`.

### Validation present

- **Host validation** — `assertLoopbackHost` (`presto-transport.ts:92-130`): parses `host` through `new URL("http://" + literal)` (bracketing bare IPv6), rejects any value carrying a port, credentials, path, query, or fragment, and requires the normalised hostname to be `localhost`, `[::1]`, or `127.0.0.0/8` (`/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/`). Returns the *normalised* spelling (critical: raw `::1` would build `https://::1:59834` — ambiguous/broken).
- **Port validation** — `assertPort` (`presto-transport.ts:66-79`): must be `typeof === "number"`, integer, `1–65535`; rejects strings like `"80@evil.com"` that would otherwise smuggle credentials into the authority.
- **Boolean-flag validation** — `assertFlag` (`presto-transport.ts:81-90`): `httpsOnly`/`allowInsecureDowngrade` must be `typeof === "boolean"`; a truthy string like `"false"` is rejected rather than silently coerced.
- **All-or-nothing `configure()`** (`presto-transport.ts:536-592`): reads every property once up front (defends against getters with side effects), validates all fields into locals *before* mutating any state, so a rejected call changes nothing; only bumps `#generation`/resets HTTPS history when the endpoint actually moved (host/port/httpsPort), never on a pure policy-flag change.
- **Health-body shape checks** (`presto-transport.ts`):
  - `isRecognizedHealthBody` (line 262-266): the minimal contract, `status === "ok" && api_version === PRESTO_API_VERSION`.
  - `isValidHealthBody` (line 307-323): narrows every optional field's runtime type (`version`/`aztec_version` must be string, `available_versions`/`schemes` must be string arrays, `versions` must be `{aztec_version, bb_version}` string pairs via `isVersionPairArray` line 287-300, `bb_available` boolean, `https_port` integer 1–65535).
  - `isDetailedHealthBody` (line 330-340): stricter still, used only to produce a specific HTTPS diagnosis.
  - Consumed in `presto-client.ts` — `#probeAndParseHealth` (144-180) treats a non-OK response as `reason:"error"` and *keeps* any pin; an OK response failing `isValidHealthBody` also becomes `reason:"error"` but *clears* the pin (162-169); `#classifyHealth` (232-300) additionally narrows `data.version`/`data.api_version` at runtime before exposing them (237-239).
- **Response caps / timeouts** (`presto-transport.ts`):
  - `/health`: `HEALTH_PROBE_TIMEOUT_MS = 2000` (header deadline, line 8), `HEALTH_BODY_TIMEOUT_MS = 2000` + `HEALTH_BODY_MAX_BYTES = 64*1024` (body deadline+cap, lines 24-25).
  - `/prove`: `PROVE_TIMEOUT_MS = ms("10 min")` (header deadline, line 27), `PROVE_BODY_TIMEOUT_MS = ms("60 sec")` + `PROVE_BODY_MAX_BYTES = 8*1024*1024` (body deadline+cap, lines 49-50, derived/documented from chonk proof size, not sampled).
  - Bounded readers (`readStreamedText`/`readUnstreamedText`/`readTextBounded`/`readJsonBounded`, lines 351-475) enforce a byte cap with geometric buffer growth, cap empty-chunk spam (`MAX_EMPTY_STREAM_CHUNKS = 64`), and never use `response.clone()` (would tee an unbounded pending branch). `fetchHeaderBounded` (238-260) bounds only time-to-headers via `AbortController`, clearing the timer once headers land so the body-read budget is independent.
- **Redirect handling**: every `fetch` call passes `redirect: "error"` — `probeHealth`'s `fire()` (742-751), `diagnoseHttpHealth` (799-803), `isProtocolHealthy` (921-925), and `post()` (957-971) — explicitly because a 307/308 preserves method+body and could carry the request (or witness) off the validated endpoint.
- **Base64 strictness** — `fromBase64` (`base64.ts:20-36`): regex-validates alphabet and padding (`/^[A-Za-z0-9+/]*={0,2}$/` and length%4===0) before decoding, so a malformed server-provided base64 field throws rather than silently truncating; explicitly documented as *not* accepting the lenient inputs `Buffer` would.
- **Route-path assertion** — `assertRoutePath` (`presto-client.ts:56-62`): `request.path` must match `/^\/[A-Za-z0-9._~/-]*$/`; rejects anything that isn't a plain absolute path, because it's appended raw to a validated loopback authority (`1/prove` after `:3000` would target port `30001`; `?`/`#`/`@` would rewrite the URL).
- **Request snapshotting against TOCTOU** — `prove()` freezes the caller's request once at the top (`Snapshot`, `presto-client.ts:307-315`) so an `onPhase` callback mutating the original object mid-flight can't change the validated route; endpoint `generation` is captured before probing and re-checked after probe/before transmit (`presto-client.ts:322,333,385`) so a mid-flight `configure()` degrades to fallback (`"endpoint-changed"`) instead of sending the witness to an unprobed endpoint.
- **HTTPS-downgrade gating** — `allowsHttpDowngrade`/`#effectiveHttpsOnly`/`#httpsWasHealthy` (`presto-transport.ts:596-635`): once a healthy HTTPS presto has answered, HTTP is refused for `/prove` unless the caller explicitly opts in (`allowInsecureDowngrade`); before any plaintext retry, `isProtocolHealthy("http")` re-validates the HTTP port's health contract (`presto-client.ts:453`), since a healthy HTTPS says nothing about who's listening on the HTTP port.

### Where a private witness/body leaves the process (fetch calls)

All network I/O is `fetch`, confined to `presto-transport.ts`:

| Call site | Purpose | URL construction | Protocol | Notes |
|---|---|---|---|---|
| `probeHealth` → `fire()` (`presto-transport.ts:736-751`) | Dual `/health` race | `https://${host}:${httpsPort}/health` and `http://${host}:${port}/health` (line 737, 759) | HTTPS + HTTP (unless `#effectiveHttpsOnly`, then HTTPS-only, line 758) | No witness; `redirect:"error"`; header+body bounded. |
| `diagnoseHttpHealth` (`presto-transport.ts:792-826`) | Witness-free HTTP liveness diagnostic after an HTTPS failure | `http://${host}:${port}/health` (line 797) | HTTP only | Never commits status/pin, never leads to `/prove`; explicitly "witness-free". |
| `isProtocolHealthy` (`presto-transport.ts:911-931`) | Validate one protocol's health before a downgrade retry | `https://…/health` or `http://…/health` (916-919) | Either, explicit | Returns to false immediately if `protocol==="http"` and `#effectiveHttpsOnly`. |
| `post()` (`presto-transport.ts:950-995`) | **The prove POST — carries the private witness body** | `url ?? \`${this.baseUrl}${path}\`` (958); `baseUrl` getter (688-693) picks `https://${host}:${httpsPort}` when `#effectiveHttpsOnly || pinned https`, else `http://${host}:${port}` | HTTPS by default/pin; plaintext HTTP only via the explicit `httpRetryUrl` from `urlFor("http", …)` (`presto-client.ts:371`, gated on `allowsHttpDowngrade`) | Headers: `content-type: <request.contentType>` and, if `aztecVersion` is set, `x-aztec-version` (lines 965-967). `redirect:"error"`. Body is the raw serialized witness `Uint8Array`. |
| `#post` in `presto-client.ts:409-417` | Adapter-facing wrapper that calls `transport.post` with the attempt's snapshot URL | passes `attempt.url` or `attempt.httpRetryUrl` explicitly | as above | Called from `#proveRemote` (line 401) and `#retryOverHttp` (line 470) — the retry path is the one place a witness can legitimately go out over plaintext HTTP, and only after `demoteHttpsPin()` + `isProtocolHealthy("http")` succeed. |

No other outbound network calls exist in the package (no telemetry, no third-party requests) — everything targets the loopback presto only.

## 4. Dependency graph

**Internal imports (one level deep, non-test):**
- `index.ts` → `lib/base64.js`, `lib/errors.js`, `lib/presto-client.js`, `lib/schemes.js`, `lib/types.js`
- `lib/presto-client.ts` → `./config.js` (`resolvePrestoConfig`), `./errors.js` (`PrestoHttpError`, `parseServerError`), `./logger.js` (`logger`), `./presto-transport.js` (`isLoopbackPermissionDenied`, `isValidHealthBody`, `PrestoTransport`, `TransportHttpError`), `./schemes.js` (`PRESTO_SCHEME_CHONK`), `./types.js` (types only)
- `lib/presto-transport.ts` → `ms` (external), `./types.js` (`PrestoProtocol`, `PrestoStatus`, `SecureConnectionDiagnosis` types; `PRESTO_API_VERSION` value)
- `lib/config.ts` → `./types.js` (`PrestoConfig` type only)
- `lib/types.ts` → `./schemes.js` (`PrestoScheme` type only)
- `lib/errors.ts`, `lib/base64.ts`, `lib/schemes.ts`, `lib/logger.ts` → no internal imports (leaves), except `lib/logger.ts` → `@logtape/logtape`.

**External deps** (from `package.json`):
- `@logtape/logtape` (`^2.3.2`) — used solely in `lib/logger.ts` to construct the `["presto","core"]` category logger consumed by `presto-client.ts`.
- `ms` (`^2.1.3`) — used solely in `lib/presto-transport.ts` to express `PROVE_TIMEOUT_MS = ms("10 min")` and `PROVE_BODY_TIMEOUT_MS = ms("60 sec")`.
- Dev-only: `@types/ms`.

No `@aztec/*` dependency (intentional — README line 5-6 and enforced by `public-contract.test.ts:51-53`).

## 5. Frameworks in use

None beyond the platform `fetch`/`AbortController`/`ReadableStream`/`URL` Web APIs and Bun's built-in test runner (`bun:test`) for tests. No HTTP client library, no schema-validation library (validation is hand-written type guards), no DI/framework of any kind. Optional runtime-feature detection for `Uint8Array.prototype.toBase64`/`Uint8Array.fromBase64` (ES2025) and the experimental Local Network Access `targetAddressSpace`/`navigator.permissions` APIs, all with graceful fallbacks.

## 6. Test surfaces

| File | Coverage |
|---|---|
| `src/lib/base64.test.ts` | Round-trip encode/decode correctness against `Buffer`, and rejection of lenient/malformed base64 inputs. |
| `src/lib/legacy-wire-compatibility.test.ts` | End-to-end `PrestoTransport` against a real `Bun.serve` loopback server replaying the historical minimal/detailed `/health` and `/prove` wire shapes from a committed fixture, asserting forward compatibility. |
| `src/lib/public-contract.test.ts` | Doc-sync guard: barrel exports match runtime+type surface, README mentions key symbols, `package.json` is publishable plain-semver with no `@aztec/*` dependency. |
| `src/lib/presto-client.test.ts` (1163 lines) | `PrestoClient` behavior via mocked `fetch`: status caching/single-flight, health classification (available/needsDownload/version-mismatch/offline/permission-blocked/secure-connection-unavailable/error), `prove()` phase sequencing, scheme gating, endpoint-generation/TOCTOU protection, HTTP-error-to-`FallbackReason` classification (403/404/408/413/429/500/503), network-failure/HTTP-downgrade-retry behavior, malformed-response handling. |
| `src/lib/presto-transport.test.ts` (1283 lines) | `PrestoTransport` unit coverage: `baseUrl`/protocol negotiation, host/port/flag validation (`assertLoopbackHost`, `assertPort`, `assertFlag`), `configure()` all-or-nothing semantics and generation bumping, dual HTTP/HTTPS probe racing (`#probePreferHttps`) including grace-window and health-contract discrimination, bounded body reading (byte caps, deadlines, empty-chunk defense), redirect refusal, HTTPS-downgrade pin/history logic, `diagnoseHttpHealth` classification, `post()` error-body pre-read and content-type-based JSON vs. string parsing. |

Test-only dependency: `audit/fixtures/legacy-wire-contract.json` (repo root, outside the package) is imported by `legacy-wire-compatibility.test.ts:2` via a `../../../../` relative path.

## 7. Generated / vendored / fixture code

None inside `packages/sdk-core/src/`. Everything is hand-written first-party source. The one fixture the package's tests depend on, `audit/fixtures/legacy-wire-contract.json`, lives outside the package (at repo root under `audit/fixtures/`) and is explicitly documented as containing synthetic proof bytes, not vendored/generated artifacts (`"note": "Historical health shapes and transport envelope; proof bytes are synthetic, not a cryptographic proof."`). No build output (`dist/`) exists in the working tree currently.

---

## `FallbackReason` union (`src/lib/types.ts:201-223`)

```
201  export type FallbackReason =
203    | "unavailable"                    // presto offline, blocked, misbehaving, or incompatible legacy version
205    | "secure-connection-unavailable"  // browser policy forbids plaintext and HTTPS could not connect
207    | "scheme-unsupported"             // presto does not serve the route's scheme
209    | "endpoint-changed"               // configure() moved the endpoint while the request was in flight
211    | "network"                        // request never got an HTTP response (refused, TLS failure, timeout)
213    | "denied"                         // presto denied this origin (403)
215    | "cooldown"                       // a recent denial is still in cooldown (403 authorization_cooldown)
217    | "version-mismatch"               // presto refused this client's Aztec version (403 version_not_allowed)
219    | "route-missing"                  // presto answered 404: an app that predates this route
221    | "transient"                      // capacity condition the presto itself signalled (408/413/429/503, known 500s)
223    | "malformed-response";            // a 200 whose body was over the cap, stalled, or was not JSON
```

## HTTP status → reason table (`src/lib/presto-client.ts`, `#classifyHttpError`, lines 514-554)

| Status | Code | Reason / behavior | Line(s) |
|---|---|---|---|
| `403` | `version_not_allowed` | `fallback("version-mismatch", "version-mismatch")` | 519-524 |
| `403` | `authorization_cooldown` | `fallback("cooldown")` (no phase re-emitted) | 525-529 |
| `403` | anything else (`origin_denied`/`authorization_timeout`/`authorization_cancelled`/bare `denied`/no code) | `fallback("denied", "denied")` | 530-534 |
| `404` | any | `fallback("route-missing")` | 535-538 |
| `503` | any | `fallback("transient")` | 541-550 |
| `408` | any | `fallback("transient")` | 541-550 |
| `413` | any | `fallback("transient")` | 541-550 |
| `429` | any | `fallback("transient")` | 541-550 |
| `500` | `download_failed` or `prove_failed` | `fallback("transient")` | 541-550 |
| `400` | `invalid_version` / `invalid_origin` | throws `PrestoHttpError` (misconfiguration) | 551-553 |
| `500` | unrecognised code | throws `PrestoHttpError` | 551-553 |
| any other status | any | throws `PrestoHttpError` | 551-553 |

(`fallback()` helper defined at `presto-client.ts:64-67`.)

## `PrestoConfig` validation rules

`config.ts` itself does **not** perform value validation — it only *resolves* a caller `PrestoConfig` (`{host?, port?, httpsPort?, httpsOnly?, allowInsecureDowngrade?}`) into a fully-populated `ResolvedPrestoConfig`, with precedence **explicit option > `PRESTO_*` environment variable > runtime default** (`resolvePrestoConfig`, `config.ts:57-74`):

- `host` — `configured.host ?? DEFAULT_PRESTO_HOST` ("127.0.0.1"), no env override (`config.ts:60`).
- `port` — `configured.port ?? parsePort(env.PRESTO_PORT, 59833)`, where `parsePort` (`config.ts:50-54`) falls back silently to the default on `undefined` or `NaN`.
- `httpsPort` — `configured.httpsPort ?? parsePort(env.PRESTO_HTTPS_PORT, 59834)` (`config.ts:62-63`).
- `httpsOnly` — `resolveHttpsOnly(option, env, browserRuntime)` (`config.ts:23-29`): `option ?? parseOptionalBooleanEnv(env.PRESTO_HTTPS_ONLY) ?? isBrowserRuntime()`; `isBrowserRuntime()` (`config.ts:32-40`) is true for both a page (`window` defined) and a Worker (`instanceof WorkerGlobalScope`).
- `allowInsecureDowngrade` — `configured.allowInsecureDowngrade ?? parseOptionalBooleanEnv(env.PRESTO_ALLOW_INSECURE_DOWNGRADE) ?? false` (`config.ts:69-72`).
- `parseOptionalBooleanEnv` (`config.ts:8-20`) accepts only the spellings `"1"`/`"true"` → `true` and `"0"`/`"false"` → `false` (case-insensitive), returning `undefined` (fall through) for anything else.

The **actual runtime type/shape validation** of the resolved values happens one layer down, in `PrestoTransport` (`presto-transport.ts`), invoked from the `PrestoClient` constructor and `configure()`:
- `assertLoopbackHost(host)` (`presto-transport.ts:92-130`) — see §3.
- `assertPort(port, field)` / `assertPort(httpsPort, field)` (`presto-transport.ts:66-79`) — integer 1–65535.
- `assertFlag(httpsOnly, field)` / `assertFlag(allowInsecureDowngrade, field)` (`presto-transport.ts:81-90`) — strict boolean.

These run in the constructor (`presto-transport.ts:518-530`) and again, all-or-nothing, in `configure()` (`presto-transport.ts:536-592`).

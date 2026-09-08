# Cluster audit: `core-transport` (`@alejoamiras/presto-core`, `packages/sdk-core/src`)

Reviewer: Claude. Scope: `packages/sdk-core/src/lib/{presto-transport.ts, presto-client.ts, config.ts,
base64.ts, errors.ts, types.ts, schemes.ts}`, `packages/sdk-core/src/index.ts`, README, and the
handoff edges into `packages/sdk/src/lib/presto-prover.ts` and
`packages/sdk-noir/src/lib/presto-ultra-honk-backend.ts` (one function deep).

## Findings

None. This cluster is unusually well-hardened: nearly every failure mode named in the threat model
(redirect-based exfiltration, host/port/path smuggling, protocol downgrade, unbounded body reads, pin
poisoning by a local squatter) already has an explicit, commented defense with a doc comment
describing the exact attack it closes. Every adversarial path traced below either terminates in an
existing control that holds up under testing, or reduces to the two trust boundaries the brief marks
accepted (shape-based discovery, not authentication; a client-supplied VK can only spoil its own
proof). No new, concrete, in-cluster source-to-sink trace was found that violates confidentiality,
integrity, authorization, or availability beyond those boundaries. See below for the adversarial
checks performed, including one empirically fuzzed against Node's WHATWG URL parser (the same
algorithm browsers use for `fetch`).

## Non-findings considered

- **SSRF via `PrestoConfig.host` bypassing the loopback restriction** (`assertLoopbackHost`,
  `presto-transport.ts:92-130`). Fuzzed 16 host representations (trailing-dot IPv4 `"127.0.0.1."`,
  short-form `"127.1"`, hex `"0x7f000001"`, octal `"017700000001"`/`"0177.0.0.1"`, decimal
  `"2130706433"`, `"0"`, trailing-dot FQDN `"localhost."`, mixed-case `"LOCALHOST"`, embedded
  whitespace/tab) through Node's `URL` parser (identical algorithm to browser `fetch`). Every loopback
  spelling normalizes to `127.0.0.1`/`[::1]`/`localhost` and is correctly accepted (the code's claim
  that `URL` "canonicalises short IPv4 forms" holds); `"0"` normalizes to `"0.0.0.0"` and is correctly
  **rejected** (doesn't match `/^127\./`, not `localhost`/`[::1]`); `"localhost."` keeps its trailing
  dot and is correctly **rejected** (`"localhost." !== "localhost"`). No bypass found.
- **Header/CRLF injection** via attacker-influenced `PrestoClientOptions.aztecVersion` →
  `x-aztec-version` or `ProveRequest.contentType` → `content-type` (`presto-transport.ts:965-968`).
  The Fetch `Headers` algorithm (implemented identically by browsers, Node's undici, and Bun) rejects
  a header value containing `\0`/`\r`/`\n` with a `TypeError` before the request is dispatched — no
  reachable sink. (The one concrete producer of `aztecVersion` in the handoff edge,
  `resolveBbVersion` in `packages/sdk-noir/src/lib/tested-versions.ts:14-26`, additionally
  regex-anchors it to `^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$` before it ever reaches this cluster.)
- **Path traversal / authority smuggling via `ProveRequest.path`** (`assertRoutePath`,
  `presto-client.ts:56-62`, regex `/^\/[A-Za-z0-9._~/-]*$/`). `%`, `@`, and whitespace are outside the
  allowed charset, so percent-encoded traversal and credential/host smuggling in the path are rejected
  at construction. A `//`-prefixed path (e.g. `"//evil.com/prove"`) passes the regex but, once
  concatenated onto an already-fixed `scheme://host:port` string, resolves as an ordinary path
  segment — URL authority parsing only re-triggers on `//` immediately after the scheme colon, not
  mid-path — confirmed against the WHATWG URL algorithm; it cannot repoint the request off the
  validated loopback authority.
- **Port-based credential smuggling** (`"80@evil.com"` as a string `port`) — closed by `assertPort`
  (`presto-transport.ts:66-79`) requiring `typeof === "number"`; a numeric port cannot carry an `@`.
  `config.ts:50-54`'s `parsePort` (env-var path) always coerces via `Number.parseInt`, so even a
  partial parse (`"80abc"` → `80`) can only ever produce a numeric port, never a smuggled authority.
- **Prototype pollution via `/health` or `/prove` response JSON.** Every field is read through direct
  property access (`isValidHealthBody`/`isVersionPairArray`, `presto-transport.ts:307-323, 287-300`;
  `#classifyHealth`, `presto-client.ts:232-300`; `parseServerError`, `errors.ts:37-53`) — no
  `Object.assign`, spread-merge, or recursive-merge sink exists anywhere in the cluster.
- **Redirect-based witness exfiltration.** Every `fetch` call in the cluster passes `redirect:
  "error"`: `probeHealth`'s `fire()` (`presto-transport.ts:746`), `diagnoseHttpHealth`
  (`presto-transport.ts:801`), `isProtocolHealthy` (`presto-transport.ts:923`), and the prove `post()`
  (`presto-transport.ts:964`) — verified all four call sites explicitly, not just the ones with doc
  comments calling it out.
- **Unbounded memory/stream DoS from a malicious presto's response body.** `readStreamedText` /
  `appendStreamChunk` (`presto-transport.ts:394-457`) reject growth past `maxBytes` and cap empty
  chunks at `MAX_EMPTY_STREAM_CHUNKS = 64` (`presto-transport.ts:391, 399-401`); the header-only abort
  controller (`fetchHeaderBounded`, `presto-transport.ts:238-260`) is cleared once headers land so a
  slow-header attack can't shrink the independent body deadline.
- **`readUnstreamedText` buffers the full body before its length check** (`presto-transport.ts:365-378`,
  `response.text()` awaited in full, THEN measured against `maxBytes`) — this would defeat the cap if
  reached with an attacker-controlled unbounded body. But this fallback only runs when `response.body`
  is falsy, which does not occur for a body-bearing response in any runtime the package targets
  (browsers, Node ≥ 18, Bun all expose a streaming `.body` for a 200 with content). No concrete trigger
  in the supported target matrix — theoretical only, not flagged per the brief's negative list.
- **Base64 decode-time DoS/ReDoS** (`fromBase64`, `base64.ts:25-36`). The validating regex
  (`/^[A-Za-z0-9+\/]*={0,2}$/`) is a single bounded pass with no nested quantifiers — not vulnerable to
  catastrophic backtracking even on multi-MB inputs; padding-placement anchoring rejects mid-string
  `=` (e.g. `"AB=C"`), so malformed server-supplied base64 fails closed rather than decoding to a
  silently truncated key/proof.
- **TOCTOU between the HTTP-downgrade health check and the retried POST** (`#retryOverHttp`,
  `presto-client.ts:439-477`: `isProtocolHealthy("http")` at line 453, the retried `#post` at line
  470). A window exists in which a listener could be swapped in between the check and the witness POST.
  This reduces to the same "shape, not authentication" root cause as the accepted trust boundary
  (`presto-transport.ts:205-211, 624-635`) — no additional control inside this cluster would close it
  without adding authentication, which is out of scope here; not treated as a new, distinct finding.
- **Pin-poisoning race by a local port-squatter answering the health shape faster than the real
  presto** (`#probePreferHttps`, `presto-transport.ts:842-900`, `HTTPS_GRACE_MS = 250`). Confirmed this
  reduces to the same documented boundary; once HTTPS has been healthy once for the current endpoint,
  `#effectiveHttpsOnly` (`presto-transport.ts:605-607`) makes `probeHealth()` construct the HTTPS URL
  only (`presto-transport.ts:758`), so the HTTP squat is never even queried for the remainder of the
  session — the exposure window is bounded to "before first successful HTTPS probe," identical in kind
  to the documented risk, not a new path.
- **Sensitive-data logging.** Reviewed every `logger.*` call site in `presto-client.ts` (e.g. lines
  249, 276, 326, 374, 421, 428, 462, 490, 521, 531, 548) — none logs the witness body, the base64
  payload, or a raw header value; only URLs, HTTP status/reason codes, and server-supplied `code`/
  `message` strings (already bounded to 64 KB via the error-body pre-read, `presto-transport.ts:978`)
  are logged. Matches the brief's "cross-cutting observation only" carve-out, not a finding.
- **Scheme-check bypass via an omitted `ProveRequest.scheme`** (`presto-client.ts:339`,
  `if (request.scheme && !served.includes(request.scheme))`). Both in-cluster adapters
  (`presto-prover.ts:165`, `presto-ultra-honk-backend.ts:129`) always pass a scheme; an omitted scheme
  is documented, intentional behavior for a version-agnostic route (`types.ts:191-195`), not an
  attacker-reachable gap in this cluster.
- **`PrestoClient`/`PrestoTransport` accepting a caller-controlled non-default `port`/`host` that
  happens to point at another local service.** Traced as far as: an attacker who can supply a hostile
  `PrestoConfig` to the constructor is either the dApp author itself (first-party trust) or a
  compromised dependency running in the same JS realm — in a browser, such code cannot bind a
  loopback listener itself; in Node/Bun/SSR, a dependency with arbitrary code execution in-process
  already has strictly greater capability than redirecting this client's requests. No escalation beyond
  the caller's own compromise; reduces to the accepted "same-user malware is out of scope" boundary.

## Out of cluster

- One-function-deep read of the handoff edges (`packages/sdk/src/lib/presto-prover.ts:153-183`,
  `packages/sdk-noir/src/lib/presto-ultra-honk-backend.ts:119-144`) shows both adapters call `prove()`
  with a hardcoded `path`/`contentType`/`scheme` (never derived from page/network input) and route the
  response through a documented structural decoder (`decodeChonkProof`, `decodeUltraHonkResponse`)
  before trusting any field — consistent with this cluster's assumption that callers validate
  `outcome.body` themselves. Nothing serious observed; full adapter review is out of this cluster's
  scope.

## Cross-rebuttal

**(1) What Codex's report missed.** Codex's non-findings cite validation controls by line number
without stress-testing them; mine tested several to failure and Codex's list omits them: host-bypass
fuzzing of 16 alternate loopback encodings against the actual WHATWG `URL` parser (hex/octal/decimal
IPv4, trailing-dot forms) — Codex's "Non-loopback URL injection" entry cites `presto-transport.ts:92`
but doesn't test it; header/CRLF injection via `x-aztec-version`/`content-type` (not examined at all);
the `//`-prefixed route-path authority-parsing edge case in `assertRoutePath`; base64 padding/ReDoS
behavior; prototype-pollution sinks; and the unbounded-buffer-before-cap pattern in
`readUnstreamedText` (`presto-transport.ts:365-378`, theoretical-only, same conclusion I reached).
None of these change either report's findings, but Codex's coverage of the input-validation layer is
shallower than the concurrency/ordering layer where their two findings live.

**(2) Verification of Codex's findings.**

**F-1 (concurrent proof bypasses HTTP endpoint validation): VERIFIED, high confidence, NEW boundary
(not the accepted shape-based one).** Independently re-traced against source, line by line:
`demoteHttpsPin()` (`presto-transport.ts:648-653`) clears `#protocol` and `#statusCache` but never
touches `#generation` — confirmed, only `configure()` (`presto-transport.ts:591`) bumps it. `baseUrl`
(`presto-transport.ts:688-693`) is a *live* getter re-read at `presto-client.ts:364` on every call,
decoupled from whatever `protocol` a concurrent `prove()`'s own `checkStatus()` observed. So a second,
concurrent `prove()` (B) that already passed its `available`/generation checks (lines 323, 333) reads
`baseUrl` fresh at line 364 and gets HTTP the instant a *different* in-flight proof (A) clears the pin
via `demoteHttpsPin()` — and B never itself calls `isProtocolHealthy("http")`. This is reachable under
the documented, supported `{httpsOnly:false, allowInsecureDowngrade:true}` combo (`types.ts:47-60`)
via either shipped adapter, since both allow overlapping `prove()`/`generateProof()` calls on one
instance (`presto-prover.ts:162`, `presto-ultra-honk-backend.ts:126` — nothing serializes them). It is
**strictly worse** than the accepted "shape, not authentication" boundary: B's HTTP request skips even
the shape check, so a listener that fails the health contract (Codex's `{"hello":"not presto"}`
example) still receives the witness. Codex's own point 9 already notes this distinction correctly.

**F-2 (payload iterator bypasses HTTPS-only): VERIFIED, mechanism confirmed empirically.** I isolated
and ran the core JS-semantics claim outside the sandboxed repo (`Uint8Array.from(x)` on an object with
an *own* `Symbol.iterator` — even one that already looks like a real `Uint8Array` — invokes that
iterator, not a fast-path copy): confirmed true for both a real `Uint8Array` with an overridden own
`[Symbol.iterator]` and a plain iterable object. Cross-checked against source: `payload =
Uint8Array.from(payload)` at `presto-client.ts:396` runs *after* the generation re-check at line 385,
and the `url` passed into `#post` (line 401 → `transport.post(..., url)`) was captured at line 364
*before* that — `transport.post()` (`presto-transport.ts:958`) uses the explicit `url` argument
verbatim, never re-consulting the now-changed `baseUrl`. So a caller-controlled `body()` returning an
iterable whose iterator calls `configure({httpsOnly:true})` mid-copy sends over the stale HTTP URL
despite the policy having flipped. Reachability is narrower than F-1: reaching it requires direct use
of the public `PrestoClient`/`ProveRequest` API with a custom iterable payload (Codex's own precondition
#8) — neither shipped adapter does this — so it's the "hostile dApp author/dependency supplying a
hostile `ProveRequest`" persona from the brief's threat model, not attacker-reachable through either
production adapter as shipped today.

**(3) Revisions to my own report.** Both of Codex's findings survive because they exploit a dimension I
did not stress: **shared mutable transport state across concurrent `prove()` calls on one client
instance**, and **caller-controlled code execution during payload *realization*** (as opposed to the
`body()` call itself, which the line-385 generation check does cover). My non-findings all implicitly
assumed one in-flight request per client at a time; I did not test overlapping `prove()` calls, which
is exactly F-1's precondition, nor did I consider that `Uint8Array.from` re-enters caller code after the
last policy check, which is F-2's. I am adding no new findings of my own (I did not independently
discover either before reading Codex's report), and I do not dispute or downgrade either — both traces
check out against the current source and neither collapses into the accepted, documented trust
boundary. My existing non-findings (TOCTOU in `#retryOverHttp`, `HTTPS_GRACE_MS` pin-poisoning race)
remain distinct from F-1: those concern a single proof's own sequential flow, not state leaking between
concurrent proofs sharing one instance.

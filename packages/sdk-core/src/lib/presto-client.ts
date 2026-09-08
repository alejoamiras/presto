import { resolvePrestoConfig } from "./config.js";
import { PrestoHttpError, parseServerError } from "./errors.js";
import { logger } from "./logger.js";
import {
  isLoopbackPermissionDenied,
  isValidHealthBody,
  PrestoTransport,
  TransportHttpError,
} from "./presto-transport.js";
import { PRESTO_SCHEME_CHONK } from "./schemes.js";
import type {
  PrestoClientOptions,
  PrestoConfig,
  PrestoPhase,
  PrestoPhaseData,
  PrestoProtocol,
  PrestoStatus,
  PrestoStatusCheckOptions,
  ProveOutcome,
  ProveRequest,
} from "./types.js";

type OnPhase = (phase: PrestoPhase, data?: PrestoPhaseData) => void;

/** The parsed, shape-checked `/health` body (`isValidHealthBody` narrows every field used here). */
interface HealthData {
  aztec_version?: string;
  available_versions?: string[];
  schemes?: string[];
  versions?: Array<{ aztec_version: string; bb_version: string }>;
  version?: unknown;
  api_version?: unknown;
}

/**
 * The caller's request read ONCE, at the top of `prove`: a getter, or an `onPhase` handler that
 * mutates the object, could otherwise change the route after it was validated.
 */
type Snapshot = Readonly<ProveRequest>;

/** Everything one prove attempt needs, snapshotted before any `onPhase` callback can reconfigure. */
interface Attempt {
  request: Snapshot;
  generation: number;
  url: string;
  wasHttps: boolean;
  httpRetryUrl: string | null;
  payload: Uint8Array<ArrayBuffer>;
  startedAt: number;
}

/**
 * The route is appended to a validated loopback authority; anything that is not a plain absolute
 * path would extend it (`1/prove` after `:3000` targets port 30001, `?`/`#`/`@` rewrite the URL).
 */
export function assertRoutePath(path: string): void {
  if (typeof path !== "string" || !/^\/[A-Za-z0-9._~/-]*$/.test(path)) {
    throw new Error(
      `Invalid presto route ${JSON.stringify(path)}: expected a plain absolute path.`,
    );
  }
}

const fallback = (
  reason: Extract<ProveOutcome, { kind: "fallback" }>["reason"],
  phase?: Extract<ProveOutcome, { kind: "fallback" }>["phase"],
): ProveOutcome => (phase ? { kind: "fallback", reason, phase } : { kind: "fallback", reason });

/**
 * The policy layer every Presto adapter shares: find the local presto over a validated loopback
 * endpoint, negotiate and pin the protocol, cache its status, and run one prove request under the
 * transport-security rules (HTTPS by default in browsers, never downgrade a working HTTPS, never
 * hand a witness to an endpoint that was not itself probed). Adapters serialize the request body
 * and decode the success body; everything in between lives here.
 *
 * `prove` never throws for a condition the presto itself signalled: those come back as
 * `{ kind: "fallback" }` so the adapter can run its local prover. Only a caller misconfiguration
 * (`400`, an unrecognised `500`, an unexpected status) throws {@link PrestoHttpError}.
 */
export class PrestoClient {
  #onPhase: OnPhase | null;
  /** Owns endpoint URLs, protocol negotiation, the status cache, and all HTTP I/O. */
  #transport: PrestoTransport;
  #aztecVersion: string | undefined;
  /** The in-flight `/health` probe, keyed to the transport generation it was started against. */
  #inflightProbe: { gen: number; promise: Promise<PrestoStatus> } | null = null;

  constructor(options: PrestoClientOptions = {}) {
    this.#onPhase = options.onPhase ?? null;
    this.#aztecVersion = options.aztecVersion;
    const config = resolvePrestoConfig(options.presto);
    this.#transport = new PrestoTransport(
      config.host,
      config.port,
      config.httpsPort,
      config.httpsOnly,
      config.allowInsecureDowngrade,
    );
  }

  /** Configure the local endpoint or transport policy. Resets cached protocol + status. */
  configure(config: PrestoConfig): void {
    this.#transport.configure(config);
  }

  /** Register a callback for proof generation sub-phase transitions (for UI animation). */
  setOnPhase(callback: OnPhase | null): void {
    this.#onPhase = callback;
  }

  /**
   * Probe the local presto's `/health` endpoint and return its status.
   *
   * Single-flight: concurrent callers share one in-flight probe (per configuration generation), so
   * overlapping health checks can't race each other's pin commits.
   */
  async checkStatus(options?: PrestoStatusCheckOptions): Promise<PrestoStatus> {
    // Reuse an in-flight probe ONLY if it targets the current endpoint configuration. This check is
    // deliberately before the cache so an ordinary caller also joins a force-refresh already in
    // progress instead of observing the stale value it is replacing.
    const gen = this.#transport.generation;
    if (this.#inflightProbe && this.#inflightProbe.gen === gen) {
      return this.#inflightProbe.promise;
    }
    // A forced refresh bypasses only the settled status cache. It does not configure/reset transport
    // state, change the generation, clear the protocol pin, or erase HTTPS downgrade history.
    if (!options?.forceRefresh) {
      const cached = this.#transport.getFreshCachedStatus();
      if (cached) return cached;
    }
    const promise = this.#probeAndParseHealth(gen).finally(() => {
      if (this.#inflightProbe?.promise === promise) this.#inflightProbe = null;
    });
    this.#inflightProbe = { gen, promise };
    return promise;
  }

  /**
   * Probe `/health` (runtime policy selects HTTPS-only or dual transport, one startup retry) and
   * parse the result into a {@link PrestoStatus}, caching it. `gen` is the configuration generation
   * this probe was started against — every commit passes it, so a probe that raced a `configure`
   * cannot pin/cache against the NEW endpoint.
   */
  async #probeAndParseHealth(gen: number): Promise<PrestoStatus> {
    const sdkAztecVersion = this.#aztecVersion;
    try {
      // The transport already read the body ONCE, bounded (deadline + byte cap) — use `body`, never
      // `response.json()`.
      const { response, protocol, body } = await this.#transport.probeHealth();

      if (!response.ok) {
        // Non-OK → KEEP any existing pin. A fast error (e.g. an HTTPS cert failure) must not pin the
        // wrong protocol for proving, nor clear an already-good pin.
        return this.#transport.commitStatus(
          { available: false, reason: "error", sdkAztecVersion, protocol },
          { pin: "keep" },
          gen,
        );
      }
      // Reachable but not the presto's health contract (unparseable, stalled-body, or a
      // foreign/malformed JSON shape — enforced in BOTH normal and httpsOnly modes): "error", NOT
      // "offline". CLEAR the pin — a misbehaving responder must not drive proving.
      if (!isValidHealthBody(body)) {
        return this.#transport.commitStatus(
          { available: false, reason: "error", sdkAztecVersion, protocol },
          { pin: "clear" },
          gen,
        );
      }
      // A reachable, recognized /health always pins the winning protocol (`set`); only the
      // available/needsDownload/mismatch shape varies.
      return this.#transport.commitStatus(
        this.#classifyHealth(body as HealthData, protocol),
        { pin: "set", protocol },
        gen,
      );
    } catch (error) {
      return this.#classifyProbeFailure(error, gen);
    }
  }

  async #classifyProbeFailure(error: unknown, gen: number): Promise<PrestoStatus> {
    const sdkAztecVersion = this.#aztecVersion;
    const blocked: PrestoStatus = {
      available: false,
      reason: "permission-blocked",
      sdkAztecVersion,
    };
    if (isLoopbackPermissionDenied(error)) {
      // Permission says nothing about endpoint identity or health. Cache the result under the normal
      // TTL, but KEEP any prior protocol pin and HTTPS history so Retry cannot weaken transport.
      return this.#transport.commitStatus(blocked, { pin: "keep" }, gen);
    }
    if (!this.#transport.requiresSecureConnection) {
      // Both probes failed without a conclusive permission denial → offline; CLEAR the pin.
      return this.#transport.commitStatus(
        { available: false, reason: "offline", sdkAztecVersion },
        { pin: "clear" },
        gen,
      );
    }
    // The diagnostic is informational only: KEEP the existing HTTPS pin/history, and never turn its
    // recognized HTTP response into availability or proof eligibility.
    let diagnosis: PrestoStatus & { available: false; reason: "secure-connection-unavailable" };
    try {
      diagnosis = {
        available: false,
        reason: "secure-connection-unavailable",
        diagnosis: await this.#transport.diagnoseHttpHealth(gen),
        sdkAztecVersion,
      };
    } catch (diagnosticError) {
      if (isLoopbackPermissionDenied(diagnosticError)) {
        return this.#transport.commitStatus(blocked, { pin: "keep" }, gen);
      }
      // The transport normally reduces diagnostic failures to `unconfirmed`; retain the safe
      // classification if an unexpected platform error crosses that boundary.
      diagnosis = {
        available: false,
        reason: "secure-connection-unavailable",
        diagnosis: "unconfirmed",
        sdkAztecVersion,
      };
    }
    return this.#transport.commitStatus(diagnosis, { pin: "keep" }, gen);
  }

  /**
   * Pure version policy: classify a parsed `/health` body into the available / needs-download /
   * version-mismatch status. No I/O, no caching, no protocol pinning (the caller owns those).
   */
  #classifyHealth(data: HealthData, protocol: PrestoProtocol): PrestoStatus {
    const sdkAztecVersion = this.#aztecVersion;
    const nativeAztecVersion = data.aztec_version;
    const availableVersions = data.available_versions;
    // The body is untrusted wire data, so NARROW at runtime: `{version: 42}` must not leak a number
    // through the `appVersion?: string` contract.
    const appVersion = typeof data.version === "string" ? data.version : undefined;
    const apiVersion = typeof data.api_version === "number" ? data.api_version : undefined;
    const schemes = data.schemes;
    const versions = data.versions?.map((pair) => ({
      aztecVersion: pair.aztec_version,
      bbVersion: pair.bb_version,
    }));

    // New multi-version protocol: the client's version just needs to be in the cached set.
    if (availableVersions) {
      const needsDownload = sdkAztecVersion ? !availableVersions.includes(sdkAztecVersion) : false;
      logger.info("Multi-version health check", {
        sdkAztecVersion,
        availableVersions,
        needsDownload,
        protocol,
      });
      return {
        available: true,
        needsDownload,
        nativeAztecVersion,
        availableVersions,
        sdkAztecVersion,
        appVersion,
        apiVersion,
        schemes,
        versions,
        protocol,
      };
    }

    // Legacy single-version protocol: exact match required (a known presto version that differs).
    if (
      nativeAztecVersion &&
      nativeAztecVersion !== "unknown" &&
      sdkAztecVersion &&
      nativeAztecVersion !== sdkAztecVersion
    ) {
      logger.warn("Presto Aztec version mismatch", {
        presto: nativeAztecVersion,
        sdk: sdkAztecVersion,
      });
      return {
        available: false,
        reason: "version-mismatch",
        nativeAztecVersion,
        sdkAztecVersion,
        protocol,
      };
    }

    return {
      available: true,
      needsDownload: false,
      nativeAztecVersion,
      sdkAztecVersion,
      appVersion,
      apiVersion,
      schemes,
      versions,
      protocol,
    };
  }

  /**
   * Run one prove request: `detect` (probe or cached status), then serialize, transmit, and read the
   * success body under the request's cap. Every condition the presto itself signals comes back as a
   * fallback outcome; see {@link ProveOutcome}.
   */
  async prove(caller: ProveRequest): Promise<ProveOutcome> {
    const request: Snapshot = Object.freeze({
      path: caller.path,
      contentType: caller.contentType,
      body: caller.body,
      scheme: caller.scheme,
      responseCap: caller.responseCap,
    });
    assertRoutePath(request.path);
    // Capture the endpoint generation immediately BEFORE probing — but AFTER the "detect" callback,
    // so a handler that synchronously reconfigures there is honoured (the probe then targets the NEW
    // endpoint). A probe that started against A and completes after `configure(B)` has its pin/cache
    // commit discarded but still RETURNS `available: true`; proving on that basis would POST the
    // witness to the never-probed B, so re-check after the probe and degrade if it moved.
    this.#onPhase?.("detect");
    const detectGen = this.#transport.generation;
    const status = await this.checkStatus();

    if (!status.available) {
      logger.info("Presto not available, falling back", { reason: status.reason });
      if (status.reason === "secure-connection-unavailable") {
        this.#onPhase?.("secure-connection-unavailable");
        return fallback("secure-connection-unavailable", "secure-connection-unavailable");
      }
      return fallback("unavailable");
    }
    if (this.#transport.generation !== detectGen) {
      logger.info("Endpoint reconfigured during detection; falling back (unprobed endpoint)");
      return fallback("endpoint-changed");
    }
    // An app that predates `schemes` serves chonk only.
    const served = status.schemes ?? [PRESTO_SCHEME_CHONK];
    if (request.scheme && !served.includes(request.scheme)) {
      logger.warn("Presto does not serve this scheme, falling back", {
        scheme: request.scheme,
        served,
      });
      this.#onPhase?.("version-mismatch");
      return fallback("scheme-unsupported", "version-mismatch");
    }
    if (status.needsDownload) {
      logger.info("Presto needs to download bb for this version");
      this.#onPhase?.("downloading");
    }
    return this.#proveRemote(request, detectGen);
  }

  /**
   * The native proving path — serialize, POST, read. A NETWORK-level failure (no HTTP response at
   * all — TLS/refused/timeout) retries once over HTTP only when plaintext proving was explicitly
   * permitted; otherwise it degrades and the witness never goes plaintext. Recognized HTTP-level
   * failures also degrade, while misconfiguration/unexpected responses become the typed error.
   */
  async #proveRemote(request: Snapshot, attemptGen: number): Promise<ProveOutcome> {
    // Endpoint snapshot taken BEFORE any `onPhase` callback runs: a dApp's handler may call
    // `configure(B)` between here and the POST, and the witness must never reach an unprobed B.
    // Every POST below uses these snapshots.
    const url = `${this.#transport.baseUrl}${request.path}`;
    const wasHttps = url.startsWith("https:");
    // Only snapshot the HTTP PROOF-retry target when plaintext proving is permitted — gated on the
    // EFFECTIVE policy, not the raw `httpsOnly` flag: once HTTPS has proven healthy here the
    // downgrade is refused too.
    const httpRetryUrl =
      wasHttps && this.#transport.allowsHttpDowngrade
        ? this.#transport.urlFor("http", request.path)
        : null;

    logger.info("Presto available, proving natively", { url });

    this.#onPhase?.("serialize");
    const payload = request.body();
    this.#onPhase?.("transmit");
    this.#onPhase?.("proving");

    // A callback above may have reconfigured the endpoint. The snapshot URL still points at the
    // PROBED endpoint (correct), but that endpoint is no longer the configured one — the caller asked
    // us to talk to B, and A was never re-validated. Degrade rather than send the witness to either
    // an abandoned or an unprobed endpoint.
    if (this.#transport.generation !== attemptGen) {
      logger.info("Endpoint reconfigured before transmit; falling back");
      return fallback("endpoint-changed");
    }

    const attempt: Attempt = {
      request,
      generation: attemptGen,
      url,
      wasHttps,
      httpRetryUrl,
      payload: Uint8Array.from(payload),
      startedAt: performance.now(),
    };
    let response: Response;
    try {
      response = await this.#post(attempt, attempt.url);
    } catch (error) {
      if (error instanceof TransportHttpError) return this.#classifyHttpError(error);
      return this.#recoverFromNetworkFailure(error, attempt);
    }
    return this.#readOutcome(response, attempt);
  }

  #post(attempt: Attempt, url: string): Promise<Response> {
    return this.#transport.post(
      attempt.request.path,
      attempt.payload,
      attempt.request.contentType,
      this.#aztecVersion,
      url,
    );
  }

  async #recoverFromNetworkFailure(error: unknown, attempt: Attempt): Promise<ProveOutcome> {
    if (this.#transport.generation !== attempt.generation) {
      logger.warn("Endpoint reconfigured during a failing proof; falling back", {
        error: String(error),
      });
      return fallback("endpoint-changed");
    }
    if (attempt.httpRetryUrl) return this.#retryOverHttp(error, attempt);

    logger.warn("Presto prove request failed at the network layer, falling back", {
      error: String(error),
      httpsOnly: this.#transport.httpsOnly,
    });
    if (attempt.wasHttps && this.#transport.requiresSecureConnection) {
      this.#onPhase?.("secure-connection-unavailable");
      return fallback("network", "secure-connection-unavailable");
    }
    return fallback("network");
  }

  async #retryOverHttp(originalError: unknown, attempt: Attempt): Promise<ProveOutcome> {
    const retryUrl = attempt.httpRetryUrl;
    if (!retryUrl || !this.#transport.allowsHttpDowngrade) {
      logger.warn(
        "HTTPS prove request failed, but this presto was reachable over HTTPS — refusing to " +
          "retry over plaintext HTTP; falling back. Set `presto.allowInsecureDowngrade` (or " +
          "PRESTO_ALLOW_INSECURE_DOWNGRADE=1) to allow it.",
      );
      return fallback("network");
    }

    this.#transport.demoteHttpsPin();
    // The health shape is not authentication, but explicit downgrade consent still requires proving
    // that the plaintext port speaks Presto before it receives the witness.
    const httpIsOurs = await this.#transport.isProtocolHealthy("http");
    if (!httpIsOurs || this.#transport.generation !== attempt.generation) {
      logger.warn(
        "HTTPS prove request failed, but the HTTP endpoint did not answer the presto's health " +
          "contract — refusing to downgrade; falling back",
      );
      return fallback("network");
    }

    logger.warn(
      "HTTPS prove request failed at the network layer; retrying once over validated HTTP",
      {
        error: String(originalError),
      },
    );
    let response: Response;
    try {
      response = await this.#post(attempt, retryUrl);
    } catch (error) {
      if (error instanceof TransportHttpError) return this.#classifyHttpError(error);
      logger.warn("HTTP retry failed at the network layer, falling back", { error: String(error) });
      return fallback("network");
    }
    return this.#readOutcome(response, attempt);
  }

  /**
   * Emit `"proved"` (the server's authoritative `x-prove-duration-ms` if present, else the
   * client-measured round-trip — so the UI never hangs on `"proving"`), then read the body under the
   * request's cap and emit `"receive"`.
   */
  async #readOutcome(response: Response, attempt: Attempt): Promise<ProveOutcome> {
    const serverMs = Number(response.headers.get("x-prove-duration-ms"));
    const durationMs =
      Number.isFinite(serverMs) && serverMs > 0
        ? serverMs
        : Math.round(performance.now() - attempt.startedAt);
    logger.info("Presto proof completed", { durationMs });
    this.#onPhase?.("proved", { durationMs });

    const body = await this.#transport.readJsonBody(response, attempt.request.responseCap);
    if (body === undefined) {
      // Nothing about a 200 with an unreadable body says the local prover can't finish the proof.
      logger.warn("Presto returned a body that could not be read (over cap, stalled, or not JSON)");
      return fallback("malformed-response");
    }
    this.#onPhase?.("receive");
    return { kind: "native", body, durationMs };
  }

  /**
   * Classify an HTTP error the presto returned and either degrade or throw {@link PrestoHttpError}.
   * The presto is an optimisation, so the degrade set is matched BY STATUS — EVERY `403` (denial /
   * version / cooldown), EVERY `408`/`413`/`429`/`503`, `500 download_failed`/`prove_failed`, and a
   * `404` (an app that predates the route) — all fall back regardless of `code`. Only a `400`
   * MISCONFIGURATION (`invalid_version` / `invalid_origin`), a `500` with an unrecognised code, or an
   * unexpected status throws — masking those as "slow but working" would hide a real integration bug.
   *
   * The server sends its error body as `text/plain` carrying a JSON string, so the stable `code` is
   * recovered via {@link parseServerError} (a JSON content-type gives an object; both are handled).
   */
  #classifyHttpError(error: TransportHttpError): ProveOutcome {
    const status = error.response.status;
    const { code, message } = parseServerError(error.data);

    if (status === 403) {
      if (code === "version_not_allowed") {
        // Distinct from a user/origin denial: the UI can say "update the presto".
        logger.warn("Presto refused this client's Aztec version, falling back", { code });
        this.#onPhase?.("version-mismatch");
        return fallback("version-mismatch", "version-mismatch");
      }
      if (code === "authorization_cooldown") {
        // Not a fresh prompt, so do NOT re-emit "denied" — just degrade quietly.
        logger.warn("Presto is in an authorization cooldown, falling back", { code });
        return fallback("cooldown");
      }
      // origin_denied / authorization_timeout / authorization_cancelled / a bare "denied" / no code.
      logger.warn("Presto denied this origin, falling back", { code, message });
      this.#onPhase?.("denied");
      return fallback("denied", "denied");
    }
    if (status === 404) {
      logger.warn("Presto does not serve this route, falling back", { code });
      return fallback("route-missing");
    }
    // 503 (shutting down / version-evicting), 408 (body_read_timeout), 413 (payload_too_large),
    // 429 (too_many_requests / prove_queue_full / origin_queue_full), and 500 with a RECOGNISED code.
    if (
      status === 503 ||
      status === 408 ||
      status === 413 ||
      status === 429 ||
      (status === 500 && (code === "download_failed" || code === "prove_failed"))
    ) {
      logger.warn("Presto could not serve this proof, falling back", { status, code });
      return fallback("transient");
    }
    // 400 invalid_version / invalid_origin (the client is misconfigured for this presto), or ANY
    // other status/code not recognised. Surface it typed — never mask a misconfiguration.
    throw new PrestoHttpError(status, code, message);
  }
}

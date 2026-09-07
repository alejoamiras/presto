import { BBLazyPrivateKernelProver } from "@aztec/bb-prover/client/lazy";
import type { CircuitSimulator } from "@aztec/simulator/client";
import { type PrivateExecutionStep, serializePrivateExecutionSteps } from "@aztec/stdlib/kernel";
import { ChonkProofWithPublicInputs } from "@aztec/stdlib/proofs";
import sdkPkg from "../../package.json" with { type: "json" };
import { PrestoHttpError, parseServerError } from "./errors.js";
import { logger } from "./logger.js";
import {
  isLoopbackPermissionDenied,
  isValidHealthBody,
  PrestoTransport,
  TransportHttpError,
} from "./presto-transport.js";
// q7e3-F-02: published types now live in ./types.ts (a neutral module); index.ts re-exports them.
import type {
  PrestoConfig,
  PrestoPhase,
  PrestoPhaseData,
  PrestoProtocol,
  PrestoProverOptions,
  PrestoStatus,
  PrestoStatusCheckOptions,
} from "./types.js";

/**
 * Create a lazy-loading proxy for CircuitSimulator that dynamically imports
 * `@aztec/simulator/client` on first method call. This avoids adding
 * `@aztec/simulator` as a runtime dependency of the SDK.
 */
function createLazySimulator(): CircuitSimulator {
  let instance: CircuitSimulator | null = null;
  let loading: Promise<CircuitSimulator> | null = null;

  async function getInstance(): Promise<CircuitSimulator> {
    if (instance) return instance;
    if (!loading) {
      loading = import("@aztec/simulator/client")
        .then((mod) => {
          instance = new mod.WASMSimulator();
          return instance;
        })
        .catch(() => {
          loading = null;
          throw new Error(
            "No simulator provided and @aztec/simulator/client could not be loaded. " +
              "Install @aztec/simulator or pass a simulator in the constructor options.",
          );
        });
    }
    return loading;
  }

  // Return a proxy that forwards all property access to the lazy-loaded instance.
  return new Proxy({} as CircuitSimulator, {
    get(_target, prop) {
      // Do NOT make the proxy thenable or hijack symbol-keyed protocols: if `then`
      // (or any symbol like Symbol.iterator/toPrimitive) resolved to a forwarding
      // function, `await proxy` or a promise-probe would treat the proxy as a broken
      // thenable and could hang. Methods are string-keyed, so this is safe.
      if (prop === "then" || typeof prop === "symbol") return undefined;
      // Otherwise return an async function that loads the simulator then delegates.
      return async (...args: unknown[]) => {
        const sim = await getInstance();
        return (sim as any)[prop](...args);
      };
    },
  });
}

const DEFAULT_PRESTO_PORT = 59833;
const DEFAULT_PRESTO_HTTPS_PORT = 59834;
const DEFAULT_PRESTO_HOST = "127.0.0.1";

/** Parse the documented boolean environment spellings without weakening the browser-safe default. */
function parseOptionalBooleanEnv(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  switch (value.toLowerCase()) {
    case "1":
    case "true":
      return true;
    case "0":
    case "false":
      return false;
    default:
      return undefined;
  }
}

/**
 * Resolve HTTPS policy with explicit option > environment > runtime default precedence.
 * Exported from this internal module for table-driven tests; it is not part of the package barrel.
 */
export function resolveHttpsOnly(
  option: boolean | undefined,
  environment: string | undefined,
  browserRuntime: boolean,
): boolean {
  return option ?? parseOptionalBooleanEnv(environment) ?? browserRuntime;
}

export function isBrowserRuntime(): boolean {
  if (typeof window !== "undefined") return true;
  const workerGlobalScope = (
    globalThis as typeof globalThis & {
      WorkerGlobalScope?: { new (...args: never[]): object };
    }
  ).WorkerGlobalScope;
  return typeof workerGlobalScope === "function" && globalThis instanceof workerGlobalScope;
}

interface ResolvedPrestoConfig {
  host: string;
  port: number;
  httpsPort: number;
  httpsOnly: boolean;
  allowInsecureDowngrade: boolean;
}

interface RemoteProofAttempt {
  generation: number;
  url: string;
  wasHttps: boolean;
  httpRetryUrl: string | null;
  payload: Uint8Array<ArrayBuffer>;
  aztecVersion: string | undefined;
  startedAt: number;
}

function parsePort(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function resolvePrestoConfig(options: PrestoProverOptions): ResolvedPrestoConfig {
  const configured = options.presto ?? {};
  const environment = typeof process === "undefined" ? undefined : process.env;
  return {
    host: configured.host ?? DEFAULT_PRESTO_HOST,
    port: configured.port ?? parsePort(environment?.PRESTO_PORT, DEFAULT_PRESTO_PORT),
    httpsPort:
      configured.httpsPort ?? parsePort(environment?.PRESTO_HTTPS_PORT, DEFAULT_PRESTO_HTTPS_PORT),
    httpsOnly: resolveHttpsOnly(
      configured.httpsOnly,
      environment?.PRESTO_HTTPS_ONLY,
      isBrowserRuntime(),
    ),
    allowInsecureDowngrade:
      configured.allowInsecureDowngrade ??
      parseOptionalBooleanEnv(environment?.PRESTO_ALLOW_INSECURE_DOWNGRADE) ??
      false,
  };
}

/**
 * Aztec private kernel prover that routes proving to a local native presto
 * running `bb` on the user's machine through a validated loopback endpoint. Browser proving uses
 * HTTPS by default; Node/Bun/SSR retain HTTP compatibility for the headless CI server.
 *
 * Falls back to WASM proving if the presto is unavailable.
 *
 * @example
 * ```ts
 * // Zero-config — auto-detects presto on default port
 * const prover = new PrestoProver();
 *
 * // Custom port
 * const prover = new PrestoProver({ presto: { port: 51337 } });
 *
 * // Phase callback for UI animation
 * const prover = new PrestoProver({ onPhase: (p) => console.log(p) });
 * ```
 */
export class PrestoProver extends BBLazyPrivateKernelProver {
  #onPhase: ((phase: PrestoPhase, data?: PrestoPhaseData) => void) | null = null;
  /** Owns endpoint URLs, protocol negotiation, the status cache, and `/health` + `/prove` I/O. */
  #transport: PrestoTransport;
  #forceLocal = false;

  constructor(options?: PrestoProverOptions) {
    const opts = options ?? {};
    super(opts.simulator ?? createLazySimulator());
    this.#onPhase = opts.onPhase ?? null;
    const config = resolvePrestoConfig(opts);
    this.#transport = new PrestoTransport(
      config.host,
      config.port,
      config.httpsPort,
      config.httpsOnly,
      config.allowInsecureDowngrade,
    );
  }

  /** Configure the local endpoint or transport policy. Resets cached protocol + status. */
  setPrestoConfig(config: PrestoConfig) {
    // The transport resets BOTH the cached protocol and the status cache (each is keyed to
    // the old endpoint, so a stale hit would report the wrong host/port for up to the TTL).
    this.#transport.configure(config);
  }

  /** Register a callback for proof generation sub-phase transitions (for UI animation). */
  setOnPhase(callback: ((phase: PrestoPhase, data?: PrestoPhaseData) => void) | null) {
    this.#onPhase = callback;
  }

  /** Force WASM proving, bypassing presto detection. */
  setForceLocal(force: boolean) {
    this.#forceLocal = force;
  }

  /**
   * Probe the local presto's `/health` endpoint and return its status.
   * Use it to show "Presto connected" / "Offline" in your UI before a prove call.
   *
   * Single-flight: concurrent callers share one in-flight probe (per configuration generation), so
   * overlapping health checks can't race each other's pin commits.
   */
  async checkPrestoStatus(options?: PrestoStatusCheckOptions): Promise<PrestoStatus> {
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

  /** The in-flight `/health` probe, keyed to the transport generation it was started against. */
  #inflightProbe: { gen: number; promise: Promise<PrestoStatus> } | null = null;

  /**
   * Probe the presto's `/health` (runtime policy selects HTTPS-only or dual transport, one
   * startup retry) and parse the result into an
   * {@link PrestoStatus}, caching the result. `gen` is the configuration generation this probe
   * was started against — every commit passes it, so a probe that raced a `setPrestoConfig`
   * cannot pin/cache against the NEW endpoint (post-impl codex High).
   */
  async #probeAndParseHealth(gen: number): Promise<PrestoStatus> {
    const sdkAztecVersion = this.#getAztecVersion();

    try {
      // The transport applies the resolved runtime policy and one startup retry. Browser default:
      // HTTPS only for normal health/prove eligibility. Server default: dual HTTP/HTTPS probing that
      // prefers recognized HTTPS. A browser HTTPS connection failure is diagnosed separately below.
      // The transport already read the body ONCE, bounded (deadline + byte cap) — use `body`, never
      // `response.json()`.
      const { response, protocol, body } = await this.#transport.probeHealth();

      if (!response.ok) {
        // q7e3-F-06: non-OK → KEEP any existing pin. A fast error (e.g. an HTTPS cert failure)
        // must not pin the wrong protocol for /prove, nor clear an already-good pin.
        return this.#transport.commitStatus(
          { available: false, reason: "error", sdkAztecVersion, protocol },
          { pin: "keep" },
          gen,
        );
      }

      // Reachable but not the presto's health contract (unparseable, stalled-body, or a
      // foreign/malformed JSON shape — enforced in BOTH normal and httpsOnly modes): "error", NOT
      // "offline". q7e3-F-06: CLEAR the pin — a misbehaving responder must not drive /prove.
      if (!isValidHealthBody(body)) {
        return this.#transport.commitStatus(
          { available: false, reason: "error", sdkAztecVersion, protocol },
          { pin: "clear" },
          gen,
        );
      }
      const data = body as {
        aztec_version?: string;
        available_versions?: string[];
        version?: unknown;
        api_version?: unknown;
      };

      // q7e3-F-05: the version-policy decision is a pure function — a reachable, recognized /health
      // always pins the winning protocol (`set`); only the available/needsDownload/mismatch shape varies.
      return this.#transport.commitStatus(
        this.#classifyHealth(data, protocol, sdkAztecVersion),
        { pin: "set", protocol },
        gen,
      );
    } catch (error) {
      if (isLoopbackPermissionDenied(error)) {
        // Permission says nothing about endpoint identity or health. Cache the result under the normal
        // TTL, but KEEP any prior protocol pin and HTTPS history so Retry cannot weaken transport.
        return this.#transport.commitStatus(
          { available: false, reason: "permission-blocked", sdkAztecVersion },
          { pin: "keep" },
          gen,
        );
      }
      if (this.#transport.requiresSecureConnection) {
        try {
          const diagnosis = await this.#transport.diagnoseHttpHealth(gen);
          // The diagnostic is informational only: KEEP the existing HTTPS pin/history, and never
          // turn its recognized HTTP response into availability or proof eligibility.
          return this.#transport.commitStatus(
            {
              available: false,
              reason: "secure-connection-unavailable",
              diagnosis,
              sdkAztecVersion,
            },
            { pin: "keep" },
            gen,
          );
        } catch (diagnosticError) {
          if (isLoopbackPermissionDenied(diagnosticError)) {
            return this.#transport.commitStatus(
              { available: false, reason: "permission-blocked", sdkAztecVersion },
              { pin: "keep" },
              gen,
            );
          }
          // The transport normally reduces diagnostic failures to `unconfirmed`; retain the safe
          // classification if an unexpected platform error crosses that boundary.
          return this.#transport.commitStatus(
            {
              available: false,
              reason: "secure-connection-unavailable",
              diagnosis: "unconfirmed",
              sdkAztecVersion,
            },
            { pin: "keep" },
            gen,
          );
        }
      }
      // q7e3-F-06: both probes failed without a conclusive permission denial → offline; CLEAR the pin.
      return this.#transport.commitStatus(
        { available: false, reason: "offline", sdkAztecVersion },
        { pin: "clear" },
        gen,
      );
    }
  }

  /**
   * q7e3-F-05: pure version-policy. Classify a parsed `/health` body into the available /
   * needs-download / version-mismatch status. No I/O, no caching, no protocol pinning (the caller owns
   * those) — so the policy is isolated and unit-testable. Behavior-identical to the prior inline branches.
   */
  #classifyHealth(
    data: {
      aztec_version?: string;
      available_versions?: string[];
      version?: unknown;
      api_version?: unknown;
    },
    protocol: PrestoProtocol,
    sdkAztecVersion: string | undefined,
  ): PrestoStatus {
    const nativeAztecVersion = data.aztec_version;
    const availableVersions = data.available_versions;
    // B7: surface the presto APP version + the negotiated api_version (were parsed then discarded).
    // The body is untrusted wire data, so NARROW at runtime (codex #6: `{version: 42}` must not leak a
    // number through the `appVersion?: string` contract).
    const appVersion = typeof data.version === "string" ? data.version : undefined;
    const apiVersion = typeof data.api_version === "number" ? data.api_version : undefined;

    // New multi-version protocol: the SDK's version just needs to be in the cached set.
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
      protocol,
    };
  }

  async createChonkProof(
    executionSteps: PrivateExecutionStep[],
  ): Promise<ChonkProofWithPublicInputs> {
    if (this.#forceLocal) {
      logger.info("Force-local mode, using WASM prover");
      return this.#proveLocally(executionSteps, "Local proof completed");
    }

    logger.info("Using accelerated prover");

    // Capture the endpoint generation immediately BEFORE probing — but AFTER the "detect" callback, so
    // a handler that synchronously reconfigures there is honoured (the probe below then targets the
    // NEW endpoint, and rejecting that valid result would force a needless WASM fallback — codex Low).
    // A probe that started against A and completes after `setPrestoConfig(B)` has its pin/cache
    // commit discarded but still RETURNS `available: true`; proving on that basis would POST the
    // witness to the never-probed B (codex High), so re-check after the probe and degrade if it moved.
    this.#onPhase?.("detect");
    const detectGen = this.#transport.generation;
    const status = await this.checkPrestoStatus();

    if (!status.available) {
      logger.info("Presto not available, falling back to WASM");
      if (status.reason === "secure-connection-unavailable") {
        this.#onPhase?.("secure-connection-unavailable");
      }
      return this.#fallbackToWasm(executionSteps, "Local proof completed");
    }

    if (this.#transport.generation !== detectGen) {
      logger.info(
        "Endpoint reconfigured during detection; falling back to WASM (unprobed endpoint)",
      );
      return this.#fallbackToWasm(executionSteps, "Local proof completed after endpoint change");
    }

    if (status.needsDownload) {
      logger.info("Presto needs to download bb for this version");
      this.#onPhase?.("downloading");
    }

    return this.#proveRemote(executionSteps, detectGen);
  }

  /**
   * q7e3-F-11: the accelerated proving path — serialize, POST `/prove`, decode. A `403` (origin denied
   * or auth timeout) emits `"denied"` and falls back to WASM. A NETWORK-level failure (no HTTP
   * response at all — TLS/refused/timeout) retries once over HTTP only when plaintext proving was
   * explicitly permitted; otherwise it goes straight to WASM and the witness never goes plaintext.
   * Recognized HTTP-level failures also degrade, while misconfiguration/unexpected responses become
   * the public typed error. Extracted from
   * {@link PrestoProver.createChonkProof}; only reached when the presto is available.
   */
  async #proveRemote(
    executionSteps: PrivateExecutionStep[],
    attemptGen: number,
  ): Promise<ChonkProofWithPublicInputs> {
    // IMMUTABLE snapshot of the endpoint this attempt targets, taken BEFORE any `onPhase` callback
    // runs. `attemptGen` is the generation the probe validated. The URLs are captured here (not read
    // from the mutable `baseUrl`/host/port at POST time) because a dApp's `onPhase` handler can call
    // `setPrestoConfig(B)` between here and the POST — the old code would then have sent the
    // witness to the unprobed B (post-impl codex High). Every POST below uses these snapshots.
    const attemptUrl = `${this.#transport.baseUrl}/prove`;
    const attemptWasHttps = attemptUrl.startsWith("https:");
    // Only snapshot the HTTP PROOF-retry target when plaintext proving is permitted. This is separate
    // from the witness-free diagnostic URL: when plaintext proving is off-limits, no HTTP `/prove`
    // URL is constructed here. Gated on the EFFECTIVE policy,
    // not the raw `httpsOnly` flag: once HTTPS has proven healthy here the downgrade is refused too,
    // and the old check built the URL anyway (codex round 2 — harmless, but it falsified the claim).
    const httpRetryUrl =
      attemptWasHttps && this.#transport.allowsHttpDowngrade
        ? this.#transport.proveUrlFor("http")
        : null;

    logger.info("Presto available, proving natively", { url: attemptUrl });

    this.#onPhase?.("serialize");
    const msgpack = serializePrivateExecutionSteps(executionSteps);

    const aztecVersion = this.#getAztecVersion();

    this.#onPhase?.("transmit");
    this.#onPhase?.("proving");

    // A callback above may have reconfigured the endpoint. The snapshot URLs still point at the
    // PROBED endpoint (correct), but that endpoint is no longer the configured one — the caller asked
    // us to talk to B, and A was never re-validated. Degrade to WASM rather than sending the witness
    // to either an abandoned or an unprobed endpoint.
    if (this.#transport.generation !== attemptGen) {
      logger.info("Endpoint reconfigured before transmit; falling back to WASM");
      return this.#fallbackToWasm(executionSteps, "Local proof completed after endpoint change");
    }

    const attempt: RemoteProofAttempt = {
      generation: attemptGen,
      url: attemptUrl,
      wasHttps: attemptWasHttps,
      httpRetryUrl,
      payload: Uint8Array.from(msgpack),
      aztecVersion,
      startedAt: performance.now(),
    };
    let res: Response;
    try {
      res = await this.#transport.postProve(attempt.payload, attempt.aztecVersion, attempt.url);
    } catch (err) {
      if (err instanceof TransportHttpError) return this.#fallbackOrThrowHttp(err, executionSteps);
      return this.#recoverFromNetworkFailure(err, executionSteps, attempt);
    }

    // Decode OUTSIDE the transport try/catch — a decode failure is not a transport failure and must
    // not be mistaken for one (re-entering that catch would re-run the HTTPS→HTTP demotion logic for
    // a request that actually got a 200). But it still has to degrade rather than escape: the retry
    // path already falls back on a bad body, and it would be incoherent for the SAME malformed
    // response to break the dApp on the primary path and be absorbed on the retry (post-impl codex
    // Medium). Nothing about a 200 with an undecodable body says WASM can't finish the proof.
    try {
      return await this.#decodeProof(res, attempt.startedAt);
    } catch (decodeErr) {
      logger.warn("Presto returned a proof that could not be decoded, falling back to WASM", {
        error: String(decodeErr),
      });
      return this.#fallbackToWasm(
        executionSteps,
        "Local proof completed after a malformed response",
      );
    }
  }

  async #recoverFromNetworkFailure(
    error: unknown,
    executionSteps: PrivateExecutionStep[],
    attempt: RemoteProofAttempt,
  ): Promise<ChonkProofWithPublicInputs> {
    if (this.#transport.generation !== attempt.generation) {
      logger.warn("Endpoint reconfigured during a failing proof; falling back to WASM", {
        error: String(error),
      });
      return this.#fallbackToWasm(executionSteps, "Local proof completed after endpoint change");
    }
    if (attempt.httpRetryUrl) {
      return this.#retryProofOverHttp(error, executionSteps, attempt);
    }

    logger.warn("Local presto /prove failed at the network layer, falling back to WASM", {
      error: String(error),
      httpsOnly: this.#transport.httpsOnly,
    });
    if (attempt.wasHttps && this.#transport.requiresSecureConnection) {
      this.#onPhase?.("secure-connection-unavailable");
    }
    return this.#fallbackToWasm(executionSteps, "Local proof completed after transport failure");
  }

  async #retryProofOverHttp(
    originalError: unknown,
    executionSteps: PrivateExecutionStep[],
    attempt: RemoteProofAttempt,
  ): Promise<ChonkProofWithPublicInputs> {
    const retryUrl = attempt.httpRetryUrl;
    if (!retryUrl || !this.#transport.allowsHttpDowngrade) {
      logger.warn(
        "HTTPS /prove failed after this presto proved HTTPS health; refusing plaintext retry",
      );
      return this.#fallbackToWasm(executionSteps, "Local proof completed after transport failure");
    }

    this.#transport.demoteHttpsPin();
    // The health shape is not authentication, but explicit downgrade consent still requires proving
    // that the plaintext port speaks Presto before it receives the witness.
    const httpIsOurs = await this.#transport.isProtocolHealthy("http");
    if (!httpIsOurs || this.#transport.generation !== attempt.generation) {
      logger.warn(
        "HTTPS /prove failed, but HTTP did not answer the presto health contract; refusing downgrade",
      );
      return this.#fallbackToWasm(executionSteps, "Local proof completed after transport failure");
    }

    logger.warn("HTTPS /prove failed at the network layer; retrying once over validated HTTP", {
      error: String(originalError),
    });
    try {
      const response = await this.#transport.postProve(
        attempt.payload,
        attempt.aztecVersion,
        retryUrl,
      );
      // Await inside this try so body-read failures follow the same fallback path as POST failures.
      return await this.#decodeProof(response, attempt.startedAt);
    } catch (error) {
      if (error instanceof TransportHttpError) {
        return this.#fallbackOrThrowHttp(error, executionSteps);
      }
      logger.warn("HTTP retry failed at the network layer, falling back to WASM", {
        error: String(error),
      });
      return this.#fallbackToWasm(executionSteps, "Local proof completed after transport failure");
    }
  }

  /**
   * q7e3-F-11: emit `"proved"` (the server's authoritative `x-prove-duration-ms` if present, else the
   * client-measured round-trip — so the UI never hangs on `"proving"`), then `"receive"` + decode the
   * base64 proof buffer.
   */
  async #decodeProof(res: Response, start: number): Promise<ChonkProofWithPublicInputs> {
    const serverMs = Number(res.headers.get("x-prove-duration-ms"));
    const durationMs =
      Number.isFinite(serverMs) && serverMs > 0 ? serverMs : Math.round(performance.now() - start);
    logger.info("Presto proof completed", { durationMs });
    this.#onPhase?.("proved", { durationMs });

    // F-11 (audit 2026-07-31-9c4cb0c): read under a byte cap AND a body deadline. `res.json()` had
    // neither — the request timeout bounds time-to-headers, so a `200` followed by an endless body hung
    // this promise forever and buffered without limit. An over-cap or stalled body now throws, which
    // the caller already handles as a prove failure (and degrades to WASM).
    const proof = await this.#transport.readProveBody(res);
    if (proof === undefined) {
      throw new Error(
        "presto returned an unreadable /prove body (over size cap, stalled, or malformed)",
      );
    }
    this.#onPhase?.("receive");
    const proofBuffer = Buffer.from(proof, "base64");
    return ChonkProofWithPublicInputs.fromBuffer(proofBuffer);
  }

  /**
   * Run the WASM (super) prover with phase + timing instrumentation. Emits "proving"
   * then "proved"; callers add any surrounding phases (e.g. "fallback" / "receive").
   */
  async #proveLocally(
    executionSteps: PrivateExecutionStep[],
    logLabel: string,
  ): Promise<ChonkProofWithPublicInputs> {
    this.#onPhase?.("proving");
    const start = performance.now();
    const proof = await super.createChonkProof(executionSteps);
    const durationMs = Math.round(performance.now() - start);
    logger.info(logLabel, { durationMs });
    this.#onPhase?.("proved", { durationMs });
    return proof;
  }

  /**
   * B7 (F14): classify an HTTP error the presto returned from `/prove` and either degrade to WASM or
   * throw {@link PrestoHttpError}. The presto is an optimisation, so the degrade set is matched BY
   * STATUS — EVERY `403` (denial / version / cooldown) and EVERY `408`/`413`/`429`/`503`, plus
   * `500 download_failed`/`prove_failed` — all fall back to local proving regardless of `code`. Only a
   * `400` MISCONFIGURATION (`invalid_version` / `invalid_origin`), a `500` with an unrecognised code, or an
   * unexpected status throws — masking those as "slow but working" WASM would hide a real integration bug.
   *
   * The server sends its error body as `text/plain` carrying a JSON string, so the stable `code` is
   * recovered via {@link parseServerError} (a JSON content-type gives an object; both are handled).
   */
  async #fallbackOrThrowHttp(
    err: TransportHttpError,
    executionSteps: PrivateExecutionStep[],
  ): Promise<ChonkProofWithPublicInputs> {
    const status = err.response.status;
    const { code, message } = parseServerError(err.data);

    if (status === 403) {
      // The presto refused this SDK's Aztec version — distinct from a user/origin denial, and worth
      // its own phase so the UI can say "update the presto" rather than "you denied it".
      if (code === "version_not_allowed") {
        logger.warn("Presto refused this SDK's Aztec version, falling back to WASM", { code });
        this.#onPhase?.("version-mismatch");
        return this.#fallbackToWasm(
          executionSteps,
          "Local proof completed after an presto version mismatch",
        );
      }
      // A recent denial is still in cooldown (B2 F9). This is NOT a fresh prompt, so do NOT re-emit the
      // "denied" phase — just degrade quietly.
      if (code === "authorization_cooldown") {
        logger.warn("Presto is in an authorization cooldown, falling back to WASM", { code });
        return this.#fallbackToWasm(
          executionSteps,
          "Local proof completed during an authorization cooldown",
        );
      }
      // origin_denied / authorization_timeout / authorization_cancelled / a bare "denied" / no code.
      logger.warn("Presto denied this origin, falling back to WASM", { code, message });
      this.#onPhase?.("denied");
      return this.#fallbackToWasm(executionSteps, "Local proof completed after denial");
    }

    // Transient/capacity conditions the presto itself signalled — degrade rather than fail the dApp.
    // 503 (shutting down / version-evicting), 408 (body_read_timeout), 413 (payload_too_large),
    // 429 (too_many_requests / prove_queue_full), and 500 with a RECOGNISED code (download_failed /
    // prove_failed). A 500 with an unknown code falls through to the throw — an unrecognised server fault.
    if (
      status === 503 ||
      status === 408 ||
      status === 413 ||
      status === 429 ||
      (status === 500 && (code === "download_failed" || code === "prove_failed"))
    ) {
      logger.warn("Presto could not serve this proof, falling back to WASM", { status, code });
      return this.#fallbackToWasm(
        executionSteps,
        "Local proof completed while the presto was unavailable",
      );
    }

    // 400 invalid_version / invalid_origin (the SDK is misconfigured for this presto), or ANY other
    // status/code the SDK does not recognise. Surface it typed — never mask a misconfiguration as WASM.
    throw new PrestoHttpError(status, code, message);
  }

  /**
   * WASM fallback wrapper: emit "fallback" → run the local prover → emit "receive". Shared by the
   * presto-unavailable and 403-denied paths (the "denied" phase stays at its call site).
   */
  async #fallbackToWasm(
    executionSteps: PrivateExecutionStep[],
    logLabel: string,
  ): Promise<ChonkProofWithPublicInputs> {
    this.#onPhase?.("fallback");
    const proof = await this.#proveLocally(executionSteps, logLabel);
    this.#onPhase?.("receive");
    return proof;
  }

  #getAztecVersion(): string | undefined {
    // Strip leading semver range prefixes (^, ~, >=) in case the dependency isn't pinned.
    // We only strip the LEADING non-digits: the server's is_valid_version accepts the inner
    // `.`/`-`/`_` of a version like `5.0.0-rc.1` (see core version_policy.rs `is_valid_version`),
    // so the prerelease suffix must be preserved for the /health version handshake.
    return (sdkPkg.dependencies as Record<string, string | undefined>)["@aztec/stdlib"]?.replace(
      /^[^0-9]*/,
      "",
    );
  }
}

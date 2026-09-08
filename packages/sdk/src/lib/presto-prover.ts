import type {
  PrestoConfig,
  PrestoPhase,
  PrestoPhaseData,
  PrestoStatus,
  PrestoStatusCheckOptions,
  ProveOutcome,
} from "@alejoamiras/presto-core";
import { fromBase64, PRESTO_SCHEME_CHONK, PrestoClient } from "@alejoamiras/presto-core";
import { BBLazyPrivateKernelProver } from "@aztec/bb-prover/client/lazy";
import type { CircuitSimulator } from "@aztec/simulator/client";
import { type PrivateExecutionStep, serializePrivateExecutionSteps } from "@aztec/stdlib/kernel";
import { ChonkProofWithPublicInputs } from "@aztec/stdlib/proofs";
import sdkPkg from "../../package.json" with { type: "json" };
import { logger } from "./logger.js";

export interface PrestoProverOptions {
  /** Circuit simulator. Defaults to WASMSimulator (lazy-loaded from @aztec/simulator/client). */
  simulator?: CircuitSimulator;
  /** Presto connection config (port, host). */
  presto?: PrestoConfig;
  /** Phase transition callback for UI animation. */
  onPhase?: (phase: PrestoPhase, data?: PrestoPhaseData) => void;
}

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

/**
 * The Aztec version this SDK expects, from its pinned `@aztec/stdlib`. Only the LEADING non-digits
 * are stripped (a `^`/`~` range prefix): the server's version check accepts the inner `.`/`-` of a
 * version like `5.0.0-rc.1`, so the prerelease suffix must survive for the `/health` handshake.
 */
export function sdkAztecVersion(): string | undefined {
  return (sdkPkg.dependencies as Record<string, string | undefined>)["@aztec/stdlib"]?.replace(
    /^[^0-9]*/,
    "",
  );
}

/** The `/prove` success body: `{ proof: <base64> }`, decoded into the kernel's proof type. */
export function decodeChonkProof(body: unknown): ChonkProofWithPublicInputs {
  const proof = (body as { proof?: unknown } | null)?.proof;
  if (typeof proof !== "string") throw new Error("/prove body lacks a string `proof`");
  return ChonkProofWithPublicInputs.fromBuffer(Buffer.from(fromBase64(proof)));
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
  /** Owns detection, transport policy, and the `/prove` round trip; this class serializes and decodes. */
  #client: PrestoClient;
  #forceLocal = false;

  constructor(options?: PrestoProverOptions) {
    const opts = options ?? {};
    super(opts.simulator ?? createLazySimulator());
    this.#onPhase = opts.onPhase ?? null;
    this.#client = new PrestoClient({
      presto: opts.presto,
      aztecVersion: sdkAztecVersion(),
      // Forwarded through this instance so `setOnPhase` after construction reaches both emitters.
      onPhase: (phase, data) => this.#onPhase?.(phase, data),
    });
  }

  /** Configure the local endpoint or transport policy. Resets cached protocol + status. */
  setPrestoConfig(config: PrestoConfig) {
    this.#client.configure(config);
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
  checkPrestoStatus(options?: PrestoStatusCheckOptions): Promise<PrestoStatus> {
    return this.#client.checkStatus(options);
  }

  async createChonkProof(
    executionSteps: PrivateExecutionStep[],
  ): Promise<ChonkProofWithPublicInputs> {
    if (this.#forceLocal) {
      logger.info("Force-local mode, using WASM prover");
      return this.#proveLocally(executionSteps, "Local proof completed");
    }

    logger.info("Using accelerated prover");
    const outcome = await this.#client.prove({
      path: "/prove",
      contentType: "application/octet-stream",
      scheme: PRESTO_SCHEME_CHONK,
      body: () => Uint8Array.from(serializePrivateExecutionSteps(executionSteps)),
    });
    if (outcome.kind === "fallback") return this.#fallbackToWasm(executionSteps, outcome);

    // A 200 we can't decode says nothing about WASM's ability to finish the proof: degrade, don't
    // break the dApp.
    try {
      return decodeChonkProof(outcome.body);
    } catch (error) {
      logger.warn("Presto returned a proof that could not be decoded, falling back to WASM", {
        error: String(error),
      });
      return this.#fallbackToWasm(executionSteps, {
        kind: "fallback",
        reason: "malformed-response",
      });
    }
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
   * WASM fallback wrapper: emit "fallback" → run the local prover → emit "receive". The client has
   * already emitted any diagnostic phase (`denied`, `version-mismatch`, …) for `outcome`.
   */
  async #fallbackToWasm(
    executionSteps: PrivateExecutionStep[],
    outcome: Extract<ProveOutcome, { kind: "fallback" }>,
  ): Promise<ChonkProofWithPublicInputs> {
    this.#onPhase?.("fallback");
    const proof = await this.#proveLocally(
      executionSteps,
      `Local proof completed (presto: ${outcome.reason})`,
    );
    this.#onPhase?.("receive");
    return proof;
  }
}

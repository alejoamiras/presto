import type {
  FallbackReason,
  PrestoConfig,
  PrestoPhase,
  PrestoPhaseData,
  PrestoStatus,
  PrestoStatusCheckOptions,
} from "@alejoamiras/presto-core";
import { PRESTO_SCHEME_ULTRA_HONK, PrestoClient, toBase64 } from "@alejoamiras/presto-core";
import type {
  Barretenberg,
  ProofData,
  UltraHonkBackend,
  UltraHonkBackendOptions,
  VerifierTarget,
} from "@aztec/bb.js";
import { PrestoUnavailableError } from "./errors.js";
import { logger } from "./logger.js";
import { decodeUltraHonkResponse, toProofData, type UltraHonkResponse } from "./proof-data.js";
import { resolveBbVersion, TESTED_BB_VERSION } from "./tested-versions.js";
import { resolveVerifierTarget } from "./verifier-target.js";

type OnPhase = (phase: PrestoPhase, data?: PrestoPhaseData) => void;

const noop = () => undefined;

/**
 * A `Barretenberg` instance, or a factory for one. A factory is called only when WASM is actually
 * needed (a fallback, `verifyProof`, a cold `getVerificationKey`), so a dApp with a running Presto
 * never pays WASM + CRS initialisation; an instance is the caller's and is never destroyed here.
 */
export type BarretenbergSource = Barretenberg | (() => Promise<Barretenberg>);

export interface PrestoUltraHonkBackendOptions {
  /**
   * The bb release the presto proves with (an Aztec release ships bb and `@aztec/bb.js` under one
   * version). Defaults to the adapter's tested version; another value is refused unless
   * `allowUntestedBbVersion` is set, because native and WASM proofs would then come from
   * different bb releases.
   */
  bbVersion?: string;
  allowUntestedBbVersion?: boolean;
  /** Presto connection config (port, host, transport policy). */
  presto?: PrestoConfig;
  /**
   * A verification key for THIS circuit and the target it was computed for. Sent with native proofs
   * of that target (saves the presto a key computation) and returned by `getVerificationKey` for
   * that target. A key for another circuit only spoils this backend's own proofs.
   */
  verificationKey?: { bytes: Uint8Array; verifierTarget: VerifierTarget };
  /**
   * What `generateProof` does when the presto cannot prove: `"wasm"` (default) proves locally like
   * bb.js; `"none"` throws {@link PrestoUnavailableError} so a caller can apply backpressure.
   * `verifyProof` and a cold `getVerificationKey` always run locally.
   */
  fallback?: "wasm" | "none";
  /** Phase transition callback for UI animation. */
  onPhase?: OnPhase;
}

/**
 * The public methods of bb.js's `UltraHonkBackend`, checked at compile time. bb.js's class also has
 * private fields, so a consumer typed to the class itself must type against these methods instead.
 */
type UltraHonkSurface = Pick<
  UltraHonkBackend,
  | "generateProof"
  | "verifyProof"
  | "getVerificationKey"
  | "getSolidityVerifier"
  | "generateRecursiveProofArtifacts"
>;

/**
 * `UltraHonkBackend` with native proving: `generateProof` sends the circuit and witness to the local
 * Presto app (`POST /prove/ultra-honk`) and returns bb's proof as bb.js would, falling back to the
 * real WASM backend when the presto is unavailable. Every other method delegates to that WASM
 * backend, so verification stays circuit-bound exactly like bb.js.
 *
 * @example
 * ```ts
 * const backend = new PrestoUltraHonkBackend(circuit.bytecode, () => Barretenberg.new());
 * const { proof, publicInputs } = await backend.generateProof(witness);
 * ```
 */
export class PrestoUltraHonkBackend implements UltraHonkSurface {
  readonly #bytecode: string;
  readonly #source: BarretenbergSource;
  readonly #bbVersion: string;
  readonly #fallback: "wasm" | "none";
  readonly #seed: { bytes: Uint8Array; verifierTarget: VerifierTarget } | undefined;
  /** Keys the presto computed, by target: only ever sent back as `vk` on this backend's own proofs. */
  readonly #serverKeys = new Map<VerifierTarget, Uint8Array>();
  readonly #client: PrestoClient;
  #onPhase: OnPhase | null;
  #forceLocal = false;
  #api: Promise<Barretenberg> | null = null;
  #ownsApi = false;
  #wasm: Promise<UltraHonkBackend> | null = null;

  constructor(
    acirBytecode: string,
    api: BarretenbergSource,
    options: PrestoUltraHonkBackendOptions = {},
  ) {
    this.#bytecode = acirBytecode;
    this.#source = api;
    this.#bbVersion = resolveBbVersion(options.bbVersion, options.allowUntestedBbVersion);
    this.#fallback = options.fallback ?? "wasm";
    this.#seed = options.verificationKey;
    this.#onPhase = options.onPhase ?? null;
    this.#client = new PrestoClient({
      presto: options.presto,
      aztecVersion: this.#bbVersion,
      onPhase: (phase, data) => this.#onPhase?.(phase, data),
    });
  }

  async generateProof(
    compressedWitness: Uint8Array,
    options?: UltraHonkBackendOptions,
  ): Promise<ProofData> {
    const target = resolveVerifierTarget(options);
    if (this.#forceLocal) return this.#proveLocally(compressedWitness, options);

    const outcome = await this.#client.prove({
      path: "/prove/ultra-honk",
      contentType: "application/json",
      scheme: PRESTO_SCHEME_ULTRA_HONK,
      body: () => this.#encodeJob(compressedWitness, target),
    });
    if (outcome.kind === "fallback") {
      return this.#fallbackFrom(outcome.reason, outcome.phase, compressedWitness, options);
    }
    let decoded: UltraHonkResponse;
    try {
      decoded = decodeUltraHonkResponse(outcome.body);
    } catch (error) {
      logger.warn("Presto returned a proof that could not be decoded", { error: String(error) });
      return this.#fallbackFrom("malformed-response", undefined, compressedWitness, options);
    }
    if (decoded.vk) this.#serverKeys.set(target, decoded.vk);
    return toProofData(decoded);
  }

  /** Circuit-bound like bb.js: the WASM backend recomputes the key from the bytecode. */
  async verifyProof(proofData: ProofData, options?: UltraHonkBackendOptions): Promise<boolean> {
    return (await this.#wasmBackend()).verifyProof(proofData, options);
  }

  /** The seeded key for its target; otherwise WASM-derived (a presto-computed key is never returned). */
  async getVerificationKey(options?: UltraHonkBackendOptions): Promise<Uint8Array> {
    const target = resolveVerifierTarget(options);
    if (this.#seed?.verifierTarget === target) return this.#seed.bytes;
    return (await this.#wasmBackend()).getVerificationKey(options);
  }

  async getSolidityVerifier(vk: Uint8Array, options?: UltraHonkBackendOptions): Promise<string> {
    return (await this.#wasmBackend()).getSolidityVerifier(vk, options);
  }

  async generateRecursiveProofArtifacts(
    proof: Uint8Array,
    numOfPublicInputs: number,
    options?: UltraHonkBackendOptions,
  ): Promise<{ proofAsFields: string[]; vkAsFields: string[]; vkHash: string }> {
    const backend = await this.#wasmBackend();
    return backend.generateRecursiveProofArtifacts(proof, numOfPublicInputs, options);
  }

  /** Probe the local presto's `/health` and return its status. */
  checkPrestoStatus(options?: PrestoStatusCheckOptions): Promise<PrestoStatus> {
    return this.#client.checkStatus(options);
  }

  /** Force WASM proving, bypassing presto detection. */
  setForceLocal(force: boolean): void {
    this.#forceLocal = force;
  }

  /** Register a callback for proof generation sub-phase transitions (for UI animation). */
  setOnPhase(callback: OnPhase | null): void {
    this.#onPhase = callback;
  }

  /** Release the WASM backend this instance created from a factory; a caller-provided one is untouched. */
  async destroy(): Promise<void> {
    // An initialisation still awaiting the peer import calls the factory only afterwards; wait for
    // it so the API it is about to create is the one released here, not one that outlives us.
    const pending = this.#wasm;
    this.#wasm = null;
    if (pending) await pending.then(noop, noop);
    const api = this.#api;
    this.#api = null;
    if (this.#ownsApi && api) {
      this.#ownsApi = false;
      await api.then((instance) => instance.destroy(), noop);
    }
  }

  #encodeJob(witness: Uint8Array, target: VerifierTarget): Uint8Array {
    const job: Record<string, string> = {
      bytecode: this.#bytecode,
      witness: toBase64(witness),
      verifier_target: target,
    };
    const key =
      this.#seed?.verifierTarget === target ? this.#seed.bytes : this.#serverKeys.get(target);
    if (key) job.vk = toBase64(key);
    return new TextEncoder().encode(JSON.stringify(job));
  }

  async #fallbackFrom(
    reason: FallbackReason,
    phase: PrestoPhase | undefined,
    witness: Uint8Array,
    options?: UltraHonkBackendOptions,
  ): Promise<ProofData> {
    if (this.#fallback === "none") throw new PrestoUnavailableError(reason, phase);
    this.#onPhase?.("fallback");
    const proof = await this.#proveLocally(witness, options);
    this.#onPhase?.("receive");
    return proof;
  }

  async #proveLocally(witness: Uint8Array, options?: UltraHonkBackendOptions): Promise<ProofData> {
    this.#onPhase?.("proving");
    const start = performance.now();
    const proof = await (await this.#wasmBackend()).generateProof(witness, options);
    const durationMs = Math.round(performance.now() - start);
    logger.info("Local WASM proof completed", { durationMs });
    this.#onPhase?.("proved", { durationMs });
    return proof;
  }

  #resolveApi(): Promise<Barretenberg> {
    if (!this.#api) {
      if (typeof this.#source === "function") {
        this.#ownsApi = true;
        this.#api = this.#source();
      } else {
        this.#api = Promise.resolve(this.#source);
      }
    }
    return this.#api;
  }

  /**
   * bb.js is loaded on first use so a native-only path never pulls the WASM module in; it is loaded
   * BEFORE the caller's factory runs, so a missing peer is reported by this package rather than by
   * whatever the factory imports first.
   */
  #wasmBackend(): Promise<UltraHonkBackend> {
    if (!this.#wasm) {
      this.#wasm = loadUltraHonkBackend().then(
        async (Backend) => new Backend(this.#bytecode, await this.#resolveApi()),
      );
    }
    return this.#wasm;
  }
}

/**
 * The peer is only reached here, so a missing or unexpected `@aztec/bb.js` surfaces as one actionable
 * error at the first WASM use instead of a bare module-resolution failure deep in a fallback.
 */
async function loadUltraHonkBackend(): Promise<typeof UltraHonkBackend> {
  const missing = (cause?: unknown) =>
    new Error(
      `@alejoamiras/presto-noir needs its peer dependency @aztec/bb.js@${TESTED_BB_VERSION} for WASM ` +
        "proving and verification: install it beside this package.",
      cause === undefined ? undefined : { cause },
    );
  let bbJs: { UltraHonkBackend?: unknown };
  try {
    bbJs = await import("@aztec/bb.js");
  } catch (error) {
    throw missing(error);
  }
  if (typeof bbJs.UltraHonkBackend !== "function") throw missing();
  return bbJs.UltraHonkBackend as typeof UltraHonkBackend;
}

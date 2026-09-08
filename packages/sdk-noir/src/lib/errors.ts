import type { FallbackReason, PrestoPhase } from "@alejoamiras/presto-core";

/**
 * Thrown by `generateProof` when the backend was constructed with `fallback: "none"` and the presto
 * could not prove natively: the caller asked for backpressure instead of a silent WASM proof.
 * `reason` is the client's fallback reason (`unavailable`, `denied`, `route-missing`, …) or
 * `malformed-response` for a native answer that could not be decoded.
 */
export class PrestoUnavailableError extends Error {
  readonly reason: FallbackReason;
  readonly phase?: PrestoPhase;

  constructor(reason: FallbackReason, phase?: PrestoPhase) {
    super(`Presto could not prove natively (${reason}) and WASM fallback is disabled`);
    this.name = "PrestoUnavailableError";
    this.reason = reason;
    this.phase = phase;
  }
}

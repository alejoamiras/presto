import type { CircuitSimulator } from "@aztec/simulator/client";

// q7e3-F-02: the SDK's published types live here (a neutral module), not inside the
// `presto-prover.ts` hotspot. `index.ts` re-exports them unchanged; `presto-transport.ts`
// imports them here instead of back-importing from the prover — killing the former 2-way edge.

/**
 * The `/health` + `/prove` API version this SDK speaks. Bumped in lockstep with the server's own
 * `api_version` when the wire contract changes incompatibly. Kept as a named constant (B7) rather than the
 * `1` literal that was inlined at every check — a per-language constant that documents the negotiated
 * version and gives one place to bump.
 */
export const PRESTO_API_VERSION = 1;

/** Sub-phases emitted during proof generation for UI animation. */
export type PrestoPhase =
  | "detect"
  | "secure-connection-unavailable"
  | "serialize"
  | "transmit"
  | "proving"
  | "proved"
  | "receive"
  | "fallback"
  | "downloading"
  | "denied"
  // B7 (F14): the presto refused this SDK's Aztec version (`403 version_not_allowed`). Distinct from
  // `"denied"` (a user/origin denial) — the proof still degrades to WASM, but the cause is a version
  // gap the UI should surface differently.
  | "version-mismatch";

/** Data payload for the `"proved"` phase — carries the actual proving duration. */
export interface PrestoPhaseData {
  durationMs: number;
}

export interface PrestoConfig {
  /** Port the presto listens on (HTTP). Default: 59833. */
  port?: number;
  /** Port the presto listens on (HTTPS — required for Safari; preferred elsewhere when trusted). Default: 59834. */
  httpsPort?: number;
  /** Host the presto binds to. Default: "127.0.0.1". */
  host?: string;
  /**
   * Private proof transport policy. When true, the SDK never sends a `/prove` request or private
   * witness over HTTP. After an HTTPS connection failure it may perform one bounded, witness-free
   * HTTP `GET /health` solely to diagnose whether HTTPS is disabled or untrusted; that diagnostic
   * can never make the presto eligible for proving.
   *
   * Defaults to true in browsers and false in Node, Bun, and SSR. An explicit constructor/runtime
   * option wins over `PRESTO_HTTPS_ONLY`, which wins over the runtime default.
   */
  httpsOnly?: boolean;
  /**
   * Allow the SDK to fall back to the plaintext `http://` endpoint **after it has already reached a
   * healthy `https://` presto at this address**. Off by default (F-01, audit 2026-07-31).
   *
   * This is not the same knob as {@link PrestoConfig.httpsOnly}. It governs the narrower case
   * where HTTPS *was* working and then a `/prove` fails at the network layer. Turn it on only if you
   * explicitly accept retrying the same private witness over plaintext HTTP. Browser dApps that offer
   * a session-only HTTP recovery must set both `httpsOnly: false` and
   * `allowInsecureDowngrade: true`; the SDK never persists that decision.
   *
   * Default: false.
   */
  allowInsecureDowngrade?: boolean;
}

export interface PrestoProverOptions {
  /** Circuit simulator. Defaults to WASMSimulator (lazy-loaded from @aztec/simulator/client). */
  simulator?: CircuitSimulator;
  /** Presto connection config (port, host). */
  presto?: PrestoConfig;
  /** Phase transition callback for UI animation. */
  onPhase?: (phase: PrestoPhase, data?: PrestoPhaseData) => void;
}

/** Options for {@link PrestoProver.checkPrestoStatus}. */
export interface PrestoStatusCheckOptions {
  /**
   * Ignore a settled status cached within the normal ten-second TTL and start a fresh probe. An
   * already-running probe for the current endpoint is still shared.
   */
  forceRefresh?: boolean;
}

/** Protocol used to reach the presto's `/health` + `/prove` endpoints. */
export type PrestoProtocol = "http" | "https";

/** Best-effort result of the witness-free HTTP diagnostic after an HTTPS connection failure. */
export type SecureConnectionDiagnosis =
  | "https-disabled"
  | "tls-or-trust-failure"
  | "presto-reachable"
  | "unconfirmed";

/**
 * Status of the local native presto, returned by {@link PrestoProver.checkPrestoStatus}.
 *
 * A discriminated union on `available` (Q12). The prior flat interface let illegal field combinations
 * typecheck (e.g. `available: false` carrying `availableVersions`, or `needsDownload` on an offline
 * result). Narrow on `available` first — and on `reason` for the unavailable cases — to access only the
 * fields valid for that state.
 */
export type PrestoStatus =
  | {
      /** The presto is reachable and version-compatible. */
      available: true;
      /** Whether it must download `bb` for the SDK's Aztec version before it can prove. */
      needsDownload: boolean;
      /** Native server's Aztec version from `/health.aztec_version`; absent on minimal health. */
      nativeAztecVersion?: string;
      /** Aztec versions the presto already has cached (multi-version protocol). */
      availableVersions?: string[];
      /** The Aztec version this SDK expects (from its `@aztec/stdlib` dependency). */
      sdkAztecVersion?: string;
      /**
       * The presto app's own version from `/health` (`version`) — the desktop/headless build, NOT the
       * Aztec version. Surfaced (B7) for diagnostics/telemetry; `undefined` when the origin-tiered minimal
       * `/health` withheld it (unapproved cross-origin).
       */
      appVersion?: string;
      /**
       * The presto's `/health` `api_version`. The SDK only treats an endpoint as available when this
       * equals {@link PRESTO_API_VERSION}; it is surfaced here for diagnostics.
       */
      apiVersion?: number;
      /** Which protocol reached the presto. */
      protocol: PrestoProtocol;
    }
  | {
      available: false;
      /**
       * The endpoint did not answer in a runtime/policy that permits normal HTTP probing, and the
       * browser did not expose a conclusive permission denial. Browser HTTPS-only failures instead use
       * `secure-connection-unavailable`, normally with an `unconfirmed` diagnosis when prompts or
       * browser policy obscure both endpoints.
       */
      reason: "offline";
      sdkAztecVersion?: string;
    }
  | {
      available: false;
      /** The browser explicitly denied this origin permission to reach the loopback address space. */
      reason: "permission-blocked";
      sdkAztecVersion?: string;
    }
  | {
      available: false;
      /** HTTPS could not connect and policy forbids using HTTP for private proving. */
      reason: "secure-connection-unavailable";
      /** Best-effort classification from a single witness-free HTTP `GET /health`. */
      diagnosis: SecureConnectionDiagnosis;
      sdkAztecVersion?: string;
    }
  | {
      available: false;
      /** Reachable, but `/health` returned a non-OK HTTP status. */
      reason: "error";
      sdkAztecVersion?: string;
      protocol: PrestoProtocol;
    }
  | {
      available: false;
      /** Reachable, but its Aztec version doesn't match the SDK's (legacy single-version protocol). */
      reason: "version-mismatch";
      /** The native server's mismatched Aztec version (not its application version). */
      nativeAztecVersion: string;
      sdkAztecVersion?: string;
      protocol: PrestoProtocol;
    };

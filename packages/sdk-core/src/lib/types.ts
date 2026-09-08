import type { PrestoScheme } from "./schemes.js";

/**
 * The `/health` + `/prove` API version this client speaks. Bumped in lockstep with the server's own
 * `api_version` when the wire contract changes incompatibly.
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
  // The presto refused this client's Aztec version (`403 version_not_allowed`) or does not serve the
  // scheme the route needs. Distinct from `"denied"` (a user/origin denial): the proof still degrades
  // locally, but the cause is a version gap the UI should surface differently.
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
   * Private proof transport policy. When true, the client never sends a prove request or private
   * witness over HTTP. After an HTTPS connection failure it may perform one bounded, witness-free
   * HTTP `GET /health` solely to diagnose whether HTTPS is disabled or untrusted; that diagnostic
   * can never make the presto eligible for proving.
   *
   * Defaults to true in browsers (pages and Workers) and false in Node, Bun, and SSR. An explicit
   * option wins over `PRESTO_HTTPS_ONLY`, which wins over the runtime default.
   */
  httpsOnly?: boolean;
  /**
   * Allow the client to fall back to the plaintext `http://` endpoint **after it has already reached
   * a healthy `https://` presto at this address**. Off by default.
   *
   * This is not the same knob as {@link PrestoConfig.httpsOnly}. It governs the narrower case
   * where HTTPS *was* working and then a prove request fails at the network layer. Turn it on only
   * if you explicitly accept retrying the same private witness over plaintext HTTP. Browser dApps
   * that offer a session-only HTTP recovery must set both `httpsOnly: false` and
   * `allowInsecureDowngrade: true`; the client never persists that decision.
   *
   * Default: false.
   */
  allowInsecureDowngrade?: boolean;
}

/** Options for {@link PrestoClient.checkStatus}. */
export interface PrestoStatusCheckOptions {
  /**
   * Ignore a settled status cached within the normal ten-second TTL and start a fresh probe. An
   * already-running probe for the current endpoint is still shared.
   */
  forceRefresh?: boolean;
}

/** Protocol used to reach the presto's `/health` + prove endpoints. */
export type PrestoProtocol = "http" | "https";

/** Best-effort result of the witness-free HTTP diagnostic after an HTTPS connection failure. */
export type SecureConnectionDiagnosis =
  | "https-disabled"
  | "tls-or-trust-failure"
  | "presto-reachable"
  | "unconfirmed";

/** One Aztec release and the `@aztec/bb.js` version it ships, as advertised by `/health.versions`. */
export interface PrestoVersionPair {
  aztecVersion: string;
  bbVersion: string;
}

/**
 * Status of the local native presto, returned by {@link PrestoClient.checkStatus}.
 *
 * A discriminated union on `available`: narrow on `available` first — and on `reason` for the
 * unavailable cases — to access only the fields valid for that state.
 */
export type PrestoStatus =
  | {
      /** The presto is reachable and version-compatible. */
      available: true;
      /** Whether it must download `bb` for the client's Aztec version before it can prove. */
      needsDownload: boolean;
      /** Native server's Aztec version from `/health.aztec_version`; absent on minimal health. */
      nativeAztecVersion?: string;
      /** Aztec versions the presto already has cached (multi-version protocol). */
      availableVersions?: string[];
      /** The Aztec version this client expects. */
      sdkAztecVersion?: string;
      /**
       * The presto app's own version from `/health` (`version`) — the desktop/headless build, NOT the
       * Aztec version. `undefined` when the origin-tiered minimal `/health` withheld it (unapproved
       * cross-origin).
       */
      appVersion?: string;
      /**
       * The presto's `/health` `api_version`. The client only treats an endpoint as available when
       * this equals {@link PRESTO_API_VERSION}; it is surfaced here for diagnostics.
       */
      apiVersion?: number;
      /** Proving schemes the presto serves (`/health.schemes`); absent from an app that predates the list. */
      schemes?: readonly string[];
      /** Cached Aztec ↔ bb version pairs (`/health.versions`); only on the detailed body. */
      versions?: readonly PrestoVersionPair[];
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
      /** Reachable, but its Aztec version doesn't match the client's (legacy single-version protocol). */
      reason: "version-mismatch";
      /** The native server's mismatched Aztec version (not its application version). */
      nativeAztecVersion: string;
      sdkAztecVersion?: string;
      protocol: PrestoProtocol;
    };

export interface PrestoClientOptions {
  /** Presto connection config (port, host, transport policy). */
  presto?: PrestoConfig;
  /**
   * The Aztec release this client's proofs belong to (e.g. the adapter's pinned `@aztec/stdlib`
   * version). Sent as `x-aztec-version` on every prove request and compared against the presto's
   * cached versions for `needsDownload` / `version-mismatch`. Omit it for a route that is
   * version-agnostic.
   */
  aztecVersion?: string;
  /** Phase transition callback for UI animation. */
  onPhase?: (phase: PrestoPhase, data?: PrestoPhaseData) => void;
}

/** One request to a presto prove route. */
export interface ProveRequest {
  /** The route, e.g. `/prove` or `/prove/ultra-honk`. */
  path: string;
  /** `content-type` of the body. */
  contentType: string;
  /**
   * Builds the request body. Called once, after the `serialize` phase is emitted, so serialization
   * cost is attributed to that phase and never paid when the presto is unavailable.
   */
  body: () => Uint8Array;
  /**
   * The scheme the route needs. When the presto advertises `schemes` without it (or predates the
   * list and the scheme is not `chonk`), the request degrades before anything is sent.
   */
  scheme?: PrestoScheme;
  /** Byte cap for the success body. Default: 8 MiB, sized for the largest chonk proof. */
  responseCap?: number;
}

/** Why {@link PrestoClient.prove} degraded instead of returning a native proof. */
export type FallbackReason =
  /** The presto is offline, blocked, misbehaving, or on an incompatible legacy version. */
  | "unavailable"
  /** Browser policy forbids plaintext and HTTPS could not connect. */
  | "secure-connection-unavailable"
  /** The presto does not serve the route's scheme. */
  | "scheme-unsupported"
  /** `configure()` moved the endpoint while the request was in flight. */
  | "endpoint-changed"
  /** The request never got an HTTP response (refused, TLS failure, timeout). */
  | "network"
  /** The presto denied this origin (`403`). */
  | "denied"
  /** A recent denial is still in cooldown (`403 authorization_cooldown`). */
  | "cooldown"
  /** The presto refused this client's Aztec version (`403 version_not_allowed`). */
  | "version-mismatch"
  /** The presto answered `404`: an app that predates this route. */
  | "route-missing"
  /** A transient/capacity condition the presto itself signalled (`408`/`413`/`429`/`503`, known `500`s). */
  | "transient"
  /** A `200` whose body was over the cap, stalled, or was not JSON. */
  | "malformed-response";

/** Result of {@link PrestoClient.prove}. */
export type ProveOutcome =
  | {
      kind: "native";
      /** The success body, parsed as JSON under the request's `responseCap`. */
      body: unknown;
      /** Server-reported proving time when it sent `x-prove-duration-ms`, else the client round-trip. */
      durationMs: number;
    }
  | {
      kind: "fallback";
      reason: FallbackReason;
      /** The diagnostic phase already emitted for this outcome, so an adapter does not repeat it. */
      phase?: Extract<PrestoPhase, "secure-connection-unavailable" | "denied" | "version-mismatch">;
    };

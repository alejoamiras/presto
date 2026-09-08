export { fromBase64, toBase64 } from "./lib/base64.js";
export { PrestoHttpError } from "./lib/errors.js";
export { PrestoClient } from "./lib/presto-client.js";
export type { PrestoScheme } from "./lib/schemes.js";
export { PRESTO_SCHEME_CHONK, PRESTO_SCHEME_ULTRA_HONK } from "./lib/schemes.js";
export type {
  FallbackReason,
  PrestoClientOptions,
  PrestoConfig,
  PrestoPhase,
  PrestoPhaseData,
  PrestoProtocol,
  PrestoStatus,
  PrestoStatusCheckOptions,
  PrestoVersionPair,
  ProveOutcome,
  ProveRequest,
  SecureConnectionDiagnosis,
} from "./lib/types.js";
export { PRESTO_API_VERSION } from "./lib/types.js";

export type {
  FallbackReason,
  LoopbackPermissionState,
  PrestoConfig,
  PrestoPhase,
  PrestoPhaseData,
  PrestoStatus,
  PrestoStatusCheckOptions,
} from "@alejoamiras/presto-core";
export {
  loopbackPermission,
  PrestoHttpError,
  watchLoopbackPermission,
} from "@alejoamiras/presto-core";
export type { ProofData, UltraHonkBackendOptions, VerifierTarget } from "@aztec/bb.js";
export { PrestoUnavailableError } from "./lib/errors.js";
export type {
  BarretenbergSource,
  PrestoUltraHonkBackendOptions,
} from "./lib/presto-ultra-honk-backend.js";
export { PrestoUltraHonkBackend } from "./lib/presto-ultra-honk-backend.js";
export { TESTED_BB_VERSION, TESTED_BB_VERSIONS } from "./lib/tested-versions.js";
export { resolveVerifierTarget, VERIFIER_TARGETS } from "./lib/verifier-target.js";

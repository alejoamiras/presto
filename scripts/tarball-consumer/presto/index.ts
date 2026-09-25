// Typechecked inside the consumer host against the PACKED dist: exercises the full published surface,
// runtime values and types, so a broken barrel, exports map, or types condition fails here.

import type { LoopbackPermissionState, PrestoPhase, PrestoStatus } from "@alejoamiras/presto";
import {
  loopbackPermission,
  PRESTO_API_VERSION,
  PrestoHttpError,
  PrestoProver,
  watchLoopbackPermission,
} from "@alejoamiras/presto";

const _prover: typeof PrestoProver = PrestoProver;
const _err: typeof PrestoHttpError = PrestoHttpError;
const _api: number = PRESTO_API_VERSION;
const _phase: PrestoPhase = "version-mismatch";
function _use(s: PrestoStatus): boolean {
  return (
    s.available &&
    (s.appVersion !== undefined || _api > 0) &&
    _phase.length > 0 &&
    !!_prover &&
    !!_err
  );
}
void _use;
const _permission: Promise<LoopbackPermissionState> = loopbackPermission();
const _stop: Promise<() => void> = watchLoopbackPermission(() => {});
void _permission;
void _stop;

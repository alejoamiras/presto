// Typechecked inside the consumer host against the PACKED dist: exercises the full published surface,
// runtime values and types, so a broken barrel, exports map, or types condition fails here.

import type { PrestoPhase, PrestoStatus } from "@alejoamiras/presto";
import { PRESTO_API_VERSION, PrestoHttpError, PrestoProver } from "@alejoamiras/presto";

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

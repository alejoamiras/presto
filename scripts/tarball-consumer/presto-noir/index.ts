// Typechecked inside the consumer host against the PACKED dist: exercises the published surface,
// runtime values and types, so a broken barrel, exports map, or types condition fails here. The
// host installs the `@aztec/bb.js` peer, so the bb.js types the surface re-exports must resolve.

import type { PrestoStatus, PrestoUltraHonkBackendOptions } from "@alejoamiras/presto-noir";
import {
  PrestoHttpError,
  PrestoUltraHonkBackend,
  PrestoUnavailableError,
  resolveVerifierTarget,
  TESTED_BB_VERSION,
} from "@alejoamiras/presto-noir";
import type { Barretenberg, ProofData, VerifierTarget } from "@aztec/bb.js";

const options: PrestoUltraHonkBackendOptions = { fallback: "none", bbVersion: TESTED_BB_VERSION };
const backend = new PrestoUltraHonkBackend(
  "bytecode",
  () => Promise.reject<Barretenberg>(new Error("unused")),
  options,
);
const _status: Promise<PrestoStatus> = backend.checkPrestoStatus();
const _proof: Promise<ProofData> = backend.generateProof(new Uint8Array());
const _target: VerifierTarget = resolveVerifierTarget();
const _errors = [PrestoHttpError, PrestoUnavailableError];
void _status;
void _proof;
void _target;
void _errors;

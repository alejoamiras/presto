// Runtime import of the packed dist's `default` export condition: the typecheck resolves `types`, only a
// real load proves the JavaScript entry resolves and its exports exist.
import {
  PrestoUltraHonkBackend,
  PrestoUnavailableError,
  resolveVerifierTarget,
  TESTED_BB_VERSION,
} from "@alejoamiras/presto-noir";

if (typeof PrestoUltraHonkBackend !== "function") throw new Error("PrestoUltraHonkBackend missing");
if (typeof PrestoUnavailableError !== "function") throw new Error("PrestoUnavailableError missing");
if (resolveVerifierTarget() !== "noir-recursive") throw new Error("default target mismatch");
if (TESTED_BB_VERSION !== "5.2.0") throw new Error("TESTED_BB_VERSION mismatch");
const backend = new PrestoUltraHonkBackend("bytecode", () => Promise.reject(new Error("unused")));
for (const method of [
  "generateProof",
  "verifyProof",
  "getVerificationKey",
  "getSolidityVerifier",
  "generateRecursiveProofArtifacts",
]) {
  if (typeof backend[method] !== "function") throw new Error(`${method} missing from dist`);
}
console.log("runtime import OK: dist exports resolve and load");

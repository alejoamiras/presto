// Runtime import of the packed dist's `default` export condition: the typecheck resolves `types`, only a
// real load proves the JavaScript entry resolves and its exports exist.
import { PRESTO_API_VERSION, PrestoHttpError, PrestoProver } from "@alejoamiras/presto";

if (typeof PrestoProver !== "function") throw new Error("PrestoProver missing from dist");
if (typeof PrestoHttpError !== "function") throw new Error("PrestoHttpError missing from dist");
if (typeof PRESTO_API_VERSION !== "number") throw new Error("PRESTO_API_VERSION missing from dist");
// The typed error must actually be `instanceof Error` (extends Error), or `catch` narrowing breaks.
if (!(new PrestoHttpError(400, "invalid_version") instanceof Error))
  throw new Error("PrestoHttpError is not an Error");
console.log("runtime import OK: dist exports resolve and load");

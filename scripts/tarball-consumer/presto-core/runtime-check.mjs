// Runtime import of the packed dist's `default` export condition: the typecheck resolves `types`, only a
// real load proves the JavaScript entry resolves and its exports exist.
import { PRESTO_SCHEME_CHONK, PRESTO_SCHEME_ULTRA_HONK } from "@alejoamiras/presto-core";

if (PRESTO_SCHEME_CHONK !== "chonk") throw new Error("PRESTO_SCHEME_CHONK missing from dist");
if (PRESTO_SCHEME_ULTRA_HONK !== "ultra_honk") {
  throw new Error("PRESTO_SCHEME_ULTRA_HONK missing from dist");
}
console.log("runtime import OK: dist exports resolve and load");

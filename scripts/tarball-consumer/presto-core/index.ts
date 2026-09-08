// Typechecked inside the consumer host against the PACKED dist: exercises the published surface,
// runtime values and types, so a broken barrel, exports map, or types condition fails here.

import type { PrestoScheme } from "@alejoamiras/presto-core";
import { PRESTO_SCHEME_CHONK, PRESTO_SCHEME_ULTRA_HONK } from "@alejoamiras/presto-core";

const _scheme: PrestoScheme = PRESTO_SCHEME_ULTRA_HONK;
const _chonk: string = PRESTO_SCHEME_CHONK;
void _scheme;
void _chonk;

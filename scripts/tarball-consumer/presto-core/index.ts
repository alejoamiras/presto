// Typechecked inside the consumer host against the PACKED dist: exercises the published surface,
// runtime values and types, so a broken barrel, exports map, or types condition fails here.

import type { LoopbackPermissionState, PrestoScheme } from "@alejoamiras/presto-core";
import {
  loopbackPermission,
  PRESTO_SCHEME_CHONK,
  PRESTO_SCHEME_ULTRA_HONK,
  watchLoopbackPermission,
} from "@alejoamiras/presto-core";

const _scheme: PrestoScheme = PRESTO_SCHEME_ULTRA_HONK;
const _chonk: string = PRESTO_SCHEME_CHONK;
const _permission: Promise<LoopbackPermissionState> = loopbackPermission();
const _stop: Promise<() => void> = watchLoopbackPermission(
  (state: "granted" | "prompt" | "denied") => {
    void state;
  },
);
void _scheme;
void _chonk;
void _permission;
void _stop;

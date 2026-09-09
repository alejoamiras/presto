// Typechecked inside the consumer host against the PACKED dist: both entries of the exports map must
// resolve their `types` condition. A bare side-effect import of `/register` would not — tsc reports
// nothing for an unresolved side-effect import — so a named import goes through it.

import type { BannerState, PrestoStatusLike } from "@alejoamiras/presto-banners";
import { BANNER_VARIANTS, stateFromStatus } from "@alejoamiras/presto-banners";
import { definePrestoBanner } from "@alejoamiras/presto-banners/register";

const status: PrestoStatusLike = { available: false, reason: "offline" };
const _state: BannerState = stateFromStatus(status);
const _defined: boolean = definePrestoBanner();
const _variants: readonly string[] = BANNER_VARIANTS;
void _state;
void _defined;
void _variants;

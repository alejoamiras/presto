// Typechecked inside the consumer host against the PACKED dist: both entries of the exports map must
// resolve their `types` condition — `register` is a side-effect entry with nothing to import by name.

import type { BannerState, PrestoStatusLike } from "@alejoamiras/presto-banners";
import { BANNER_VARIANTS, definePrestoBanner, stateFromStatus } from "@alejoamiras/presto-banners";
import "@alejoamiras/presto-banners/register";

const status: PrestoStatusLike = { available: false, reason: "offline" };
const _state: BannerState = stateFromStatus(status);
const _defined: boolean = definePrestoBanner();
const _variants: readonly string[] = BANNER_VARIANTS;
void _state;
void _defined;
void _variants;

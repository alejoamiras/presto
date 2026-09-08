import type { BannerState, PrestoStatusLike } from "./types.js";

const REASON_STATES: Readonly<Record<string, BannerState>> = {
  offline: "offline",
  "permission-blocked": "permission-blocked",
  "secure-connection-unavailable": "secure-connection-unavailable",
  "version-mismatch": "version-mismatch",
  error: "error",
};

/**
 * Map an SDK `PrestoStatus` to the banner state that renders it. A reason this package does not
 * know maps to `error` (Presto answered, something is wrong) rather than `offline`, so a future SDK
 * outcome never pitches an install to someone who already has it.
 */
export function stateFromStatus(status: PrestoStatusLike): BannerState {
  if (status.available) return status.needsDownload ? "downloading" : "available";
  return REASON_STATES[status.reason ?? ""] ?? "error";
}

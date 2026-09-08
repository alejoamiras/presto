import type { BannerState, PrestoStatusLike } from "./types.js";

const REASON_STATES: Readonly<Record<string, BannerState>> = {
  offline: "offline",
  "permission-blocked": "permission-blocked",
  "secure-connection-unavailable": "secure-connection-unavailable",
  "version-mismatch": "version-mismatch",
  error: "error",
};

/**
 * Map an SDK `PrestoStatus` to the banner state that renders it.
 *
 * Under the browser's HTTPS-only default an uninstalled Presto does not surface as `offline`: both
 * probes fail and the SDK reports `secure-connection-unavailable` with an `unconfirmed` diagnosis.
 * That case is the install pitch. The other diagnoses (`https-disabled`, `tls-or-trust-failure`,
 * `presto-reachable`) prove Presto is there and HTTPS is what needs fixing. A reason this package does
 * not know maps to `error` (Presto answered, something is wrong) rather than `offline`, so a future
 * SDK outcome never pitches an install to someone who already has it.
 */
export function stateFromStatus(status: PrestoStatusLike): BannerState {
  if (status.available) return status.needsDownload ? "downloading" : "available";
  const reason = status.reason ?? "";
  if (reason === "secure-connection-unavailable" && status.diagnosis === "unconfirmed") {
    return "offline";
  }
  return Object.hasOwn(REASON_STATES, reason) ? (REASON_STATES[reason] as BannerState) : "error";
}

/** The six surfaces of the install-banner kit. */
export type BannerVariant = "ribbon" | "billboard" | "dock" | "card" | "tile" | "sheet";

/**
 * Banner state, one per SDK `PrestoStatus` outcome, plus `connect`. `downloading` is
 * `available: true` with `needsDownload: true`; `available` is the connected outcome that plays the
 * detected morph. `connect` is never derived from a status: the host sets it before its first
 * request to Presto, while the browser has not yet been asked (`loopbackPermission()` is `prompt` or
 * `unsupported`).
 */
export type BannerState =
  | "offline"
  | "permission-blocked"
  | "secure-connection-unavailable"
  | "version-mismatch"
  | "error"
  | "downloading"
  | "available"
  | "connect";

export type BannerTheme = "auto" | "light" | "dark";

/** Colour role of a state: accent pitches, warn asks the user to fix something, go celebrates. */
export type BannerTone = "accent" | "warn" | "go";

export type BannerPlatform = "macOS" | "Windows" | "Linux";

/**
 * Structural view of the SDK's `PrestoStatus` so this package needs no runtime or type dependency
 * on it. Any `PrestoStatus` value is assignable (pinned by `status.test.ts`).
 */
export interface PrestoStatusLike {
  readonly available: boolean;
  readonly reason?: string;
  /** SDK's `SecureConnectionDiagnosis`; `unconfirmed` means Presto may simply not be installed. */
  readonly diagnosis?: string;
  readonly needsDownload?: boolean;
}

export const BANNER_VARIANTS: readonly BannerVariant[] = [
  "ribbon",
  "billboard",
  "dock",
  "card",
  "tile",
  "sheet",
];

export const BANNER_STATES: readonly BannerState[] = [
  "offline",
  "permission-blocked",
  "secure-connection-unavailable",
  "version-mismatch",
  "error",
  "downloading",
  "available",
  "connect",
];

/** Event names dispatched by `<presto-banner>` (bubbling, composed). */
export const BANNER_EVENTS = {
  /** The install CTA was activated. Navigation to `href` is the default action. */
  cta: "presto-banner:cta",
  /**
   * Connect was pressed: the host should run its first status check now (the browser may ask) and
   * set `state` or `status`. The button reads "Connecting…" until the host sets `state` again, even
   * to the same value.
   */
  connect: "presto-banner:connect",
  /** A warn-state Retry was pressed; the host should re-run `checkPrestoStatus()`. */
  retry: "presto-banner:retry",
  /** The banner was dismissed; `detail.forever` when the Sheet's checkbox was ticked. */
  dismiss: "presto-banner:dismiss",
  /** The detected morph finished and the banner hid itself. */
  collapsed: "presto-banner:collapsed",
} as const;

export interface BannerEventDetail {
  variant: BannerVariant;
  state: BannerState | null;
  href: string;
  forever?: boolean;
}

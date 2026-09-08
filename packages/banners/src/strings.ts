import type { BannerState, BannerTone, BannerVariant } from "./types.js";

/** What the primary control does in a state: open `href`, ask the host to retry, or just report. */
export type PrimaryKind = "cta" | "retry" | "status";

export interface StateStrings {
  tone: BannerTone;
  title: string;
  support: string;
  primary: PrimaryKind;
  /** Label of the primary control (`status` kinds render it beside a breathing dot). */
  primaryLabel: string;
}

const CTA = "Get Presto";
const RETRY = "Retry";
export const DECLINE = "Continue in browser";
export const DISMISS = "Dismiss";
export const CONNECTED_TITLE = "Presto connected";
export const CONNECTED_SUPPORT = "proving natively";

const NEEDS_UPDATE: StateStrings = {
  tone: "warn",
  title: "Presto needs an update for this app",
  support: "Open Presto from your menu bar and let it update",
  primary: "retry",
  primaryLabel: RETRY,
};

/** Copy for every state, as rendered by the Ribbon (the only surface that carries them all). */
export const STRINGS: Readonly<Record<BannerState, StateStrings>> = {
  offline: {
    tone: "accent",
    title: "This app proves faster with Presto",
    support: "Install once, nothing to configure",
    primary: "cta",
    primaryLabel: CTA,
  },
  "permission-blocked": {
    tone: "warn",
    title: "Your browser blocked local access",
    support: "Allow local network access for this site, then retry",
    primary: "retry",
    primaryLabel: RETRY,
  },
  "secure-connection-unavailable": {
    tone: "warn",
    title: "Presto is installed, but its encrypted connection is off",
    support: "Open Presto → Settings → Encrypted Connection",
    primary: "retry",
    primaryLabel: RETRY,
  },
  "version-mismatch": NEEDS_UPDATE,
  error: NEEDS_UPDATE,
  downloading: {
    tone: "accent",
    title: "Presto is fetching the prover for this app",
    support: "One-time download, then every proof is native",
    primary: "status",
    primaryLabel: "Downloading",
  },
  available: {
    tone: "go",
    title: CONNECTED_TITLE,
    support: CONNECTED_SUPPORT,
    primary: "status",
    primaryLabel: "Native",
  },
};

/** Surface-specific copy for the install pitch. Every surface says what Presto does, never what it is. */
export const VARIANT_COPY = {
  billboard: {
    title: "Fast proofs. Like magic",
    support:
      "Install once. This app, and every Aztec app you open, proves at native speed instead of in your browser.",
    cta: CTA,
  },
  dock: {
    title: "Proving in your browser…",
    support: "Next time, let Presto do it natively.",
    cta: CTA,
    raceBrowser: "Browser",
    racePresto: "Presto",
  },
  card: {
    eyebrow: "Faster proofs",
    title: "Prove at native speed",
    support:
      "Install Presto once and this app, and every Aztec app you open, gets faster. No setup, no accounts.",
    cta: CTA,
    note: "Free · open source · macOS, Linux, Windows",
  },
  tile: {
    title: "Fast proofs.<br>Like magic.",
    support: "Install once. Every Aztec app you open proves at native speed.",
    cta: CTA,
    link: "How it works →",
  },
  sheet: {
    title: "Prove faster with Presto?",
    support:
      "This app can prove in your browser, or hand it to <strong>Presto</strong>, which does it at native speed. Either way, proving stays on your machine.",
    cta: CTA,
    ctaFor: "Get Presto for",
    decline: DECLINE,
    never: "Don't ask again",
    foot: "Free · open source ·",
    otherPlatforms: "other platforms",
  },
} as const;

/**
 * States each surface renders. Ribbon carries every outcome because the post-install ones
 * (permission, HTTPS, update) are the ones a user hits after installing, and a strip is the least
 * intrusive place to say so. Tile is static and ignores state entirely.
 */
export const VARIANT_STATES: Readonly<Record<BannerVariant, readonly BannerState[] | "any">> = {
  ribbon: [
    "offline",
    "permission-blocked",
    "secure-connection-unavailable",
    "version-mismatch",
    "error",
    "downloading",
    "available",
  ],
  billboard: ["offline", "available"],
  dock: ["offline", "available"],
  card: ["offline", "available"],
  tile: "any",
  sheet: ["offline", "available"],
};

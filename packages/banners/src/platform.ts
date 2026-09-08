import type { BannerPlatform } from "./types.js";

/**
 * Desktop platform from a user-agent string, for the Sheet's "Get Presto for macOS" primary.
 * Phones and tablets return `null` (nothing to install there), and so does anything unrecognised,
 * so the label degrades to plain "Get Presto".
 */
export function detectPlatform(userAgent: string): BannerPlatform | null {
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)) return null;
  if (/Windows/i.test(userAgent)) return "Windows";
  if (/Mac OS X|Macintosh/i.test(userAgent)) return "macOS";
  if (/Linux|X11/i.test(userAgent)) return "Linux";
  return null;
}

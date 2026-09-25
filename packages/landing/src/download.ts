export const REPO = "alejoamiras/presto";
export const RELEASES_URL = `https://github.com/${REPO}/releases`;

/** Release asset names, e.g. `Presto-1.1.2-macOS-Apple-Silicon.dmg`. Each matches exactly one asset. */
export const ASSETS = {
  macArm: /-macOS-Apple-Silicon\.dmg$/,
  macIntel: /-macOS-Intel\.dmg$/,
  windows: /-Windows-x86_64-setup\.exe$/,
  linux: /-Linux-x86_64\.AppImage$/,
} as const;

/** What the page knows about the visitor's device. */
export interface DeviceSignals {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  /** `navigator.userAgentData.mobile`; set only by browsers with client hints (Chromium). */
  mobile?: boolean;
  /** From {@link readArchitecture}; Chromium only (`"arm"`, `"x86"`). */
  architecture?: string;
}

/** What the download button offers. */
export interface DownloadChoice {
  label: string;
  /** The release asset to link; `null` keeps the link on the releases page. */
  asset: RegExp | null;
  /** The other macOS build, offered beside the primary one. */
  alternate?: { label: string; asset: RegExp };
  /** Replaces the note under the button. */
  note?: string;
}

/**
 * Phones and tablets, where Presto cannot be installed. iPadOS sends a Mac user agent by default, and
 * Android's desktop mode a Linux x86_64 one with non-mobile hints, which leaves touch as the only tell:
 * touchscreen Linux laptops get the release page too.
 */
export function isHandheld(device: DeviceSignals): boolean {
  return (
    device.mobile === true ||
    /Android|iPhone|iPad|iPod/.test(device.userAgent) ||
    (device.platform === "MacIntel" && device.maxTouchPoints > 1) ||
    (/Linux/.test(device.userAgent) && device.maxTouchPoints > 0)
  );
}

export function chooseDownload(device: DeviceSignals): DownloadChoice {
  // Before the desktop checks: iPhone user agents contain "Mac OS X", Android ones contain "Linux".
  if (isHandheld(device)) {
    return {
      label: "See desktop downloads",
      asset: null,
      note: "Presto is a desktop app for macOS, Windows and Linux.",
    };
  }
  const ua = device.userAgent;
  if (/Windows/.test(ua)) return { label: "Get Presto for Windows", asset: ASSETS.windows };
  if (/Macintosh|Mac OS X/.test(ua)) {
    // Only Chromium reports the architecture, and Safari's user agent says "Intel" on every Mac,
    // so anything unreported defaults to Apple Silicon with the Intel build one click away.
    return device.architecture === "x86"
      ? {
          label: "Get Presto for macOS",
          asset: ASSETS.macIntel,
          alternate: {
            label: "Apple Silicon Mac? Get the Apple Silicon build",
            asset: ASSETS.macArm,
          },
        }
      : {
          label: "Get Presto for macOS",
          asset: ASSETS.macArm,
          alternate: { label: "Intel Mac? Get the Intel build", asset: ASSETS.macIntel },
        };
  }
  // ChromeOS says "X11; CrOS", not Linux. There is no ARM Linux build, and a browser with client
  // hints says x86_64 on every Linux machine, so there only a positive x86 hint picks the AppImage.
  const x86 =
    device.mobile === undefined ? !/aarch64|arm64|armv\d/i.test(ua) : device.architecture === "x86";
  if (/Linux/.test(ua) && !/CrOS/.test(ua) && x86) {
    return { label: "Get Presto for Linux", asset: ASSETS.linux };
  }
  return { label: "Get Presto", asset: null };
}

interface UserAgentData {
  mobile?: boolean;
  getHighEntropyValues?(hints: string[]): Promise<{ architecture?: unknown } | null>;
}

const userAgentData = (nav: Navigator) =>
  (nav as Navigator & { userAgentData?: UserAgentData }).userAgentData;

/** The signals a browser answers synchronously; {@link readArchitecture} supplies the rest. */
export function readDeviceSignals(nav: Navigator = navigator): DeviceSignals {
  return {
    userAgent: nav.userAgent,
    platform: nav.platform,
    maxTouchPoints: nav.maxTouchPoints,
    mobile: userAgentData(nav)?.mobile,
  };
}

/**
 * Chromium's architecture hint, or `undefined` when the browser has none, refuses it, or has not
 * answered within `timeoutMs` (the spec lets it take its time). Never rejects.
 */
export async function readArchitecture(
  nav: Navigator = navigator,
  timeoutMs = 500,
): Promise<string | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const hint = userAgentData(nav)?.getHighEntropyValues?.(["architecture"]);
    if (!hint) return undefined;
    const timeout = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), timeoutMs);
    });
    const architecture = (await Promise.race([hint, timeout]))?.architecture;
    return typeof architecture === "string" ? architecture : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

export const releasePage = (tag: string) => `${RELEASES_URL}/tag/${tag}`;

/** Where the download button and the other-architecture link point. */
export interface DownloadLinks {
  href: string;
  alternate?: { label: string; href: string };
}

/**
 * The links for `choice` in release `tag`, given the GitHub API's `assets` (`undefined` when that
 * request failed). A missing asset leaves the button on the release page.
 */
export function downloadLinks(choice: DownloadChoice, tag: string, assets: unknown): DownloadLinks {
  const links: DownloadLinks = {
    href: (choice.asset && findAssetUrl(assets, choice.asset, tag)) || releasePage(tag),
  };
  const alternate = choice.alternate && findAssetUrl(assets, choice.alternate.asset, tag);
  if (choice.alternate && alternate)
    links.alternate = { label: choice.alternate.label, href: alternate };
  return links;
}

/**
 * The download URL of the asset `pattern` matches. The API response is untrusted, so the URL must be
 * exactly that asset's download path in `tag`; anything else (another host or repository, a
 * `javascript:` URL) counts as missing.
 */
function findAssetUrl(assets: unknown, pattern: RegExp, tag: string): string | undefined {
  if (!Array.isArray(assets)) return undefined;
  for (const asset of assets) {
    const name: unknown = asset?.name;
    if (typeof name !== "string" || !pattern.test(name)) continue;
    const url = `${RELEASES_URL}/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`;
    if (asset.browser_download_url === url) return url;
  }
  return undefined;
}

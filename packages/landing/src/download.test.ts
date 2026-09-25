import { describe, expect, test } from "bun:test";
import {
  ASSETS,
  chooseDownload,
  type DeviceSignals,
  downloadLinks,
  readArchitecture,
  readDeviceSignals,
} from "./download";

const MAC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const MAC_CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const LINUX_CHROME_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

const desktop = { platform: "", maxTouchPoints: 0 };
const device = (overrides: Partial<DeviceSignals> & { userAgent: string }): DeviceSignals => ({
  ...desktop,
  ...overrides,
});

const TAG = "presto-v1.1.2";
const DOWNLOADS = `https://github.com/alejoamiras/presto/releases/download/${TAG}`;
const RELEASE_PAGE = `https://github.com/alejoamiras/presto/releases/tag/${TAG}`;

// The assets of a real release, as the GitHub API lists them.
const RELEASE_ASSETS = [
  "latest.json",
  "Presto-1.1.2-Linux-x86_64.AppImage",
  "Presto-1.1.2-Linux-x86_64.deb",
  "Presto-1.1.2-macOS-Apple-Silicon.app.tar.gz",
  "Presto-1.1.2-macOS-Apple-Silicon.dmg",
  "Presto-1.1.2-macOS-Intel.app.tar.gz",
  "Presto-1.1.2-macOS-Intel.dmg",
  "Presto-1.1.2-Windows-x86_64-setup.exe",
  "Presto-1.1.2-Windows-x86_64-setup.nsis.zip",
  "presto-server-1.1.2-linux-arm64.tar.gz",
  "presto-server-1.1.2-macos-arm64.tar.gz",
  "presto-server-1.1.2-macos-x86_64.tar.gz",
].map((name) => ({ name, browser_download_url: `${DOWNLOADS}/${name}` }));

// "note": no installer, and the note says Presto is a desktop app. "release page": no installer.
const DEVICES: [string, DeviceSignals, string][] = [
  [
    "iPhone Safari",
    device({
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      platform: "iPhone",
      maxTouchPoints: 5,
    }),
    "note",
  ],
  [
    "iPad Safari, desktop user agent",
    device({ userAgent: MAC_UA, platform: "MacIntel", maxTouchPoints: 5 }),
    "note",
  ],
  [
    "Android phone Chrome",
    device({
      userAgent:
        "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
      mobile: true,
      maxTouchPoints: 5,
    }),
    "note",
  ],
  [
    "Android tablet Chrome",
    device({
      userAgent:
        "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
      mobile: false,
      maxTouchPoints: 10,
    }),
    "note",
  ],
  [
    "Android desktop mode",
    device({
      userAgent: LINUX_CHROME_UA,
      mobile: false,
      maxTouchPoints: 10,
      architecture: "x86",
    }),
    "note",
  ],
  [
    "Mac Safari",
    device({ userAgent: MAC_UA, platform: "MacIntel" }),
    "Presto-1.1.2-macOS-Apple-Silicon.dmg",
  ],
  [
    "Apple Silicon Mac Chrome",
    device({ userAgent: MAC_CHROME_UA, platform: "MacIntel", architecture: "arm" }),
    "Presto-1.1.2-macOS-Apple-Silicon.dmg",
  ],
  [
    "Intel Mac Chrome",
    device({ userAgent: MAC_CHROME_UA, platform: "MacIntel", architecture: "x86" }),
    "Presto-1.1.2-macOS-Intel.dmg",
  ],
  [
    "Windows with a touchscreen",
    device({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0.0.0",
      platform: "Win32",
      maxTouchPoints: 10,
    }),
    "Presto-1.1.2-Windows-x86_64-setup.exe",
  ],
  [
    "Linux Firefox",
    device({
      userAgent: "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0",
      platform: "Linux x86_64",
    }),
    "Presto-1.1.2-Linux-x86_64.AppImage",
  ],
  [
    "Linux Chrome",
    device({ userAgent: LINUX_CHROME_UA, mobile: false, architecture: "x86" }),
    "Presto-1.1.2-Linux-x86_64.AppImage",
  ],
  [
    "ARM Linux Firefox",
    device({
      userAgent: "Mozilla/5.0 (X11; Linux aarch64; rv:140.0) Gecko/20100101 Firefox/140.0",
    }),
    "release page",
  ],
  [
    "ARM Linux Chrome",
    device({ userAgent: LINUX_CHROME_UA, mobile: false, architecture: "arm" }),
    "release page",
  ],
  [
    "ChromeOS",
    device({
      userAgent:
        "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
      mobile: false,
    }),
    "release page",
  ],
  ["unknown", device({ userAgent: "SomeBot/1.0" }), "release page"],
];

describe("chooseDownload", () => {
  test.each(DEVICES)("%s", (_name, signals, expected) => {
    const choice = chooseDownload(signals);
    const { href } = downloadLinks(choice, TAG, RELEASE_ASSETS);
    const installer = expected === "note" || expected === "release page" ? null : expected;
    expect(href).toBe(installer ? `${DOWNLOADS}/${installer}` : RELEASE_PAGE);
    expect(choice.note?.includes("desktop app") ?? false).toBe(expected === "note");
  });

  test("Macs are offered the other architecture beside the default", () => {
    const safari = chooseDownload(device({ userAgent: MAC_UA, platform: "MacIntel" }));
    expect(downloadLinks(safari, TAG, RELEASE_ASSETS).alternate).toEqual({
      label: "Intel Mac? Get the Intel build",
      href: `${DOWNLOADS}/Presto-1.1.2-macOS-Intel.dmg`,
    });
    const intelChrome = chooseDownload(
      device({ userAgent: MAC_CHROME_UA, platform: "MacIntel", architecture: "x86" }),
    );
    expect(intelChrome.alternate?.asset).toBe(ASSETS.macArm);
  });
});

describe("downloadLinks", () => {
  const mac = chooseDownload(device({ userAgent: MAC_UA, platform: "MacIntel" }));
  const without = (name: string) => RELEASE_ASSETS.filter((asset) => !asset.name.endsWith(name));

  test.each([
    ["the API request failed", undefined, RELEASE_PAGE, false],
    ["the API answered without assets", { message: "Not Found" }, RELEASE_PAGE, false],
    ["the primary build is missing", without("Apple-Silicon.dmg"), RELEASE_PAGE, true],
    [
      "the alternate build is missing",
      without("Intel.dmg"),
      `${DOWNLOADS}/Presto-1.1.2-macOS-Apple-Silicon.dmg`,
      false,
    ],
  ])("%s", (_name, assets, href, alternate) => {
    const links = downloadLinks(mac, TAG, assets);
    expect(links.href).toBe(href);
    expect(links.alternate !== undefined).toBe(alternate);
  });

  test.each([
    "javascript:alert(1)",
    "https://evil.example/Presto-1.1.2-macOS-Apple-Silicon.dmg",
    "https://github.com/someone/presto/releases/download/presto-v1.1.2/Presto-1.1.2-macOS-Apple-Silicon.dmg",
    `${DOWNLOADS.replace("1.1.2", "1.0.0")}/Presto-1.1.2-macOS-Apple-Silicon.dmg`,
    `https://user@github.com/alejoamiras/presto/releases/download/${TAG}/Presto-1.1.2-macOS-Apple-Silicon.dmg`,
    `${DOWNLOADS}/Presto-1.1.2-macOS-Apple-Silicon.dmg?x=1`,
  ])("an untrusted URL falls back to the release page: %s", (url) => {
    const assets = [{ name: "Presto-1.1.2-macOS-Apple-Silicon.dmg", browser_download_url: url }];
    expect(downloadLinks(mac, TAG, assets).href).toBe(RELEASE_PAGE);
  });
});

describe("readArchitecture", () => {
  const nav = (getHighEntropyValues?: () => unknown) =>
    ({ userAgentData: getHighEntropyValues && { getHighEntropyValues } }) as unknown as Navigator;

  test.each([
    ["answers x86", () => Promise.resolve({ architecture: "x86" }), "x86"],
    ["answers arm", () => Promise.resolve({ architecture: "arm" }), "arm"],
    ["refuses", () => Promise.reject(new Error("NotAllowedError")), undefined],
    ["never answers", () => new Promise(() => {}), undefined],
    [
      "throws",
      () => {
        throw new Error("boom");
      },
      undefined,
    ],
    ["answers nonsense", () => Promise.resolve({ architecture: 64 }), undefined],
    ["has no hints", undefined, undefined],
  ])("the browser %s", async (_name, hint, expected) => {
    const architecture = await readArchitecture(nav(hint), 10);
    expect(architecture).toBe(expected);
    // Chromium says x86_64 on every Linux machine, so anything short of an x86 hint is unknown hardware.
    const linux = chooseDownload(
      device({ userAgent: LINUX_CHROME_UA, mobile: false, architecture }),
    );
    expect(linux.asset).toBe(expected === "x86" ? ASSETS.linux : null);
  });

  test("the synchronous signals carry the mobile hint", () => {
    const signals = readDeviceSignals({
      userAgent: MAC_UA,
      platform: "MacIntel",
      maxTouchPoints: 0,
      userAgentData: { mobile: false },
    } as unknown as Navigator);
    expect(signals).toEqual({
      userAgent: MAC_UA,
      platform: "MacIntel",
      maxTouchPoints: 0,
      mobile: false,
    });
  });
});

test("each asset pattern matches exactly one asset of a real release", () => {
  for (const pattern of Object.values(ASSETS)) {
    expect(RELEASE_ASSETS.filter((asset) => pattern.test(asset.name))).toHaveLength(1);
  }
});

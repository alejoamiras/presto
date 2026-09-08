import { describe, expect, test } from "bun:test";
import { detectPlatform } from "./platform.js";

describe("detectPlatform", () => {
  test.each([
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15", "macOS"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", "Windows"],
    ["Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36", "Linux"],
    // Phones and tablets have nothing to install: the CTA degrades to plain "Get Presto".
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
      null,
    ],
    ["Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Mobile Safari/537.36", null],
    ["", null],
  ])("%s → %s", (ua, expected) => {
    expect(detectPlatform(ua)).toBe(expected as ReturnType<typeof detectPlatform>);
  });
});

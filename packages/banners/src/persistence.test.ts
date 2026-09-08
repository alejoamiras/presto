import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { clearDismissal, DAY_MS, dismiss, isDismissed } from "./persistence.js";

const KEY = "presto:banner:test";

describe("dismissal persistence", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => setSystemTime());

  test("a dismissal lasts `days`, then the key is free again", () => {
    setSystemTime(new Date("2026-09-08T12:00:00Z"));
    dismiss(KEY, { days: 7 });
    expect(isDismissed(KEY)).toBe(true);
    setSystemTime(new Date(Date.now() + 6 * DAY_MS));
    expect(isDismissed(KEY)).toBe(true);
    setSystemTime(new Date(Date.now() + 2 * DAY_MS));
    expect(isDismissed(KEY)).toBe(false);
  });

  test("forever survives any clock, and clearDismissal lifts it", () => {
    dismiss(KEY, { forever: true });
    setSystemTime(new Date("2099-01-01T00:00:00Z"));
    expect(isDismissed(KEY)).toBe(true);
    clearDismissal(KEY);
    expect(isDismissed(KEY)).toBe(false);
  });

  test("a corrupt or foreign record never suppresses the banner", () => {
    localStorage.setItem(KEY, "not json");
    expect(isDismissed(KEY)).toBe(false);
    localStorage.setItem(KEY, JSON.stringify({ until: "tomorrow" }));
    expect(isDismissed(KEY)).toBe(false);
    localStorage.setItem(KEY, JSON.stringify({ something: 1 }));
    expect(isDismissed(KEY)).toBe(false);
  });
});

import { describe, expect, test } from "bun:test";
import type { PrestoStatus } from "@alejoamiras/presto";
import { stateFromStatus } from "./status.js";
import type { PrestoStatusLike } from "./types.js";

// Compile-time contract: every SDK outcome is a PrestoStatusLike, so `banner.status = await
// prover.checkPrestoStatus()` typechecks without this package depending on the SDK at runtime.
const _sdkStatusIsAssignable: PrestoStatus extends PrestoStatusLike ? true : never = true;

describe("stateFromStatus", () => {
  const cases: [PrestoStatus, string][] = [
    [{ available: true, needsDownload: false, protocol: "https" }, "available"],
    [{ available: true, needsDownload: true, protocol: "https" }, "downloading"],
    [{ available: false, reason: "offline" }, "offline"],
    [{ available: false, reason: "permission-blocked" }, "permission-blocked"],
    [
      { available: false, reason: "secure-connection-unavailable", diagnosis: "unconfirmed" },
      "secure-connection-unavailable",
    ],
    [
      {
        available: false,
        reason: "version-mismatch",
        nativeAztecVersion: "1.0.0",
        protocol: "http",
      },
      "version-mismatch",
    ],
    [{ available: false, reason: "error", protocol: "https" }, "error"],
  ];

  test.each(cases)("%j → %s", (status, expected) => {
    expect(stateFromStatus(status)).toBe(expected as ReturnType<typeof stateFromStatus>);
  });

  test("an unknown reason is an error, never an install pitch", () => {
    expect(stateFromStatus({ available: false, reason: "something-new" })).toBe("error");
    expect(stateFromStatus({ available: false })).toBe("error");
  });
});

import { describe, expect, test } from "bun:test";
import type { PrestoStatus, SecureConnectionDiagnosis } from "@alejoamiras/presto";
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
      { available: false, reason: "secure-connection-unavailable", diagnosis: "https-disabled" },
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

  test("an unknown reason is an error, never an install pitch (prototype keys included)", () => {
    expect(stateFromStatus({ available: false, reason: "something-new" })).toBe("error");
    expect(stateFromStatus({ available: false })).toBe("error");
    expect(stateFromStatus({ available: false, reason: "constructor" })).toBe("error");
    expect(stateFromStatus({ available: false, reason: "__proto__" })).toBe("error");
  });

  // Browser HTTPS-only default: an uninstalled Presto fails both probes and reports this pair.
  test("secure-connection-unavailable + unconfirmed is the install pitch; other diagnoses are not", () => {
    const secure = (diagnosis: SecureConnectionDiagnosis) =>
      stateFromStatus({ available: false, reason: "secure-connection-unavailable", diagnosis });
    expect(secure("unconfirmed")).toBe("offline");
    expect(secure("https-disabled")).toBe("secure-connection-unavailable");
    expect(secure("tls-or-trust-failure")).toBe("secure-connection-unavailable");
    expect(secure("presto-reachable")).toBe("secure-connection-unavailable");
  });
});

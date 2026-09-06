// Shared shims (logger worker-transport bypass + expect compat) — import side effects only.
import "../src/test-setup.ts";

/**
 * E2E test setup — runs once before all test files via preload.
 *
 * Asserts that Aztec node is reachable (mandatory).
 * Presto health is only checked when PRESTO_URL is set
 * (the presto is a desktop app — optional by design).
 * Throws immediately if required services are unavailable.
 */

import { configure, getConsoleSink, parseLogLevel } from "@logtape/logtape";

// Configure LogTape
const logLevel = parseLogLevel(process.env.LOG_LEVEL || "warning");

await configure({
  sinks: {
    console: getConsoleSink(),
  },
  loggers: [
    {
      category: ["logtape", "meta"],
      sinks: ["console"],
      lowestLevel: "warning",
    },
    {
      category: ["presto"],
      sinks: ["console"],
      lowestLevel: logLevel,
    },
  ],
});

// Environment configuration
export const config = {
  nodeUrl: process.env.AZTEC_NODE_URL || "http://localhost:8080",
  /** Optional presto URL — accelerated tests are skipped when not set. */
  prestoUrl: process.env.PRESTO_URL || "",
};

/** True when pointing at a local sandbox (default). */
export const isLocalNetwork =
  config.nodeUrl.includes("localhost") || config.nodeUrl.includes("127.0.0.1");

// Assert local services are available — fail fast with a clear message.
// Only checks when targeting local network. Remote networks (testnet) are
// validated by the test files themselves (remote-network.test.ts, etc.).
async function assertLocalServicesAvailable(): Promise<void> {
  if (!isLocalNetwork) return;

  const aztecOk = await fetch(`${config.nodeUrl}/status`, { signal: AbortSignal.timeout(5000) })
    .then((r) => r.ok)
    .catch(() => false);

  if (!aztecOk) {
    throw new Error(
      `Aztec node not available at ${config.nodeUrl}. ` +
        "Start Aztec local network before running e2e tests.\n" +
        "  aztec start --local-network",
    );
  }

  if (config.prestoUrl) {
    const prestoOk = await fetch(`${config.prestoUrl}/health`, {
      signal: AbortSignal.timeout(5000),
    })
      .then((r) => r.ok)
      .catch(() => false);

    if (!prestoOk) {
      throw new Error(
        `Presto not available at ${config.prestoUrl}. ` +
          "PRESTO_URL is set but the presto is not responding.\n" +
          "  Start the presto desktop app or unset PRESTO_URL to skip presto tests.",
      );
    }
  }
}

await assertLocalServicesAvailable();

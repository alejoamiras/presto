import type { PrestoConfig } from "./types.js";

const DEFAULT_PRESTO_PORT = 59833;
const DEFAULT_PRESTO_HTTPS_PORT = 59834;
const DEFAULT_PRESTO_HOST = "127.0.0.1";

/** Parse the documented boolean environment spellings without weakening the browser-safe default. */
export function parseOptionalBooleanEnv(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  switch (value.toLowerCase()) {
    case "1":
    case "true":
      return true;
    case "0":
    case "false":
      return false;
    default:
      return undefined;
  }
}

/** Resolve HTTPS policy with explicit option > environment > runtime default precedence. */
export function resolveHttpsOnly(
  option: boolean | undefined,
  environment: string | undefined,
  browserRuntime: boolean,
): boolean {
  return option ?? parseOptionalBooleanEnv(environment) ?? browserRuntime;
}

/** A page or a Web Worker: both must default to HTTPS-only private proving. */
export function isBrowserRuntime(): boolean {
  if (typeof window !== "undefined") return true;
  const workerGlobalScope = (
    globalThis as typeof globalThis & {
      WorkerGlobalScope?: { new (...args: never[]): object };
    }
  ).WorkerGlobalScope;
  return typeof workerGlobalScope === "function" && globalThis instanceof workerGlobalScope;
}

export interface ResolvedPrestoConfig {
  host: string;
  port: number;
  httpsPort: number;
  httpsOnly: boolean;
  allowInsecureDowngrade: boolean;
}

function parsePort(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/** Explicit config > `PRESTO_*` environment > defaults. */
export function resolvePrestoConfig(configured: PrestoConfig = {}): ResolvedPrestoConfig {
  const environment = typeof process === "undefined" ? undefined : process.env;
  return {
    host: configured.host ?? DEFAULT_PRESTO_HOST,
    port: configured.port ?? parsePort(environment?.PRESTO_PORT, DEFAULT_PRESTO_PORT),
    httpsPort:
      configured.httpsPort ?? parsePort(environment?.PRESTO_HTTPS_PORT, DEFAULT_PRESTO_HTTPS_PORT),
    httpsOnly: resolveHttpsOnly(
      configured.httpsOnly,
      environment?.PRESTO_HTTPS_ONLY,
      isBrowserRuntime(),
    ),
    allowInsecureDowngrade:
      configured.allowInsecureDowngrade ??
      parseOptionalBooleanEnv(environment?.PRESTO_ALLOW_INSECURE_DOWNGRADE) ??
      false,
  };
}

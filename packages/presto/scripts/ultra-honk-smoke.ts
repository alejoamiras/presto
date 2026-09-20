#!/usr/bin/env bun
/**
 * HTTP smoke for `POST /prove/ultra-honk` against a running presto (headless or desktop): proves the
 * committed Noir fixtures, checks the bytes against their bb.js WASM references, and verifies them
 * with the native bb — the route proven end to end without any SDK. The checks themselves live in
 * `ultra-honk-smoke-checks.ts`, which stays runtime-neutral; this entrypoint is Bun-only.
 *
 *   PRESTO_URL       base URL (default http://127.0.0.1:59833)
 *   BB_BINARY_PATH   the bb used for `bb verify` (default: the installed @aztec/bb.js native binary)
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { resolveAztecBb } from "./copy-bb.ts";
import { smoke } from "./ultra-honk-smoke-checks.ts";

export function defaultBbPath(): string {
  const fromEnv = process.env.BB_BINARY_PATH;
  if (fromEnv) return fromEnv;
  const arch = process.arch === "x64" ? "amd64" : process.arch;
  const os = process.platform === "darwin" ? "macos" : process.platform;
  return join(resolveAztecBb().bbJsRoot, "build", `${arch}-${os}`, "bb");
}

if (import.meta.main) {
  const root = join(import.meta.dirname, "..", "..", "..");
  const bb = defaultBbPath();
  if (!existsSync(bb)) {
    console.error(`bb not found at ${bb}; set BB_BINARY_PATH`);
    process.exit(1);
  }
  const problems = await smoke(root, process.env.PRESTO_URL ?? "http://127.0.0.1:59833", bb);
  for (const problem of problems) console.error(problem);
  if (problems.length > 0) process.exit(1);
  console.log("ultra-honk smoke passed");
}

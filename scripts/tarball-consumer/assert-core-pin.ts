// Assert that a packed/installed SDK manifest's `@alejoamiras/presto-core` pin names the core manifest
// installed beside it: an exact pin must equal the core's version, a `workspace:` range (an
// unrewritten workspace pack) accepts the workspace copy. Any other range is a broken publish rewrite.
//
//   bun scripts/tarball-consumer/assert-core-pin.ts <sdk-package.json> <core-package.json>

import { readFileSync } from "node:fs";

export const CORE_NAME = "@alejoamiras/presto-core";

/** The version an SDK whose core range is `range` must find installed, or `undefined` for any. */
export function expectedCoreVersion(range: string | undefined): string | undefined {
  if (range === undefined) throw new Error(`the SDK manifest does not depend on ${CORE_NAME}`);
  if (range.startsWith("workspace:")) return undefined;
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(range)) {
    throw new Error(`the SDK pins ${CORE_NAME} to ${JSON.stringify(range)}, not an exact version`);
  }
  return range;
}

export function assertCorePin(
  sdk: { dependencies?: Record<string, string> },
  core: { name?: string; version?: string },
): string {
  if (core.name !== CORE_NAME || !core.version) {
    throw new Error(`installed core manifest is not ${CORE_NAME}`);
  }
  const expected = expectedCoreVersion(sdk.dependencies?.[CORE_NAME]);
  if (expected !== undefined && expected !== core.version) {
    throw new Error(`the SDK pins ${CORE_NAME}@${expected} but ${core.version} is installed`);
  }
  return core.version;
}

if (import.meta.main) {
  const [sdkPath, corePath] = process.argv.slice(2);
  if (!sdkPath || !corePath) {
    console.error("usage: assert-core-pin.ts <sdk-package.json> <core-package.json>");
    process.exit(2);
  }
  const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
  try {
    console.log(`${CORE_NAME}@${assertCorePin(read(sdkPath), read(corePath))} matches the SDK pin`);
  } catch (error) {
    console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

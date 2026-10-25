# Codex fix loop, round 1 (gpt-6.1-sol, high)

Verdict: 2 material findings. Both were verified and fixed.

1. **Non-404 failures could read as absent** (`get-sdk-publish-version.ts`, demonstrated).
   - The path: a registry or proxy answers 500 with a reason phrase or body that contains `E404`.
     npm echoes that text to stderr, so `stderr.includes("E404")` returned `[]`.
   - The consequence: release planning would then plan a publish of a version that npm already
     holds.
   - Verified: `npm view <missing> versions --json` (npm 11.19.0) writes
     `{"error":{"code":"E404",…}}` to stdout. Its stderr repeats registry text.
   - Fix: classify `JSON.parse(stdout).error.code === "E404"`. This is the technique
     `update-aztec-version.ts` `parseNpmDependencies` already uses. Anything else throws, naming
     the code.
   - Test: the fake npm writes the JSON code to stdout and `npm error 500 upstream E404` to stderr.
     E404 gives `[]`. E500 for a name that contains `E404` throws.
2. **Other spellings of the leaf path bypassed the guard's import whitelist** (demonstrated).
   - The spellings: `././npm-command.ts` and `../scripts/npm-command.ts`.
   - Fix: `leafImportViolations` resolves each relative specifier with `Bun.resolveSync`
     against the module's directory.
   - It refuses a dynamic import of the leaf and an `export … from` the leaf.
   - Only a static `import { run[, NPM_TIMEOUT_MS] }` passes.
   - Three refusal cases were added.
   - Biome's 80-line function cap then tripped on the `publish job isolation` describe, so the scan
     loop was condensed to two lines.

Deviation from the plan: E404 is classified on npm's structured `error.code`, not on stderr.
This is stricter than the plan's stderr wording.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NPM_PACKAGES } from "./npm-packages.ts";

const repository = resolve(import.meta.dir, "..");
const read = (rel: string) => readFileSync(resolve(repository, rel), "utf8");
const reusable = read(".github/workflows/_ts-package-ci.yml");
const sdk = read(".github/workflows/sdk.yml");
const sdkCore = read(".github/workflows/sdk-core.yml");
const sdkNoir = read(".github/workflows/sdk-noir.yml");
const app = read(".github/workflows/app.yml");
const publish = read(".github/workflows/_publish-npm.yml");

describe("TypeScript package CI contract", () => {
  test("the reusable takes a descriptor key, never a publish credential, and consumes the candidate in bootstrap mode", () => {
    expect(reusable).toContain("workflow_call:");
    expect(reusable).toContain("package:");
    expect(reusable).not.toContain("id-token");
    expect(reusable).toContain("bun scripts/pack-candidate.ts --package");
    expect(reusable).toMatch(
      /bash scripts\/sdk-tarball-consumer\.sh "\$TARBALL" "\$PACKAGE" "\$\{with\[@\]\}"/,
    );
    for (const script of ["test:lint", "test:unit", "test:scripts", "typecheck:scripts"]) {
      expect(reusable).toContain(script);
    }
  });

  test("the release rerun consumes against the registry, not a packed dependency", () => {
    expect(publish).toContain('bash scripts/sdk-tarball-consumer.sh "$TARBALL" "$PACKAGE"');
    expect(publish).not.toContain("--with");
    expect(publish).not.toContain("pack-candidate.ts");
  });

  test("sdk.yml dispatches the reusable for every descriptor entry and gates on core changes", () => {
    const choices = sdk.slice(sdk.indexOf("options:"), sdk.indexOf("pull_request:"));
    for (const key of Object.keys(NPM_PACKAGES)) expect(choices).toContain(`- ${key}`);
    expect(sdk).toContain("uses: ./.github/workflows/_ts-package-ci.yml");
    expect(sdk).toMatch(/package: \$\{\{ inputs\.package \|\| 'presto' \}\}/);
    // Two packages dispatched on one ref must not cancel each other.
    expect(sdk).toMatch(/group: .*-\$\{\{ inputs\.package \|\| 'presto' \}\}/);
    expect(sdk).toMatch(/e2e_presto: \$\{\{ \(inputs\.package \|\| 'presto'\) == 'presto' \}\}/);
    for (const path of [
      "'packages/sdk/**'",
      "'packages/sdk-core/**'",
      "'.github/workflows/_ts-package-ci.yml'",
    ]) {
      expect(sdk).toContain(path);
    }
  });

  test("the Noir adapter's production gates run pre-merge: WASM identity and a live presto from this ref", () => {
    for (const job of ["identity:", "live:"]) expect(reusable).toContain(`\n  ${job}\n`);
    expect(reusable).toContain("test:identity");
    expect(reusable).toContain("test:e2e");
    expect(reusable).toContain("uses: ./.github/actions/start-headless-presto");
    // The live presto must serve the requested version from the sidecar, never download it.
    expect(reusable).toContain(
      'echo "AZTEC_BB_VERSION=$(cat packages/presto/src-tauri/AZTEC_VERSION)"',
    );
    expect(reusable).toMatch(/aztec-bb-version: \$\{\{ env\.AZTEC_BB_VERSION \}\}/);
    expect(reusable).toContain(
      "cargo build --locked --manifest-path packages/presto/server/Cargo.toml",
    );
    expect(sdkNoir).toContain("identity: true");
    expect(sdkNoir).toContain("live: true");
    for (const path of ["'packages/presto/core/**'", "'packages/presto/server/**'"]) {
      expect(sdkNoir).toContain(path);
    }
    expect(sdk).toMatch(/identity: \$\{\{ inputs\.package == 'presto-noir' \}\}/);
    expect(sdk).toMatch(/live: \$\{\{ inputs\.package == 'presto-noir' \}\}/);
    expect(sdkCore).not.toMatch(/identity|live:/);
  });

  test.each([
    ["sdk-core.yml", sdkCore, "presto-core", ["'packages/sdk-core/**'"]],
    [
      "sdk-noir.yml",
      sdkNoir,
      "presto-noir",
      ["'packages/sdk-noir/**'", "'packages/sdk-core/**'", "'fixtures/noir/**'"],
    ],
  ])("%s is a thin caller of the reusable", (_name, workflow, key, paths) => {
    expect(workflow).toContain("uses: ./.github/workflows/_ts-package-ci.yml");
    expect(workflow).toContain(`package: ${key}`);
    for (const path of [...paths, "'.github/workflows/_ts-package-ci.yml'"]) {
      expect(workflow).toContain(path);
    }
    expect(workflow).not.toContain("e2e_presto");
    expect(workflow).not.toContain("id-token");
  });

  test("the app pipeline re-runs when core changes", () => {
    expect(app.match(/'packages\/sdk-core\/\*\*'/g)?.length).toBe(2);
  });
});

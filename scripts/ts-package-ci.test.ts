import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NPM_PACKAGES } from "./npm-packages.ts";

const repository = resolve(import.meta.dir, "..");
const read = (rel: string) => readFileSync(resolve(repository, rel), "utf8");
const reusable = read(".github/workflows/_ts-package-ci.yml");
const sdk = read(".github/workflows/sdk.yml");
const sdkCore = read(".github/workflows/sdk-core.yml");
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
    expect(sdk).toMatch(/e2e_presto: \$\{\{ \(inputs\.package \|\| 'presto'\) == 'presto' \}\}/);
    for (const path of [
      "'packages/sdk/**'",
      "'packages/sdk-core/**'",
      "'.github/workflows/_ts-package-ci.yml'",
    ]) {
      expect(sdk).toContain(path);
    }
  });

  test("per-package PR gates are thin callers of the reusable", () => {
    expect(sdkCore).toContain("uses: ./.github/workflows/_ts-package-ci.yml");
    expect(sdkCore).toContain("package: presto-core");
    expect(sdkCore).toContain("'packages/sdk-core/**'");
    expect(sdkCore).toContain("'.github/workflows/_ts-package-ci.yml'");
    expect(sdkCore).not.toContain("e2e_presto");
  });

  test("the app pipeline re-runs when core changes", () => {
    expect(app.match(/'packages\/sdk-core\/\*\*'/g)?.length).toBe(2);
  });
});

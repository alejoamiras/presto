import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const REPO = path.resolve(import.meta.dir, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(REPO, relativePath), "utf8");

type Rule = string | { level: string; options: Record<string, boolean | number> };

interface BiomeConfig {
  files: { includes: string[] };
  linter: { rules: { complexity: Record<string, Rule> } };
}

const biome = JSON.parse(read("biome.json")) as BiomeConfig;
const complexity = biome.linter.rules.complexity;
const manifests = [
  "packages/presto/core/Cargo.toml",
  "packages/presto/server/Cargo.toml",
  "packages/presto/src-tauri/Cargo.toml",
];

describe("complexity policy", () => {
  test("Biome covers handwritten JavaScript and TypeScript", () => {
    for (const extension of ["ts", "tsx", "js", "jsx", "mjs"]) {
      expect(biome.files.includes).toContain(`**/*.${extension}`);
    }
    expect(biome.files.includes).toContain("!**/dist");
    expect(biome.files.includes).toContain("!packages/presto/src-tauri/gen");
    expect(biome.files.includes).toContain("!packages/release-feed/worker-configuration.d.ts");
  });

  test("Biome uses the requested severities and thresholds", () => {
    expect(complexity.noBannedTypes).toBe("warn");
    expect(complexity.noExtraBooleanCast).toBe("off");
    expect(complexity.noForEach).toBe("off");
    expect(complexity.noExcessiveNestedTestSuites).toBe("error");
    expect(complexity.noExcessiveCognitiveComplexity).toEqual({
      level: "error",
      options: { maxAllowedComplexity: 15 },
    });
    expect(complexity.noExcessiveLinesPerFunction).toEqual({
      level: "error",
      options: { maxLines: 80, skipBlankLines: true, skipIifes: false },
    });
  });

  test("every independent Rust crate opts into the shared limits", () => {
    expect(read("clippy.toml")).toBe(
      "cognitive-complexity-threshold = 15\ntoo-many-lines-threshold = 80\n",
    );
    for (const manifest of manifests) {
      const cargo = Bun.TOML.parse(read(manifest)) as {
        lints?: { clippy?: Record<string, string> };
      };
      expect(cargo.lints?.clippy).toEqual({
        cognitive_complexity: "deny",
        too_many_lines: "deny",
      });
    }
  });

  test("local and CI gates check all crates with committed lockfiles", () => {
    const packageJson = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    for (const manifest of manifests) {
      expect(packageJson.scripts["lint:clippy"]).toContain(`--manifest-path ${manifest}`);
      expect(packageJson.scripts["lint:rust"]).toContain(`--manifest-path ${manifest}`);
    }
    expect(packageJson.scripts["lint:clippy"]).toContain("--locked");
    expect(packageJson.scripts["lint:clippy"]).toContain("--all-targets");
    const workflow = read(".github/workflows/presto.yml");
    expect(workflow).toContain("bun run lint:rust");
    expect(workflow).toContain("bun run lint:clippy");
    for (const manifest of manifests) {
      expect(workflow).toContain(`cargo test --locked --manifest-path ${manifest}`);
    }
  });

  test("every explicit CI compiler pin matches the repository toolchain", () => {
    const toolchain = Bun.TOML.parse(read("rust-toolchain.toml")) as {
      toolchain: { channel: string };
    };
    const pinnedToolchainFiles = [
      ".github/actions/setup-presto/action.yml",
      ".github/workflows/_e2e.yml",
      ".github/workflows/dependency-audit.yml",
    ];

    for (const file of pinnedToolchainFiles) {
      const pins = [...read(file).matchAll(/^\s*toolchain:\s*([^\s#]+)\s*$/gm)].map(
        ([, pin]) => pin,
      );
      expect(pins, `${file} must contain an explicit compiler pin`).not.toBeEmpty();
      expect(
        pins.every((pin) => pin === toolchain.toolchain.channel),
        file,
      ).toBeTrue();
    }
  });
});

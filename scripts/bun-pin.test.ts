import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Bun-version pin invariant: `.bun-version` is the single source of truth. Every `setup-bun`
 * call site must reference it via `bun-version-file` — an inline `bun-version:` reintroduces the
 * per-site drift this centralization removed (the publish pipeline once floated `latest` while
 * 22 sibling sites pinned an older version).
 */
const ROOT = join(import.meta.dir, "..");

function ymlFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && /\.ya?ml$/.test(e.name))
    .map((e) => join(e.parentPath, e.name));
}

function stepBlock(lines: string[], start: number, stepIndent: number): string[] {
  const nextStep = new RegExp(`^\\s{0,${stepIndent}}-\\s`);
  const end = lines.findIndex((line, index) => index > start && nextStep.test(line));
  return lines.slice(start + 1, end === -1 ? undefined : end);
}

function mappingEntry(line: string): { indent: number; key: string } | undefined {
  const match = line.match(/^(\s*)([A-Za-z_-]+)\s*:\s*$/);
  return match ? { indent: match[1]?.length ?? 0, key: match[2] ?? "" } : undefined;
}

function hasBunVersionFile(lines: string[], start: number, stepIndent: number): boolean {
  const block = stepBlock(lines, start, stepIndent);
  const mappings = block.map(mappingEntry).filter((entry) => entry !== undefined);
  const childIndent = Math.min(...mappings.map((entry) => entry.indent));
  const withIndex = block.findIndex((line) => {
    const entry = mappingEntry(line);
    return entry?.indent === childIndent && entry.key === "with";
  });
  if (withIndex === -1) return false;

  const withBlock = block.slice(withIndex + 1);
  const nextSibling = withBlock.findIndex((line) => mappingEntry(line)?.indent === childIndent);
  const inputs = withBlock.slice(0, nextSibling === -1 ? undefined : nextSibling);
  return inputs.some((line) => /^\s*bun-version-file\s*:\s*\.bun-version\s*$/.test(line));
}

function setupBunSteps(file: string): Array<{ line: number; pinned: boolean }> {
  const lines = readFileSync(file, "utf8").split("\n");
  const steps: Array<{ line: number; pinned: boolean }> = [];
  for (const [index, line] of lines.entries()) {
    expect(
      !/^\s*bun-version\s*:/.test(line),
      `${file}:${index + 1} — inline bun-version reintroduced; use bun-version-file`,
    ).toBe(true);
    const use = line.match(/^(\s*)-\s+uses:\s*oven-sh\/setup-bun@/);
    if (!use) continue;
    const indent = use[1]?.length ?? 0;
    steps.push({ line: index + 1, pinned: hasBunVersionFile(lines, index, indent) });
  }
  return steps;
}

describe("bun version pin", () => {
  const files = [
    ...ymlFiles(join(ROOT, ".github/workflows")),
    ...ymlFiles(join(ROOT, ".github/actions")),
  ];

  test(".bun-version is a single exact semver line", () => {
    const content = readFileSync(join(ROOT, ".bun-version"), "utf8");
    expect(content).toMatch(/^\d+\.\d+\.\d+\n?$/);
  });

  test("every setup-bun step carries bun-version-file in ITS with-block; no inline bun-version", () => {
    // Association, not co-occurrence: a new unpinned setup-bun step alongside 23 pinned ones must
    // fail, so each step is checked for a pin within its own `with:` block (bounded by the next
    // step's `- ` at equal-or-lower indent).
    let stepCount = 0;
    for (const file of files) {
      for (const step of setupBunSteps(file)) {
        stepCount++;
        expect(
          step.pinned,
          `${file}:${step.line} — setup-bun step without bun-version-file under its with: mapping`,
        ).toBe(true);
      }
    }
    expect(stepCount, "sweep is vacuous — no setup-bun steps found").toBeGreaterThan(20);
  });
});

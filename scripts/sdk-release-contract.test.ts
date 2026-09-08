import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NPM_PACKAGES } from "./npm-packages.ts";

const repository = resolve(import.meta.dir, "..");
const release = readFileSync(resolve(repository, ".github/workflows/release-sdk.yml"), "utf8");
const publish = readFileSync(resolve(repository, ".github/workflows/_publish-npm.yml"), "utf8");

/** The `jobs:` block of one job, up to the next top-level job. */
function job(workflow: string, name: string): string {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  expect(start).toBeGreaterThan(0);
  const rest = workflow.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z-]+:\n/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

describe("npm release workflow contract", () => {
  test("OIDC is the only publish credential, declared by the reusable and delegated only at the call edge", () => {
    expect(publish).toContain("environment: npm-publish");
    expect(publish).toContain("id-token: write");
    expect(`${release}\n${publish}`).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN/);
    expect(publish).toContain(
      'npm publish "$TARBALL" --provenance --access public --tag "$DIST_TAG" --workspaces=false',
    );
    const publishJobs = ["publish-core", "publish-presto", "publish-noir"];
    for (const name of publishJobs) {
      const block = job(release, name);
      expect(block).toContain("uses: ./.github/workflows/_publish-npm.yml");
      expect(block).toContain("id-token: write");
    }
    for (const name of ["assert-main", "plan", "deploy-app"]) {
      expect(job(release, name)).not.toContain("id-token");
    }
    expect(release.match(/id-token: write/g)?.length).toBe(publishJobs.length);
  });

  test("every descriptor package is a dispatch choice with its own gated publish job", () => {
    const choices = release.slice(release.indexOf("packages:"), release.indexOf("dry_run:"));
    for (const key of Object.keys(NPM_PACKAGES)) {
      expect(choices).toContain(`- ${key}`);
      expect(release).toContain(`package: ${key}`);
      const slug = key.replace(/-/g, "_");
      expect(release).toContain(`needs.plan.outputs.publish_${slug} == 'true'`);
    }
    expect(choices).toContain("- all");
  });

  test("dependency audit, e2e, and the plan gate every publish; adapters wait for core", () => {
    expect(release).toContain("uses: ./.github/workflows/dependency-audit.yml");
    for (const name of ["publish-core", "publish-presto", "publish-noir"]) {
      const block = job(release, name);
      expect(block).toContain("needs: [assert-main, plan, e2e, dependency-audit");
      expect(block).toContain("!inputs.dry_run");
      expect(block).toContain("inputs.mode != 'playground-only'");
      expect(block).toMatch(/version: \$\{\{ needs\.plan\.outputs\.version_[a-z_]+ \}\}/);
    }
    expect(publish).toMatch(/PLANNED: \$\{\{ inputs\.version \}\}/);
    for (const name of ["publish-presto", "publish-noir"]) {
      expect(job(release, name)).toContain(
        "(needs.publish-core.result == 'success' || needs.publish-core.result == 'skipped')",
      );
    }
    const plan = job(release, "plan");
    expect(plan).toContain("bun scripts/release-plan.ts");
    // Release records are read through `gh`, reuse runs npm's signature audit: token + the publish npm.
    expect(plan).toContain("GH_TOKEN: ${{ github.token }}");
    expect(plan).toContain("uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020");
    expect(plan).toContain("node-version: 24");
  });

  test("exact cryptographic verification precedes the publication records", () => {
    const verification = publish.indexOf("bun scripts/verify-sdk-package-signatures.ts");
    const records = publish.indexOf("Create git tag and GitHub release");
    expect(verification).toBeGreaterThan(0);
    expect(records).toBeGreaterThan(verification);
    expect(publish.indexOf("bash scripts/sdk-tarball-consumer.sh")).toBeLessThan(
      publish.indexOf("npm publish"),
    );
  });

  test("playground verification uses the publish job's Node/npm toolchain", () => {
    const deploy = release.slice(release.indexOf("  deploy-app:"));
    const setup = deploy.indexOf(
      "uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
    );
    expect(setup).toBeGreaterThan(0);
    expect(deploy.slice(setup)).toContain("node-version: 24");
    expect(setup).toBeLessThan(deploy.indexOf("bun scripts/published-playground.ts"));
  });
});

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
    for (const name of ["assert-main", "plan", "noir-gates", "deploy-app"]) {
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
    // Noir's production gates run at the release SHA before it publishes; presto publishes last so
    // the playground deployment sees both adapters on the registry.
    const gates = job(release, "noir-gates");
    expect(gates).toContain("uses: ./.github/workflows/_ts-package-ci.yml");
    expect(gates).toContain("package: presto-noir");
    expect(gates).toContain("identity: true");
    expect(gates).toContain("live: true");
    expect(gates).toContain("needs.plan.outputs.publish_presto_noir == 'true'");
    const noir = job(release, "publish-noir");
    expect(noir).toContain("noir-gates]");
    expect(noir).toContain("needs.noir-gates.result == 'success'");
    const presto = job(release, "publish-presto");
    expect(presto).toContain("publish-noir]");
    // A selected noir whose gates failed skips its publication; that skip must not release presto.
    expect(presto).toContain(
      "(needs.publish-noir.result == 'success' || (needs.publish-noir.result == 'skipped' && needs.plan.outputs.publish_presto_noir != 'true'))",
    );
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
  });
});

describe("publish job isolation", () => {
  test("nothing resolved from the registry runs in the job that holds the publish credentials", () => {
    const pack = job(publish, "pack");
    const consumer = job(publish, "consumer-test");
    const publishJob = job(publish, "publish");
    const verify = job(publish, "verify");
    for (const unprivileged of [pack, consumer, verify]) {
      expect(unprivileged).toContain("contents: read");
      expect(unprivileged).not.toContain("id-token");
      expect(unprivileged).not.toContain("environment:");
    }
    // The digest travels as a job output, recorded before any registry code could run.
    expect(pack.indexOf("sha256sum")).toBeLessThan(pack.indexOf("upload-artifact"));
    expect(pack).not.toContain("sdk-tarball-consumer.sh");
    expect(pack).toMatch(/sha256: \$\{\{ steps\.pack\.outputs\.sha256 \}\}/);
    expect(consumer).toContain("needs: pack");
    expect(consumer).toContain('echo "$SHA256  $TARBALL" | sha256sum -c -');
    expect(consumer).toContain("bash scripts/sdk-tarball-consumer.sh");
    expect(publishJob).toContain("needs: [pack, consumer-test]");
    expect(publishJob).toContain("id-token: write");
    expect(publishJob).not.toContain("sdk-tarball-consumer.sh");
    expect(publishJob).not.toContain("npx");
    expect(publishJob.indexOf('echo "$SHA256  $TARBALL" | sha256sum -c -')).toBeLessThan(
      publishJob.indexOf("npm publish"),
    );
    expect(publishJob.match(/npm install/g)).toBeNull();
    expect(verify).toContain("needs: [pack, publish]");
    expect(verify).toContain("npm install --ignore-scripts");
  });

  test("the consumer host never runs registry lifecycle scripts and pins its compiler exactly", () => {
    const consumer = readFileSync(resolve(repository, "scripts/sdk-tarball-consumer.sh"), "utf8");
    const installs = consumer.match(/npm install [^\n]*/g) ?? [];
    expect(installs.length).toBeGreaterThan(0);
    for (const install of installs) {
      expect(install).toContain("--ignore-scripts");
    }
    expect(consumer).toMatch(/--package=typescript@\d+\.\d+\.\d+ /);
  });
});

describe("playground deployment", () => {
  test("playground verification uses the publish job's Node/npm toolchain", () => {
    const deploy = release.slice(release.indexOf("  deploy-app:"));
    const setup = deploy.indexOf(
      "uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
    );
    expect(setup).toBeGreaterThan(0);
    expect(deploy.slice(setup)).toContain("node-version: 24");
    expect(setup).toBeLessThan(deploy.indexOf("bun scripts/published-playground.ts"));
  });
  test("waits for every selected publication and tolerates unselected ones", () => {
    const deploy = job(release, "deploy-app");
    expect(deploy).toContain(
      "needs: [assert-main, plan, e2e, dependency-audit, publish-core, publish-noir, publish-presto]",
    );
    for (const [jobName, slug] of [
      ["publish-core", "presto_core"],
      ["publish-noir", "presto_noir"],
      ["publish-presto", "presto"],
    ]) {
      expect(deploy).toContain(
        `(needs.${jobName}.result == 'success' || (needs.${jobName}.result == 'skipped' && needs.plan.outputs.publish_${slug} != 'true'))`,
      );
    }
    expect(deploy).toContain("inputs.mode == 'playground-only' ||");
    // Only a version published in THIS run may be passed; the plan's version_presto is the next
    // publication (a playground-only run would otherwise ask for an unpublished revision).
    expect(deploy).toMatch(
      /PUBLISHED_VERSION: \$\{\{ needs\.publish-presto\.outputs\.version \}\}/,
    );
    expect(deploy).not.toContain("needs.plan.outputs.version_presto");
  });
});

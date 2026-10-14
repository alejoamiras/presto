import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
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

/** `first` appears in `text`, and `second` after it. */
function before(text: string, first: string, second: string): void {
  const a = text.indexOf(first);
  const b = text.indexOf(second);
  expect(a).toBeGreaterThan(0);
  expect(b).toBeGreaterThan(a);
}

/** Every module `entries` reach through static or dynamic imports, and each non-built-in specifier. */
function importGraph(entries: string[]): { modules: Set<string>; external: string[] } {
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const modules = new Set<string>();
  const external: string[] = [];
  const pending = [...entries];
  while (pending.length) {
    const file = pending.pop() as string;
    if (modules.has(file)) continue;
    modules.add(file);
    for (const { path: specifier } of transpiler.scanImports(readFileSync(file, "utf8"))) {
      if (specifier.startsWith(".")) pending.push(Bun.resolveSync(specifier, dirname(file)));
      else if (!/^(node:|bun:|bun$)/.test(specifier)) external.push(`${file}: ${specifier}`);
    }
  }
  return { modules, external };
}

describe("npm release workflow contract", () => {
  test("OIDC is the only publish credential, declared by the reusable and delegated only at the call edge", () => {
    expect(publish).toContain("environment: npm-publish");
    expect(publish).toContain("id-token: write");
    expect(`${release}\n${publish}`).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN/);
    expect(publish).toContain(
      'npm publish "$TARBALL" --provenance --access public --tag "$DIST_TAG" --workspaces=false',
    );
    const publishJobs = ["publish-core", "publish-presto", "publish-noir", "publish-banners"];
    for (const name of publishJobs) {
      const block = job(release, name);
      expect(block).toContain("uses: ./.github/workflows/_publish-npm.yml");
      expect(block).toContain("id-token: write");
    }
    for (const name of ["assert-main", "plan", "noir-gates", "bump-playground"]) {
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
    for (const name of ["publish-core", "publish-presto", "publish-noir", "publish-banners"]) {
      const block = job(release, name);
      expect(block).toContain("needs: [assert-main, plan, e2e, dependency-audit");
      expect(block).toContain("!inputs.dry_run");
      expect(block).toMatch(/version: \$\{\{ needs\.plan\.outputs\.version_[a-z_]+ \}\}/);
    }
    expect(publish).toMatch(/PLANNED: \$\{\{ inputs\.version \}\}/);
    for (const name of ["publish-presto", "publish-noir"]) {
      expect(job(release, name)).toContain(
        "(needs.publish-core.result == 'success' || needs.publish-core.result == 'skipped')",
      );
    }
    // Noir's production gates run at the release SHA before it publishes; presto publishes last.
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

  test("registry signatures and provenance claims are checked before the publication records", () => {
    const publishJob = job(publish, "publish");
    const verification = publishJob.indexOf("bun scripts/registry-consistency.ts");
    const records = publishJob.indexOf("Create git tag and GitHub release");
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
    // The digest travels as a job output, recorded before the consumer job runs.
    before(pack, "sha256sum", "upload-artifact");
    expect(pack).not.toContain("sdk-tarball-consumer.sh");
    expect(pack).toMatch(/sha256: \$\{\{ steps\.pack\.outputs\.sha256 \}\}/);
    expect(consumer).toContain("needs: pack");
    expect(consumer).toContain('echo "$SHA256  $TARBALL" | sha256sum -c -');
    expect(consumer).toContain("bash scripts/sdk-tarball-consumer.sh");
    expect(publishJob).toContain("needs: [pack, consumer-test]");
    expect(publishJob).toContain("id-token: write");
    before(publishJob, 'echo "$SHA256  $TARBALL" | sha256sum -c -', "npm publish");
    // Nothing installs in the credentialed job: not the consumer host, not even the lockfile.
    for (const install of ["sdk-tarball-consumer.sh", "npx", "npm install", "bun install"]) {
      expect(publishJob).not.toContain(install);
    }
  });

  test("the identity-bound check runs unprivileged, after a locked install, and can fail the run", () => {
    const verify = job(publish, "verify");
    expect(verify).toContain("needs: [pack, publish]");
    expect(verify).toContain("npm install --ignore-scripts");
    before(
      verify,
      "bun install --frozen-lockfile --ignore-scripts",
      "bun scripts/verify-sdk-package-signatures.ts",
    );
    expect(verify).not.toContain("continue-on-error");
  });

  test("every script the credentialed job runs imports only repository modules and built-ins", () => {
    const scripts = [...job(publish, "publish").matchAll(/bun (scripts\/[\w./-]+\.ts)/g)].map(
      ([, script]) => resolve(repository, script as string),
    );
    expect(scripts.length).toBeGreaterThanOrEqual(3);
    const { modules, external } = importGraph(scripts);
    expect(external).toEqual([]);
    expect(modules.has(resolve(repository, "scripts/registry-consistency.ts"))).toBe(true);
    expect(job(publish, "publish")).not.toContain("verify-sdk-package-signatures");
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

  test("every caller checks the SIGNED statement's commit and workflow, not only the unsigned one", () => {
    const source = (rel: string) => readFileSync(resolve(repository, rel), "utf8");
    // Publication: the statement, bound to its signing identity, must name the dispatched commit.
    expect(job(publish, "publish")).toContain(
      'bun scripts/registry-consistency.ts --package "$PACKAGE" "$VERSION" "$GITHUB_SHA"',
    );
    expect(job(publish, "verify")).toContain(
      'bun scripts/verify-sdk-package-signatures.ts --package "$PACKAGE" "$VERSION" "$GITHUB_SHA"',
    );
    // Every consumer takes the identity-bound verifier, never the registry-consistency one.
    for (const consumer of [
      "scripts/release-plan.ts",
      "scripts/promote-sdk-latest.ts",
      "scripts/published-playground.ts",
    ]) {
      expect(source(consumer)).toMatch(
        /from "\.\/verify-sdk-package-signatures(\.ts)?"|import\("\.\/verify-sdk-package-signatures\.ts"\)/,
      );
      expect(source(consumer)).not.toContain("registry-consistency");
    }
    // Reuse planning: the signed statement must name the tag's commit.
    expect(source("scripts/release-plan.ts")).toContain(
      "verifySdkPackageSignatures(version, pkg, tagCommit)",
    );
    // Promotion: the tag is compared against the signed commit, and a rollback's legacy-workflow
    // allowance reaches the signed verification too.
    const promote = source("scripts/promote-sdk-latest.ts");
    // Only a rollback may accept the reusable workflow's earlier name as signer.
    expect(promote).toMatch(
      /const provenance = await verifySdkPackageSignatures\(\s*version,\s*pkg,\s*undefined,\s*allowedWorkflows,\s*rollback \? ROLLBACK_SIGNERS : RELEASE_SIGNERS,?\s*\)/,
    );
    expect(promote).toContain("tagCommit !== provenance.commit");
  });
});

describe("playground pin", () => {
  const bump = job(release, "bump-playground");
  const steps = (
    Bun.YAML.parse(release) as {
      jobs: Record<
        string,
        { steps: Array<{ run?: string; uses?: string; with?: Record<string, string> }> }
      >;
    }
  ).jobs["bump-playground"]?.steps;

  test("the release deploys nothing itself: no mode input, no Cloudflare credential", () => {
    expect(release).not.toMatch(/^\s+mode:|inputs\.mode/m);
    expect(release).not.toMatch(/CLOUDFLARE_|wrangler/);
  });

  test("waits for every scheduled publication and tolerates unscheduled or reused ones", () => {
    expect(bump).toContain(
      "needs: [plan, e2e, dependency-audit, publish-core, publish-noir, publish-presto]",
    );
    // Without an explicit status function, a skipped upstream publish job would skip this one too.
    expect(bump).toContain(
      "if: ${{ !cancelled() && !inputs.dry_run && needs.plan.result == 'success'",
    );
    for (const [jobName, slug] of [
      ["publish-core", "presto_core"],
      ["publish-noir", "presto_noir"],
      ["publish-presto", "presto"],
    ]) {
      expect(bump).toContain(
        `(needs.plan.outputs.publish_${slug} != 'true' || needs.${jobName}.result == 'success')`,
      );
    }
  });

  test("versions reach the pin script only through the environment", () => {
    // Only a version published in THIS run: the plan's version_presto is the next publication.
    expect(bump).toContain(`PRESTO_VERSION: \${{ needs.publish-presto.outputs.version }}`);
    expect(bump).toContain(`PRESTO_NOIR_VERSION: \${{ needs.plan.outputs.version_presto_noir }}`);
    expect(bump).not.toContain("needs.plan.outputs.version_presto }}");
    expect(steps?.some((step) => step.run?.includes("bun scripts/playground-pin.ts"))).toBe(true);
    expect(steps?.filter((step) => step.run?.includes("${{"))).toEqual([]);
  });

  test("a least-privilege bot opens a fresh PR, never stacks on an open one, and auto-merges", () => {
    expect(bump).toContain("permissions: {}");
    expect(bump).toContain("permission-contents: write");
    expect(bump).toContain("permission-pull-requests: write");
    expect(bump).not.toContain("bun install");
    const branch = `chore/playground-sdk-pin-\${{ github.run_id }}-\${{ github.run_attempt }}`;
    const at = (action: string) =>
      steps?.findIndex((step) => step.uses === `./.github/actions/${action}`) ?? -1;
    const guard =
      steps?.findIndex((step) => step.run?.includes('startswith("chore/playground-sdk-pin-")')) ??
      -1;
    expect(guard).toBeGreaterThan(0);
    expect(at("bot-push")).toBeGreaterThan(guard);
    expect(at("bot-pr")).toBeGreaterThan(at("bot-push"));
    expect(steps?.[at("bot-push")]?.with?.branch).toBe(branch);
    expect(steps?.[at("bot-pr")]?.with).toMatchObject({ branch, "auto-merge": "true" });
  });

  test("the production bundle targets the public testnet node", () => {
    const vite = readFileSync(resolve(repository, "packages/playground/vite.config.ts"), "utf8");
    expect(vite).toContain(
      'const TESTNET_AZTEC_NODE_URL = "https://presto-testnet-rpc.alejo-amiras.workers.dev"',
    );
    expect(vite).toContain('command === "build" ? TESTNET_AZTEC_NODE_URL : undefined');
  });
});

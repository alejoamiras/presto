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

/**
 * The npm commands that read the registry without running package code, by their arguments after
 * `npm`: `view` takes positional values only, `audit` only `signatures`, and `install` only these
 * flags, `--ignore-scripts` among them.
 */
const NPM_READS: Record<string, (rest: string[]) => boolean> = {
  view: (rest) => rest.every((arg) => /^\w+$/.test(arg)),
  audit: ([check, ...flags]) =>
    check === '"signatures"' &&
    flags.every((flag) => ['"--json"', '"--include-attestations"'].includes(flag)),
  install: (flags) =>
    flags.includes('"--ignore-scripts"') &&
    flags.every((flag) =>
      ['"--ignore-scripts"', '"--no-audit"', '"--no-fund"', '"--loglevel=error"'].includes(flag),
    ),
};

/** A literal command array that runs npm without package code. */
function isNpmRead(array: string | undefined): boolean {
  const [command, subcommand, ...rest] = (array?.slice(1, -1).split(",") ?? [])
    .map((arg) => arg.trim())
    .filter(Boolean);
  const read = NPM_READS[subcommand?.slice(1, -1) ?? ""];
  return command === '"npm"' && Boolean(read?.(rest));
}

/** Commands in a job that could run code other than the repository's own scripts. */
function jobViolations(text: string): string[] {
  const violations = [...text.matchAll(/\bbunx?\s+(\S+)/g)]
    .filter(([, arg]) => !arg?.startsWith("scripts/"))
    .map(([command]) => command);
  // Node runs only quoted inline code that loads nothing.
  for (const [command, flag, , body] of text.matchAll(
    /\bnode\s+(\S+)(?:\s+(['"])([\s\S]*?)\2)?/g,
  )) {
    const inline = ["-e", "-p", "--eval", "--print"].includes(flag as string) && body !== undefined;
    if (!inline || /require|import|child_process|eval|Function/.test(body))
      violations.push(command);
  }
  for (const [runner] of text.matchAll(/\b(npx|npm (?:exec|x|run|install|ci|test|start))\b/g)) {
    violations.push(runner);
  }
  return violations;
}

/**
 * Code the import scanner cannot see: `require`, a non-literal `import()`, and any subprocess other
 * than npm reading the registry, spawned from a literal array or through a `run(command)` helper
 * whose every call passes one.
 */
function codeViolations(code: string): string[] {
  const violations: string[] = [];
  if (/\brequire\s*\(/.test(code)) violations.push("require");
  for (const [call] of code.matchAll(/\bimport\s*\([^)]*\)/g)) {
    if (!/^import\s*\(\s*(["'])[^"'`$]*\1\s*\)$/.test(call)) violations.push(call);
  }
  if (/\bBun\s*\.\s*(\$|spawn\s*\()|child_process/.test(code)) violations.push("subprocess API");
  const helper = /\bfunction run\(command: string\[\]/.test(code);
  for (const [call, argument] of code.matchAll(
    /\bBun\s*\.\s*spawnSync\s*\(\s*(\[[^\]]*\]|\w+\b(?!\s*[.[(]))?/g,
  )) {
    if (!isNpmRead(argument) && !(helper && argument === "command")) violations.push(call);
  }
  for (const [call, array] of code.matchAll(/(?<!function )\brun\s*\(\s*(\[[^\]]*\])?/g)) {
    if (helper && !isNpmRead(array)) violations.push(call);
  }
  return violations;
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
    expect(plan).toMatch(/uses: actions\/setup-node@[0-9a-f]{40} /);
    expect(plan).toContain("node-version: 24");
  });

  test("the tag and release are written only after the identity-bound check passed", () => {
    const records = job(publish, "release-records");
    expect(records).toContain("needs: [pack, publish, verify]");
    expect(records).not.toMatch(/\bif:/);
    expect(records).toContain('git push origin "refs/tags/$tag"');
    expect(records).toContain('gh release create "$tag"');
    before(records, 'gh release create "$tag"', 'grep -Fx "$tag"');
    for (const name of ["pack", "consumer-test", "publish", "verify"]) {
      expect(job(publish, name)).not.toMatch(/^\s+(git (push|tag)|gh release create)\b/m);
    }
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
    expect(publishJob).toContain("contents: read");
    expect(publishJob).toContain("persist-credentials: false");
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
    // A restored cache could hold files a job running dependency code saved.
    expect(verify).not.toContain("actions/cache");
  });

  test("every script the credentialed job runs imports only repository modules and built-ins", () => {
    const publishJob = job(publish, "publish");
    expect(jobViolations(publishJob)).toEqual([]);
    const scripts = [...publishJob.matchAll(/\bbun (scripts\/\S+\.ts)/g)].map(([, script]) =>
      resolve(repository, script as string),
    );
    expect(scripts.length).toBeGreaterThanOrEqual(2);
    const { modules, external } = importGraph(scripts);
    expect(external).toEqual([]);
    expect(modules.has(resolve(repository, "scripts/registry-consistency.ts"))).toBe(true);
    expect(publishJob).not.toContain("verify-sdk-package-signatures");
    for (const module of modules) {
      expect({ module, violations: codeViolations(readFileSync(module, "utf8")) }).toEqual({
        module,
        violations: [],
      });
    }
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

describe("the release-records job", () => {
  test("the job that writes the records holds no OIDC identity and runs only repository code", () => {
    const records = job(publish, "release-records");
    // No job holds both the OIDC identity and write access to the repository.
    expect(publish.match(/^\s+contents: write$/gm)?.length).toBe(1);
    expect(records).toContain("contents: write");
    expect(records).not.toContain("id-token");
    expect(records).not.toContain("environment:");
    expect(records).not.toContain("continue-on-error");
    for (const install of ["bun install", "npm install", "npx", "actions/cache"]) {
      expect(records).not.toContain(install);
    }
    expect(jobViolations(records)).toEqual([]);
    const scripts = [...records.matchAll(/\bbun (scripts\/\S+\.ts)/g)].map(([, script]) =>
      resolve(repository, script as string),
    );
    expect(scripts.length).toBeGreaterThan(0);
    expect(importGraph(scripts).external).toEqual([]);
  });
});

describe("a publication without release records", () => {
  // `verify` failing after `npm publish` leaves the version on npm with no tag or release.
  test("planning refuses to reuse it and says which record is missing", async () => {
    const { planRelease } = await import("./release-plan.ts");
    const core = NPM_PACKAGES["presto-core"];
    const facts = {
      manifest: { name: core.name, version: "1.0.0" },
      published: ["1.0.0"],
      releaseVerified: false,
      releaseProblem: `no release tag ${core.name}@1.0.0`,
    };
    expect(() => planRelease(["presto-core"], { "presto-core": facts })).toThrow(
      `do not verify (no release tag ${core.name}@1.0.0)`,
    );
    const plan = readFileSync(resolve(repository, "scripts/release-plan.ts"), "utf8");
    expect(plan).toContain(
      "if (!tagCommit) return { releaseVerified: false, releaseProblem: `no release tag ${tag}` };",
    );
    expect(plan).toContain("releaseProblem: `no GitHub release ${tag}`");
  });

  test("promotion refuses it before touching npm", () => {
    const promote = readFileSync(resolve(repository, "scripts/promote-sdk-latest.ts"), "utf8");
    before(promote, "throw new Error(`remote git tag ${gitTag} does not exist`)", '"dist-tag",');
    before(promote, 'run(["gh", "release", "view", gitTag,', '"dist-tag",');
  });
});

describe("the credentialed-job guards", () => {
  test.each([
    ["inline Bun", 'run: bun -e "1"'],
    ["a package runner", "run: bunx tool"],
    ["inline Node loading a module", `run: node -e "require('tool')"`],
    ["npm running package code", "run: npm exec tool"],
    ["inline Node through --eval", `run: node --eval "require('tool')"`],
    ["a Node script", "run: node tool.js"],
  ])("the job guard refuses %s", (_, step) => {
    expect(jobViolations(step)).not.toEqual([]);
  });

  test.each([
    ["a computed template import", "const load = () => import(`\u0024{name}`);"],
    ["a computed import", "const load = () => import(name);"],
    ["require", 'const tool = require("tool");'],
    ["a variable executable", 'const runner = "bunx";\nBun.spawnSync([runner, "tool"]);'],
    ["another subprocess API", 'import { execFileSync } from "node:child_process";'],
    ["npm running package code", 'Bun.spawnSync(["npm", "exec", "tool"]);'],
    ["an install that runs scripts", 'Bun.spawnSync(["npm", "install", "tool"]);'],
    [
      "an install that re-enables scripts",
      'Bun.spawnSync(["npm", "install", "--ignore-scripts", "--ignore-scripts=false"]);',
    ],
    ["an audit that installs", 'Bun.spawnSync(["npm", "audit", "fix"]);'],
    ["spread arguments", 'Bun.spawnSync(["npm", "view", ...args]);'],
    ["a spaced call", 'Bun.spawnSync (["bunx", "tool"]);'],
    ["an options object", 'Bun.spawnSync({ cmd: ["bunx", "tool"] });'],
    ["a computed command", "Bun.spawnSync(commands.at(0));"],
    [
      "a helper called with a variable",
      "function run(command: string[], cwd: string) {\n  Bun.spawnSync(command);\n}\nrun(list, dir);",
    ],
  ])("the code guard refuses %s", (_, code) => {
    expect(codeViolations(code)).not.toEqual([]);
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

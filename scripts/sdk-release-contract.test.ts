import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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
 * whose every call, in any module, passes one. The helper may be imported only by its own name, so
 * no alias escapes the call check. Syntax only: a call behind another binding is not seen.
 */
function codeViolations(code: string, dir = import.meta.dir): string[] {
  const violations: string[] = [];
  if (/\brequire\s*\(/.test(code)) violations.push("require");
  for (const [call] of code.matchAll(/\bimport\s*\([^)]*\)/g)) {
    if (!/^import\s*\(\s*(["'])[^"'`$]*\1\s*\)$/.test(call)) violations.push(call);
  }
  if (/\bBun\s*\.\s*(\$|spawn\s*\()|child_process/.test(code)) violations.push("subprocess API");
  const helper = /\bfunction run\(command: string\[\]/.test(code);
  // A literal array counts only as a whole argument: anything after it may rewrite the command.
  for (const [call, argument] of code.matchAll(
    /\bBun\s*\.\s*spawnSync\s*\(\s*(\[[^\]]*\](?=\s*[,)])|\w+\b(?!\s*[.[(]))?/g,
  )) {
    if (!isNpmRead(argument) && !(helper && argument === "command")) violations.push(call);
  }
  for (const [call, array] of code.matchAll(
    /(?<!function )\brun\s*\(\s*(\[[^\]]*\](?=\s*[,)]))?/g,
  )) {
    if (!isNpmRead(array)) violations.push(call);
  }
  return [...violations, ...leafImportViolations(code, dir)];
}

const BOUNDED_SPAWN = resolve(repository, "scripts/npm-command.ts");

/**
 * References to the bounded-spawn module, however its path is spelled, other than a static import of
 * `run` and its deadline: a dynamic import, a re-export or any other name escapes the `run` check.
 */
function leafImportViolations(code: string, dir: string): string[] {
  const leaf = (specifier = "") =>
    specifier.startsWith(".") && Bun.resolveSync(specifier, dir) === BOUNDED_SPAWN;
  const onlyRun = (clause = "") =>
    /^\{([^}]*)\}$/
      .exec(clause.trim())?.[1]
      ?.split(",")
      .every((name) => ["run", "NPM_TIMEOUT_MS", ""].includes(name.trim()));
  const statements = [...code.matchAll(/\b(import|export)\s+([^;]*?)\s+from\s+["']([^"']+)["']/g)]
    .filter(
      ([, keyword, clause, specifier]) =>
        leaf(specifier) && !(keyword === "import" && onlyRun(clause)),
    )
    .map(([statement]) => statement);
  const dynamic = [...code.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)]
    .filter(([, specifier]) => leaf(specifier))
    .map(([call]) => call);
  return [...statements, ...dynamic];
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
    before(records, 'gh release create "$tag"', ".isDraft == false");
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
    // The verifier's own bounded, script-free install is the fresh registry install.
    expect(verify).not.toContain("npm install");
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
      const violations = codeViolations(readFileSync(module, "utf8"), dirname(module));
      expect({ module, violations }).toEqual({ module, violations: [] });
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
    // Promotion: the tag is compared against the signed commit.
    const promote = source("scripts/promote-sdk-latest.ts");
    // Only a rollback may accept the reusable workflow's earlier name as signer.
    expect(promote).toMatch(
      /const provenance = await verifySdkPackageSignatures\(\s*version,\s*pkg,\s*undefined,\s*rollback \? ROLLBACK_SIGNERS : RELEASE_SIGNERS,?\s*\)/,
    );
    expect(promote).toContain("tagCommit !== provenance.commit");
  });
});

const TAG = "@alejoamiras/presto@6.0.0";
const releaseJson = (isDraft: boolean, login: string, assets: string[]) =>
  JSON.stringify({
    tagName: TAG,
    name: TAG,
    isDraft,
    author: { login },
    assets: assets.map((name) => ({ name })),
  });
/** What `gh release view` answers: an error message, or the release. */
const RELEASES = {
  absent: "release not found",
  unreadable: "HTTP 502",
  // An interrupted `gh release create`: its draft, before the asset upload finished.
  draft: releaseJson(true, "github-actions[bot]", []),
  foreign: releaseJson(true, "someone", []),
  published: releaseJson(false, "github-actions[bot]", ["MIGRATION.md"]),
  bare: releaseJson(false, "github-actions[bot]", []),
  extra: releaseJson(false, "github-actions[bot]", ["MIGRATION.md", "other.zip"]),
};
type ReleaseState = keyof typeof RELEASES;
const SHA = "a".repeat(40);
/** What `git ls-remote` answers for the tag: nothing, or the ref lines GitHub prints. */
const TAGS = {
  absent: "",
  lightweight: `${SHA}\\trefs/tags/${TAG}\\n`,
  // An annotated tag lists its object first and the commit it points at as the peeled line.
  annotated: `${"b".repeat(40)}\\trefs/tags/${TAG}\\n${SHA}\\trefs/tags/${TAG}^{}\\n`,
  elsewhere: `${"c".repeat(40)}\\trefs/tags/${TAG}\\n`,
};
type TagState = keyof typeof TAGS;

/** Runs one release-records step as Actions does (`bash -e`), with git, gh and bun stubbed. */
function recordStep(
  name: string,
  state: ReleaseState,
  tag: TagState = "lightweight",
): { calls: string[]; git: string[]; code: number } {
  const steps = (
    Bun.YAML.parse(publish) as {
      jobs: Record<string, { steps: Array<{ name?: string; run?: string }> }>;
    }
  ).jobs["release-records"]?.steps;
  const run = steps?.find((step) => step.name === name)?.run;
  expect(run).toBeString();
  const temp = mkdtempSync(join(tmpdir(), "release-records-"));
  const answer = RELEASES[state];
  const stubs = `
    calls="$RUNNER_TEMP/calls"; : >"$calls"
    git() { echo "git $*" >>"$calls"; [ "$1" != ls-remote ] || printf '%b' '${TAGS[tag]}'; }
    bun() { echo 1.0.0; }
    gh() {
      echo "gh $*" >>"$calls"
      [ "$1 $2" = "release view" ] || return 0
      case '${answer}' in "{"*) echo '${answer}' ;; *) echo '${answer}' >&2; return 1 ;; esac
    }
  `;
  try {
    const result = Bun.spawnSync(["bash", "-e", "-c", `${stubs}\n${run}`], {
      cwd: temp,
      env: {
        PATH: process.env.PATH,
        RUNNER_TEMP: temp,
        GITHUB_REPOSITORY: "alejoamiras/presto",
        GITHUB_SHA: SHA,
        PACKAGE_NAME: "@alejoamiras/presto",
        VERSION: "6.0.0",
        VERSION_MODE: "manifest",
        RELEASE_ASSET: "packages/sdk/MIGRATION.md",
      },
    });
    const calls = readFileSync(join(temp, "calls"), "utf8").split("\n").filter(Boolean);
    return {
      calls: calls.filter((call) => call.startsWith("gh release")),
      git: calls.filter((call) => /^git (tag|push) /.test(call)),
      code: result.exitCode,
    };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

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

  test("a rerun creates a missing release, finishes its own draft, keeps a published one, stops otherwise", () => {
    const create = "Create git tag and GitHub release";
    const verbs = (state: ReleaseState) => {
      const { calls, code } = recordStep(create, state);
      return { code, verbs: calls.map((call) => call.split(" ")[2]) };
    };
    expect(verbs("absent")).toEqual({ code: 0, verbs: ["view", "create"] });
    expect(verbs("draft")).toEqual({ code: 0, verbs: ["view", "upload", "edit"] });
    expect(recordStep(create, "draft").calls.at(-1)).toContain("--draft=false --latest=false");
    // A draft someone else made is never published for them.
    expect(verbs("foreign")).toEqual({ code: 1, verbs: ["view"] });
    expect(verbs("published")).toEqual({ code: 0, verbs: ["view"] });
    expect(verbs("unreadable")).toEqual({ code: 1, verbs: ["view"] });
  });

  test("the tag is pushed only when absent, kept at this commit however it was made, refused elsewhere", () => {
    const create = "Create git tag and GitHub release";
    expect(recordStep(create, "absent", "absent")).toMatchObject({
      code: 0,
      git: [`git tag ${TAG}`, `git push origin refs/tags/${TAG}`],
    });
    // A hand repair leaves a signed annotated tag; a lightweight push of the same name cannot
    // replace it, so the job must not try.
    for (const tag of ["lightweight", "annotated"] as const) {
      const run = recordStep(create, "absent", tag);
      expect(run, tag).toMatchObject({ code: 0, git: [] });
      expect(run.calls.map((call) => call.split(" ")[2])).toEqual(["view", "create"]);
    }
    expect(recordStep(create, "absent", "elsewhere")).toMatchObject({
      code: 1,
      git: [],
      calls: [],
    });
  });

  test("the records pass only as a published release carrying exactly its asset", () => {
    const check = "Verify the release records";
    expect(recordStep(check, "published").code).toBe(0);
    expect(recordStep(check, "published", "annotated").code).toBe(0);
    for (const state of ["draft", "bare", "extra"] as const) {
      expect(recordStep(check, state).code).not.toBe(0);
    }
    for (const tag of ["absent", "elsewhere"] as const) {
      expect(recordStep(check, "published", tag).code, tag).not.toBe(0);
    }
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
    // An interrupted `Record` can leave a draft, which is not yet a record.
    expect(plan).toContain('if (release !== "published")');
    expect(plan).toContain("`no GitHub release ${tag}`");
  });

  test("promotion refuses it before touching npm", () => {
    const promote = readFileSync(resolve(repository, "scripts/promote-sdk-latest.ts"), "utf8");
    before(promote, "throw new Error(`remote git tag ${gitTag} does not exist`)", '"dist-tag",');
    before(promote, '"tagName,url,isDraft"', '"dist-tag",');
    before(promote, "if (release.isDraft !== false)", '"dist-tag",');
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
    [
      "an imported helper running another tool",
      'import { run } from "./npm-command.ts";\nrun(["bunx", "tool"]);',
    ],
    [
      "an aliased helper",
      'import { run as execute } from "./npm-command.ts";\nexecute(["bunx", "tool"]);',
    ],
    [
      "the unchecked spawn",
      'import { spawnBounded } from "./npm-command.ts";\nspawnBounded(["bunx", "tool"]);',
    ],
    [
      "the unchecked spawn by another path",
      'import { spawnBounded } from "././npm-command.ts";\nspawnBounded(["bunx", "tool"]);',
    ],
    [
      "the unchecked spawn by a dynamic import",
      'const { spawnBounded } = await import("../scripts/npm-command.ts");',
    ],
    ["a re-export of the bounded spawn", 'export { spawnBounded } from "./npm-command.ts";'],
    [
      "a spawned array rewritten after the check",
      'Bun.spawnSync(["npm", "view", a].concat(["exec"]));',
    ],
    [
      "a helper array rewritten after the check",
      'import { run } from "./npm-command.ts";\nrun(["npm", "view", a].map(() => "bunx"));',
    ],
    [
      "an optional chain on the array",
      'run(["npm", "view", a]?.map((_, i) => ["npm", "exec", "t"][i]));',
    ],
    ["a comment before the chain", 'Bun.spawnSync(["npm", "view", a] /* */ .concat(["exec"]));'],
  ])("the code guard refuses %s", (_, code) => {
    expect(codeViolations(code)).not.toEqual([]);
  });
});

describe("registry deadlines", () => {
  const source = (rel: string) => readFileSync(resolve(repository, rel), "utf8");

  test("the release scripts reach npm only through the bounded spawn", () => {
    const direct = /\bBun\s*\.\s*spawn(Sync)?\s*\(\s*\[\s*"npm"/;
    const bounded = [
      "scripts/get-sdk-publish-version.ts",
      "scripts/sdk-release-verification.ts",
      "scripts/registry-consistency.ts",
      "scripts/published-playground.ts",
    ];
    for (const rel of [...bounded, "scripts/release-plan.ts"]) {
      expect({ rel, direct: direct.test(source(rel)) }).toEqual({ rel, direct: false });
    }
    // Release planning keeps an unbounded local `run` for git; npm must not reach it.
    expect(source("scripts/release-plan.ts")).not.toMatch(/\brun\s*\(\s*\[\s*"npm"/);
    // Its npm command is a variable, so only a spawn of any kind shows a bypass of the bounded one.
    expect(source("scripts/get-sdk-publish-version.ts")).not.toMatch(/\bBun\s*\.\s*(spawn|\$)/);
    for (const rel of bounded) expect(source(rel)).toMatch(/from "\.\/npm-command(\.ts)?"/);
    expect(source("scripts/release-plan.ts")).toMatch(
      /import \{[^}]*\bnpmViewJson,[^}]*\bpublishedVersions,[^}]*\} from "\.\/get-sdk-publish-version\.ts"/,
    );
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

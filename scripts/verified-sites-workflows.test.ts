/**
 * The verified-sites signing and publishing workflows' security contract: what each job may hold,
 * install and write, and the checks that must run before the seed or the KV token is used.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8");
/** A GitHub Actions expression as it appears in workflow text. */
const expr = (inner: string) => `\${{ ${inner} }}`;

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  env?: Record<string, string>;
  with?: Record<string, string | boolean>;
  "working-directory"?: string;
}
interface Job {
  needs?: string | string[];
  if?: string;
  environment?: string;
  permissions?: Record<string, string>;
  env?: Record<string, string>;
  steps: Step[];
}
interface Workflow {
  on: Record<string, unknown>;
  permissions: Record<string, string>;
  concurrency?: { group: string; "cancel-in-progress": boolean };
  env?: Record<string, string>;
  jobs: Record<string, Job>;
}

const load = (file: string) => ({
  text: read(`.github/workflows/${file}`),
  workflow: Bun.YAML.parse(read(`.github/workflows/${file}`)) as Workflow,
});
const sign = load("sign-verified-sites.yml");
const publish = load("publish-verified-sites.yml");
const health = load("verified-sites-health.yml");

const job = (w: { workflow: Workflow }, name: string): Job => {
  const found = w.workflow.jobs[name];
  if (!found) throw new Error(`no job ${name}`);
  return found;
};
const stepIndex = (j: Job, name: string) => j.steps.findIndex((s) => s.name === name);
const secretsIn = (value: unknown) => JSON.stringify(value).match(/secrets\.[A-Z_]+/g) ?? [];
/** Every `secrets.X` reference, as `job/step: X`. */
function secretUses(w: { workflow: Workflow }): string[] {
  return Object.entries(w.workflow.jobs).flatMap(([name, j]) => [
    ...secretsIn(j.env ?? {}).map((s) => `${name}: ${s}`),
    ...j.steps.flatMap((step) =>
      secretsIn(step).map((s) => `${name}/${step.name ?? step.uses}: ${s}`),
    ),
  ]);
}
const usesOf = (j: Job) => j.steps.map((s) => s.uses?.split("@")[0]).filter(Boolean);
const runsOf = (j: Job) => j.steps.map((s) => s.run ?? "").join("\n");

describe("verified-sites workflow triggers", () => {
  test("push to main on exact paths, and a dispatch that takes no input", () => {
    expect(sign.workflow.on).toEqual({
      push: {
        branches: ["main"],
        paths: ["packages/presto/verified-sites.json", "packages/presto/verified-sites/key.pub"],
      },
      workflow_dispatch: null,
    });
    expect(publish.workflow.on).toEqual({
      push: { branches: ["main"], paths: ["packages/presto/verified-sites/history/**"] },
      workflow_dispatch: null,
    });
    for (const w of [sign, publish, health]) {
      expect(w.text).not.toMatch(/^\s*inputs:/m);
      expect(w.text).not.toContain("github.event.inputs");
      expect(w.workflow.permissions).toEqual({ contents: "read" });
    }
    for (const w of [sign, publish]) {
      expect(w.workflow.concurrency?.["cancel-in-progress"]).toBe(false);
    }
  });

  test("every job that signs, records or publishes asserts main first", () => {
    for (const [w, names] of [
      [sign, ["prepare", "sign", "record"]],
      [publish, ["verify", "publish"]],
    ] as const) {
      for (const name of names) {
        expect(job(w, name).steps[0]?.name).toBe("Assert main ref");
      }
    }
  });
});

describe("verified-sites secrets and privileges", () => {
  test("the seed, the App key and the KV token each reach exactly one step", () => {
    expect(secretUses(sign)).toEqual([
      "sign/Sign: secrets.VERIFIED_SITES_SIGNING_SEED",
      "record/actions/create-github-app-token@64ab729a6294000f5aa4a4bc0b73d1f32bc45510: secrets.RELEASE_BOT_APP_ID",
      "record/actions/create-github-app-token@64ab729a6294000f5aa4a4bc0b73d1f32bc45510: secrets.RELEASE_BOT_PRIVATE_KEY",
    ]);
    expect(secretUses(publish)).toEqual([
      "publish/Write the document unless KV refuses it: secrets.CLOUDFLARE_RELEASE_FEED_API_TOKEN",
      "publish/Write the document unless KV refuses it: secrets.CLOUDFLARE_ACCOUNT_ID",
    ]);
    expect(secretUses(health)).toEqual([]);
  });

  test("environments and token permissions per job", () => {
    const shape = (w: { workflow: Workflow }) =>
      Object.fromEntries(
        Object.entries(w.workflow.jobs).map(([n, j]) => [n, [j.environment, j.permissions]]),
      );
    expect(shape(sign)).toEqual({
      prepare: [undefined, undefined],
      sign: ["verified-sites-signing", undefined],
      "verify-signed": [undefined, undefined],
      record: [undefined, {}],
    });
    expect(shape(publish)).toEqual({
      verify: [undefined, undefined],
      publish: ["release-feed", {}],
      "verify-live": [undefined, undefined],
    });
    const app = job(sign, "record").steps.find((s) => s.uses?.includes("create-github-app-token"));
    expect(app?.with).toMatchObject({
      "permission-contents": "write",
      "permission-pull-requests": "write",
    });
  });

  test("no checkout keeps credentials except record's, which bot-push pushes with", () => {
    for (const w of [sign, publish, health]) {
      for (const [name, j] of Object.entries(w.workflow.jobs)) {
        for (const step of j.steps.filter((s) => s.uses?.startsWith("actions/checkout@"))) {
          const keeps = step.with?.["persist-credentials"] !== false;
          expect(`${name}: ${keeps}`).toBe(`${name}: ${name === "record"}`);
        }
      }
    }
  });

  test("the secret-holding jobs install, build and check out nothing they run", () => {
    const signJob = job(sign, "sign");
    expect(usesOf(signJob)).toEqual([
      "actions/checkout",
      "oven-sh/setup-bun",
      "actions/upload-artifact",
    ]);
    expect(usesOf(job(publish, "publish"))).toEqual(["actions/download-artifact"]);
    expect(usesOf(job(sign, "record"))).toEqual([
      "actions/create-github-app-token",
      "actions/checkout",
      "actions/download-artifact",
      "./.github/actions/bot-push",
      "./.github/actions/bot-pr",
    ]);
    for (const j of [signJob, job(publish, "publish"), job(sign, "record")]) {
      expect(runsOf(j)).not.toMatch(
        /\b(bun install|bun add|bunx|npm|npx|cargo|pip|apt-get|wrangler)\b/,
      );
    }
  });
});

describe("verified-sites CLI jobs", () => {
  test("no job that builds or runs the CLI installs JS packages, so no lifecycle script runs", () => {
    const presto = { workflow: Bun.YAML.parse(read(".github/workflows/presto.yml")) as Workflow };
    const jobs: [string, Job][] = [
      ...[sign, publish, health].flatMap((w) => Object.entries(w.workflow.jobs)),
      ["verified-sites-feed", job(presto, "verified-sites-feed")],
    ];
    const setups = jobs.flatMap(([name, j]) =>
      j.steps
        .filter((s) => s.uses === "./.github/actions/setup-presto")
        .map((s) => `${name}: ${s.with?.["install-js-deps"]}`),
    );
    expect(setups).toEqual([
      "prepare: false",
      "verify-signed: false",
      "verify: false",
      "probe: false",
      "verified-sites-feed: false",
    ]);
  });
});

describe("verified-sites signing", () => {
  const signJob = job(sign, "sign");
  const signStep = signJob.steps[stepIndex(signJob, "Sign")];

  test("the signer runs alone from the runner's temp directory, with no install, .env or bunfig", () => {
    expect(signStep?.["working-directory"]).toBe(`${expr("runner.temp")}/sign`);
    expect(signStep?.run).toContain(
      "bun --no-install --no-env-file --config=/dev/null verified-sites-signer.ts sign",
    );
    expect(Object.keys(signStep?.env ?? {}).sort()).toEqual([
      "PRESTO_VERIFIED_SITES_SIGNING_SEED",
      "SHA256",
    ]);
    const imports = new Bun.Transpiler({ loader: "ts" }).scanImports(
      read("packages/presto/scripts/verified-sites-signer.ts"),
    );
    expect(imports.filter((i) => !i.path.startsWith("node:"))).toEqual([]);
  });

  test("main must still hold the approved bytes and the signing path before the seed step", () => {
    const check = stepIndex(signJob, "Require the approved bytes, still on main");
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(stepIndex(signJob, "Sign"));
    const run = signJob.steps[check]?.run ?? "";
    expect(run).toContain("git fetch --quiet --depth=1 --no-tags origin refs/heads/main");
    expect(run).toContain(`for path in packages/presto/verified-sites.json "\${paths[@]}"; do`);
    expect(run).toContain('"FETCH_HEAD:$path"');
    expect(run).toContain('!= "$SHA256"');
    const paths = (sign.workflow.env?.SIGNING_PATHS ?? "").split(/\s+/);
    for (const required of [
      ".github/workflows/sign-verified-sites.yml",
      ".github/workflows/publish-verified-sites.yml",
      "packages/presto/scripts/verified-sites-signer.ts",
      "rust-toolchain.toml",
      ".cargo",
      "packages/presto/core",
      "packages/presto/verified-sites/key.pub",
      "packages/presto/verified-sites/retired-keys",
      ".github/actions/bot-push",
      ".github/actions/bot-pr",
      ".github/scripts/bot-push.sh",
      ".github/scripts/bot-pr.sh",
      ".github/actions/setup-presto",
      ".bun-version",
      "packages/release-feed/src",
    ]) {
      expect(paths).toContain(required);
    }
  });

  test("the record PR adds exactly the version's two files, create-only, auto-merged", () => {
    const record = job(sign, "record");
    const push = record.steps.find((s) => s.uses === "./.github/actions/bot-push");
    const files = String(push?.with?.paths).trim().split("\n");
    expect(files).toEqual([
      `packages/presto/verified-sites/history/${expr("needs.prepare.outputs.version")}.json`,
      `packages/presto/verified-sites/history/${expr("needs.prepare.outputs.version")}.json.minisig`,
    ]);
    expect(push?.with?.branch).toBe(
      `chore/verified-sites-${expr("needs.prepare.outputs.version")}`,
    );
    expect(push?.with?.["if-exists"]).toBe("skip");
    const pr = record.steps.find((s) => s.uses === "./.github/actions/bot-pr");
    expect(pr?.with?.["auto-merge"]).toBe("true");
  });
});

describe("verified-sites publishing", () => {
  const publishJob = job(publish, "publish");

  test("main must still hold the record and key right before the write", () => {
    const check = stepIndex(publishJob, "Require main to still hold this record");
    const write = stepIndex(publishJob, "Write the document unless KV refuses it");
    expect(check).toBeGreaterThan(-1);
    expect(check).toBe(write - 1);
    const run = publishJob.steps[check]?.run ?? "";
    expect(run).toContain('!= "$HISTORY_TREE"');
    expect(run).toContain('!= "$KEY_BLOB"');
    expect(run).toContain("verified-sites-kv-guard.sh");
  });

  test("the KV write goes through the guard, by API, with the token outside argv", () => {
    const run =
      publishJob.steps[stepIndex(publishJob, "Write the document unless KV refuses it")]?.run;
    expect(run).toContain("/storage/kv/namespaces/$NAMESPACE/values/verified-sites.json");
    expect(run).toContain('bash "$RUNNER_TEMP/kv-guard.sh"');
    expect(run).toContain("-H @<(auth)");
    expect(run).not.toMatch(/Bearer \$CLOUDFLARE_API_TOKEN"?\s*["']?\s+[-\\]/);
    expect(run?.indexOf('echo "attempted=true"')).toBeGreaterThan(run?.indexOf("kv-guard.sh") ?? 0);
    expect(publishJob.env?.NAMESPACE).toBe("41a6adef830f4a91bf63476a323cec98");
  });

  test("a live check follows any attempted write, even a failed one", () => {
    const live = job(publish, "verify-live");
    expect(live.needs).toEqual(["verify", "publish"]);
    expect(live.if).toBe(
      expr("always() && !cancelled() && needs.publish.outputs.write_attempted == 'true'"),
    );
  });
});

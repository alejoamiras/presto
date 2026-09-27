import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const PUSH = join(ROOT, ".github/scripts/bot-push.sh");
const PR = join(ROOT, ".github/scripts/bot-pr.sh");
const WORKFLOWS = join(ROOT, ".github/workflows");

type Step = { uses?: string; run?: string; with?: Record<string, string> };
type Workflow = { jobs?: Record<string, { steps?: Step[] }> };

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "bot-pr-"));
  dirs.push(dir);
  return dir;
}

function run(cmd: string[], cwd: string, env: Record<string, string> = {}) {
  const proc = Bun.spawnSync(cmd, {
    cwd,
    // Hermetic git: no user or system config, so no signing, hooks or default-branch surprises.
    env: {
      PATH: process.env.PATH ?? "",
      HOME: cwd,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: proc.exitCode, out: proc.stdout.toString() + proc.stderr.toString() };
}

/** Test-setup git, with an identity of its own (the scripts under test set theirs). */
function git(cwd: string, ...args: string[]): string {
  const result = run(["git", "-c", "user.name=t", "-c", "user.email=t@example.com", ...args], cwd);
  if (result.code !== 0) throw new Error(result.out);
  return result.out.trim();
}

function outputs(file: string): Record<string, string> {
  if (!existsSync(file)) return {};
  return Object.fromEntries(
    readFileSync(file, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );
}

/** A work tree whose `main` (two tracked files) is pushed to a bare origin. */
function repo(): { work: string; origin: string } {
  const base = tempDir();
  const origin = join(base, "origin.git");
  const work = join(base, "work");
  git(base, "init", "-q", "--bare", "-b", "main", origin);
  git(base, "init", "-q", "-b", "main", work);
  writeFileSync(join(work, "a.txt"), "a\n");
  writeFileSync(join(work, "b.txt"), "b\n");
  git(work, "add", ".");
  git(work, "commit", "-q", "-m", "init");
  git(work, "remote", "add", "origin", origin);
  git(work, "push", "-q", "origin", "main");
  return { work, origin };
}

function push(work: string, env: Record<string, string>) {
  const out = join(work, "..", "push-output");
  const result = run(["bash", PUSH], work, {
    BRANCH: "chore/x",
    MESSAGE: "chore: x",
    PATHS: "a.txt\n",
    GITHUB_OUTPUT: out,
    ...env,
  });
  return { ...result, outputs: outputs(out) };
}

describe("bot-push", () => {
  test("commits exactly the listed paths on a new branch and pushes it", () => {
    const { work, origin } = repo();
    writeFileSync(join(work, "a.txt"), "a2\n");
    const result = push(work, {});
    expect(result.code).toBe(0);
    expect(result.outputs.pushed).toBe("true");
    expect(git(origin, "rev-parse", "refs/heads/chore/x")).toBe(result.outputs.head as string);
    expect(git(work, "show", "--name-only", "--format=%an: %s", "HEAD")).toBe(
      "github-actions[bot]: chore: x\n\na.txt",
    );
  });

  test("pushes nothing when a change outside the list is staged or left behind", () => {
    for (const [stray, stage, error] of [
      ["b.txt", false, "extend the paths input"],
      ["untracked.txt", false, "extend the paths input"],
      ["b.txt", true, "the index already holds staged changes"],
    ] as const) {
      const { work, origin } = repo();
      writeFileSync(join(work, "a.txt"), "a2\n");
      writeFileSync(join(work, stray), "stray\n");
      if (stage) git(work, "add", stray);
      const result = push(work, {});
      expect(result.code).not.toBe(0);
      expect(result.out).toContain(error);
      expect(
        run(["git", "rev-parse", "-q", "--verify", "refs/heads/chore/x"], origin).code,
      ).not.toBe(0);
    }
  });

  test("fails when it cannot tell whether the branch exists", () => {
    const { work } = repo();
    git(work, "remote", "set-url", "origin", join(work, "..", "missing.git"));
    writeFileSync(join(work, "a.txt"), "a2\n");
    const result = push(work, { IF_EXISTS: "skip" });
    expect(result.code).not.toBe(0);
    expect(result.out).toContain("could not list origin's branches");
    expect(result.outputs).toEqual({});
  });

  test("an existing branch fails the run, or with skip is kept exactly as pushed", () => {
    const { work, origin } = repo();
    git(work, "push", "-q", "origin", "main:refs/heads/chore/x");
    const tip = git(origin, "rev-parse", "refs/heads/chore/x");
    writeFileSync(join(work, "a.txt"), "a2\n");
    expect(push(work, { IF_EXISTS: "fail" }).code).not.toBe(0);
    const kept = push(work, { IF_EXISTS: "skip" });
    expect(kept.code).toBe(0);
    expect(kept.outputs).toEqual({ pushed: "false", head: tip });
    expect(git(origin, "rev-parse", "refs/heads/chore/x")).toBe(tip);
  });
});

/** A fake `gh` that logs "<token> <args>" and answers `pr list` from FAKE_PRS through the caller's --jq. */
const FAKE_GH = `#!/usr/bin/env bash
printf '%s %s\\n' "$GH_TOKEN" "$*" >> "$FAKE_LOG"
case "$1 $2" in
  "pr list")
    while [ $# -gt 0 ]; do [ "$1" = --jq ] && filter="$2"; shift; done
    printf '%s' "$FAKE_PRS" | jq -r "$filter" ;;
  "pr create") echo "https://github.com/o/r/pull/42" ;;
esac
`;

function openPr(env: Record<string, string>) {
  const dir = tempDir();
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin/gh"), FAKE_GH);
  chmodSync(join(dir, "bin/gh"), 0o755);
  const log = join(dir, "gh.log");
  const out = join(dir, "output");
  const result = run(["bash", PR], dir, {
    PATH: `${join(dir, "bin")}:${process.env.PATH ?? ""}`,
    FAKE_LOG: log,
    FAKE_PRS: "[]",
    GITHUB_OUTPUT: out,
    GITHUB_REPOSITORY: "o/r",
    GITHUB_SERVER_URL: "https://github.com",
    GH_TOKEN: "pr-token",
    BASE: "main",
    BRANCH: "chore/x",
    TITLE: "t",
    BODY: "b",
    ...env,
  });
  const calls = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [];
  return { ...result, calls, outputs: outputs(out) };
}

describe("bot-pr", () => {
  test("opens and labels the PR, then enables auto-merge for the pushed head with the merge token", () => {
    const result = openPr({
      LABEL: "deps",
      AUTO_MERGE: "true",
      HEAD_SHA: "abc123",
      MERGE_TOKEN: "merge-token",
    });
    expect(result.code).toBe(0);
    expect(result.outputs.number).toBe("42");
    expect(result.calls.slice(1)).toEqual([
      "pr-token pr create --repo o/r --base main --head chore/x --title t --body b --label deps",
      "merge-token pr merge 42 --repo o/r --auto --squash --delete-branch --match-head-commit abc123",
    ]);
  });

  test("refreshes the open same-repository PR and never touches a fork's same-named branch", () => {
    const prs = [
      { number: 5, isCrossRepository: true },
      { number: 9, isCrossRepository: false },
    ];
    const result = openPr({ FAKE_PRS: JSON.stringify(prs), LABEL: "deps" });
    expect(result.code).toBe(0);
    expect(result.outputs.number).toBe("9");
    expect(result.calls.slice(1)).toEqual([
      "pr-token pr edit 9 --repo o/r --title t --body b --add-label deps",
    ]);
  });

  test("refuses auto-merge without the pushed head before calling GitHub", () => {
    const result = openPr({ AUTO_MERGE: "true" });
    expect(result.code).not.toBe(0);
    expect(result.calls).toEqual([]);
  });
});

describe("bot PR contract", () => {
  const workflows = readdirSync(WORKFLOWS)
    .filter((file) => file.endsWith(".yml"))
    .map((file) => {
      const jobs = (Bun.YAML.parse(readFileSync(join(WORKFLOWS, file), "utf8")) as Workflow).jobs;
      return { file, steps: Object.values(jobs ?? {}).flatMap((job) => job.steps ?? []) };
    });

  test("only the bot-pr action opens a PR or enables auto-merge", () => {
    for (const { file, steps } of workflows) {
      const raw = steps.filter((step) =>
        /gh pr create|gh pr merge(?![^\n]*--disable-auto)/.test(step.run ?? ""),
      );
      expect({ file, raw }).toEqual({ file, raw: [] });
    }
  });

  test("every bot PR enables auto-merge only for the head its bot-push pushed", () => {
    const uses = workflows.flatMap(({ file, steps }) =>
      steps
        .filter((step) => step.uses === "./.github/actions/bot-pr")
        .map((step) => ({ file, step })),
    );
    expect(uses.map(({ file }) => file).sort()).toEqual([
      "_aztec-update.yml",
      "release-bot-token-check.yml",
      "release-presto.yml",
      "release-sdk.yml",
    ]);
    for (const { step } of uses) {
      expect(step.with?.head).toMatch(/^\$\{\{ (steps\.push|needs\.update)\.outputs\.head \}\}$/);
    }
  });

  test("the token smoke's PR can never merge: its commit fails a required SDK check", () => {
    const smoke = workflows.find(({ file }) => file === "release-bot-token-check.yml")?.steps;
    const write = smoke?.find((step) => step.run?.includes("scripts/release-bot-smoke.ts"))?.run;
    const push = smoke?.find((step) => step.uses === "./.github/actions/bot-push");
    expect(push?.with?.paths).toBe("scripts/release-bot-smoke.ts");
    const source = /printf '([^']*)'/.exec(write ?? "")?.[1]?.replaceAll("\\n", "\n") ?? "";
    expect(source).toContain("export const smoke = ;");
    expect(() => new Bun.Transpiler({ loader: "ts" }).transformSync(source)).toThrow();
    // SDK Status (required on main) fails when the SDK lint of `scripts/**` fails.
    expect(readFileSync(join(WORKFLOWS, "sdk.yml"), "utf8")).toContain("- 'scripts/**'");
  });

  test("the actions reach their scripts only through the environment", () => {
    for (const action of ["bot-push", "bot-pr"]) {
      const source = readFileSync(join(ROOT, `.github/actions/${action}/action.yml`), "utf8");
      const steps = (Bun.YAML.parse(source) as { runs: { steps: Step[] } }).runs.steps;
      expect(steps.map((step) => step.run)).toEqual([
        `bash "$GITHUB_ACTION_PATH/../../scripts/${action}.sh"`,
      ]);
    }
  });
});

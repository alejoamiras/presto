/**
 * The Workers Builds build command: `bun scripts/workers-build.ts <landing|playground>`. Only a
 * playground build of `main` installs the pinned, provenance-verified published SDK; every other
 * build uses the workspace.
 */
import { resolve } from "node:path";

export const SITES = ["landing", "playground"] as const;
export type Site = (typeof SITES)[number];

const PRODUCTION_BRANCH = "main";

export function buildSteps(site: string, branch: string | undefined): string[][] {
  if (!SITES.includes(site as Site)) {
    throw new Error(`usage: bun scripts/workers-build.ts <${SITES.join("|")}>`);
  }
  if (!branch) throw new Error("WORKERS_CI_BRANCH is not set");
  return [
    // No lifecycle scripts: build-time code runs next to an account-wide Workers deploy token.
    ["bun", "install", "--frozen-lockfile", "--ignore-scripts"],
    ...(site === "playground" && branch === PRODUCTION_BRANCH
      ? [["bun", "scripts/published-playground.ts"]]
      : []),
    ["bun", "run", "--cwd", `packages/${site}`, "build"],
  ];
}

export interface Toolchain {
  /** Set by Workers Builds; elsewhere the caller's own Bun pin applies. */
  workersCi: boolean;
  bun: string;
  pinnedBun: string;
  npm?: string;
  has: (command: string) => boolean;
}

/**
 * Checked on every playground branch, so previews prove the image can run the production path
 * before a `main` build depends on it.
 */
export function toolchainProblems(site: Site, tools: Toolchain): string[] {
  const problems: string[] = [];
  if (tools.workersCi && tools.bun !== tools.pinnedBun) {
    problems.push(
      `Bun ${tools.bun} does not match .bun-version ${tools.pinnedBun}; set BUN_VERSION`,
    );
  }
  if (site === "playground") {
    // npm 10 omits verified attestations from `npm audit signatures --json`.
    const major = Number(tools.npm?.split(".")[0]);
    if (!(major >= 11)) {
      problems.push(`npm ${tools.npm ?? "(missing)"} is older than 11; set NODE_VERSION`);
    }
    for (const command of ["bash", "tar"]) {
      if (!tools.has(command)) problems.push(`${command} is not on PATH`);
    }
  }
  return problems;
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "..");
  const site = process.argv[2] ?? "";
  const branch = process.env.WORKERS_CI_BRANCH;
  const steps = buildSteps(site, branch);
  const npm = Bun.spawnSync(["npm", "--version"], { stdout: "pipe", stderr: "ignore" });
  const problems = toolchainProblems(site as Site, {
    workersCi: process.env.WORKERS_CI === "1",
    bun: Bun.version,
    pinnedBun: (await Bun.file(`${root}/.bun-version`).text()).trim(),
    npm: npm.exitCode === 0 ? npm.stdout.toString().trim() : undefined,
    has: (command) => Bun.which(command) !== null,
  });
  if (problems.length) {
    for (const problem of problems) console.error(`workers-build: ${problem}`);
    process.exit(1);
  }
  console.log(`workers-build: ${site} on ${branch}`);
  for (const step of steps) {
    console.log(`$ ${step.join(" ")}`);
    const { exitCode } = Bun.spawnSync(step, { cwd: root, stdout: "inherit", stderr: "inherit" });
    if (exitCode !== 0) process.exit(exitCode ?? 1);
  }
}

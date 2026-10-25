/**
 * The Workers Builds build command: `bun scripts/workers-build.ts <landing|playground>`. Only a
 * playground build of `main` installs the pinned, provenance-verified published SDK; every other
 * build uses the workspace.
 */
import { delimiter, resolve } from "node:path";

export const SITES = ["landing", "playground"] as const;
export type Site = (typeof SITES)[number];

const PRODUCTION_BRANCH = "main";

/**
 * The playground's lock-pinned npm. Workers Builds' image puts its own npm 10.9.2 first on `PATH`
 * whatever `NODE_VERSION` installs, and npm 10 omits verified attestations from
 * `npm audit signatures --json`.
 */
export const PINNED_NPM_BIN = "packages/playground/node_modules/.bin";
/** The pinned npm itself: its bundled `node_modules` is the code that npm runs. */
export const PINNED_NPM_DIR = "packages/playground/node_modules/npm";

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

/** `PATH` for the steps after the install: the playground's resolves `npm` to the pin. */
export function stepPath(site: Site, root: string, path: string | undefined): string | undefined {
  if (site !== "playground") return path;
  return [resolve(root, PINNED_NPM_BIN), ...(path ? [path] : [])].join(delimiter);
}

export interface Toolchain {
  /** Set by Workers Builds; elsewhere the caller's own Bun pin applies. */
  workersCi: boolean;
  bun: string;
  pinnedBun: string;
  has: (command: string) => boolean;
}

/**
 * Checked before the install on every playground branch, so previews prove the image can run the
 * production path before a `main` build depends on it.
 */
export function toolchainProblems(site: Site, tools: Toolchain): string[] {
  const problems: string[] = [];
  if (tools.workersCi && tools.bun !== tools.pinnedBun) {
    problems.push(
      `Bun ${tools.bun} does not match .bun-version ${tools.pinnedBun}; set BUN_VERSION`,
    );
  }
  if (site === "playground") {
    for (const command of ["bash", "tar"]) {
      if (!tools.has(command)) problems.push(`${command} is not on PATH`);
    }
  }
  return problems;
}

/** The playground manifest's npm pin: an exact version, npm 11 or later. */
export function pinnedNpmVersion(manifest: { devDependencies?: Record<string, string> }): string {
  const pin = manifest.devDependencies?.npm ?? "";
  const major = /^([1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.exec(pin)?.[1];
  if (!major || Number(major) < 11) {
    throw new Error(`packages/playground pins npm "${pin}"; expected an exact 11.x or later`);
  }
  return pin;
}

/**
 * Checked after the install: `npm` on `path` must be the playground's pin at exactly `expected`, so
 * a missing link never falls back to whatever npm the image ships.
 */
export function pinnedNpmProblem(
  root: string,
  path: string | undefined,
  expected: string,
): string | undefined {
  const pinned = resolve(root, PINNED_NPM_BIN, "npm");
  const found = Bun.which("npm", { PATH: path ?? "" });
  if (found !== pinned) return `npm resolves to ${found ?? "nothing"}, not ${PINNED_NPM_BIN}/npm`;
  const run = Bun.spawnSync([pinned, "--version"], {
    env: { ...process.env, PATH: path },
    stdout: "pipe",
    stderr: "ignore",
  });
  const version = run.exitCode === 0 ? run.stdout.toString().trim() : "(failed)";
  return version === expected ? undefined : `npm ${version} is not the pinned ${expected}`;
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "..");
  const site = process.argv[2] ?? "";
  const branch = process.env.WORKERS_CI_BRANCH;
  const steps = buildSteps(site, branch);
  const fail = (problems: string[]) => {
    for (const problem of problems) console.error(`workers-build: ${problem}`);
    process.exit(1);
  };
  const problems = toolchainProblems(site as Site, {
    workersCi: process.env.WORKERS_CI === "1",
    bun: Bun.version,
    pinnedBun: (await Bun.file(`${root}/.bun-version`).text()).trim(),
    has: (command) => Bun.which(command) !== null,
  });
  if (problems.length) fail(problems);
  const npm =
    site === "playground"
      ? pinnedNpmVersion(await Bun.file(`${root}/packages/playground/package.json`).json())
      : undefined;
  console.log(`workers-build: ${site} on ${branch}`);
  const env = { ...process.env, PATH: stepPath(site as Site, root, process.env.PATH) };
  for (const [index, step] of steps.entries()) {
    console.log(`$ ${step.join(" ")}`);
    const { exitCode } = Bun.spawnSync(step, {
      cwd: root,
      // The install runs on the caller's PATH; the pin exists only once it has linked it.
      env: index === 0 ? process.env : env,
      stdout: "inherit",
      stderr: "inherit",
    });
    if (exitCode !== 0) process.exit(exitCode ?? 1);
    if (index === 0 && npm) {
      const problem = pinnedNpmProblem(root, env.PATH, npm);
      if (problem) fail([problem]);
    }
  }
}

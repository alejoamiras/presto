/**
 * The release-candidate feed's pipeline contract: which KV key a dispatch writes, what a stable
 * promote does to a staged candidate, what withdraw-rc deletes, and how the read-back polls. The
 * steps run for real against a stubbed wrangler, so a regression fails here, not in a production
 * dispatch.
 */
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO = path.resolve(import.meta.dir, "..", "..", "..");
const WF_TEXT = fs.readFileSync(path.join(REPO, ".github/workflows/release-presto.yml"), "utf8");
const LIVE_FEED_SCRIPT = path.join(REPO, ".github/scripts/verify-live-feed.sh");

type Step = { name?: string; id?: string; if?: string; run?: string };
type Job = { if?: string; needs?: string[]; env?: Record<string, string>; steps: Step[] };
const WF = Bun.YAML.parse(WF_TEXT) as { jobs: Record<string, Job> };

function step(job: string, name: string): Step {
  const found = WF.jobs[job]?.steps.find((s) => s.name?.startsWith(name));
  if (!found?.run) throw new Error(`no ${job} step named ${name}`);
  return found;
}

const feed = (version: string) => JSON.stringify({ version, platforms: {} });
/** A GitHub Actions expression, as the parsed workflow holds it. */
const gha = (expression: string) => `\${{ ${expression} }}`;

type KV = { list?: string[]; candidate?: string };

/**
 * Runs a step's script in a temp directory holding `files`, with `bunx wrangler` stubbed over `kv`
 * and every wrangler call recorded. The feed-keys script is the real one.
 */
function runStep(
  run: string,
  env: Record<string, string>,
  kv: KV = {},
  files: Record<string, string> = {},
) {
  const cwd = fs.mkdtempSync(path.join(tmpdir(), "release-feed-step-"));
  try {
    fs.mkdirSync(path.join(cwd, "packages/presto/scripts"), { recursive: true });
    fs.symlinkSync(
      path.join(REPO, "packages/presto/scripts/release-feed-keys.ts"),
      path.join(cwd, "packages/presto/scripts/release-feed-keys.ts"),
    );
    for (const [name, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(cwd, name)), { recursive: true });
      fs.writeFileSync(path.join(cwd, name), text);
    }
    if (kv.candidate !== undefined) fs.writeFileSync(path.join(cwd, ".kv-candidate"), kv.candidate);
    const stubs = `
      bunx() {
        echo "$*" >>.calls
        case "$*" in
          "wrangler kv key list --prefix latest-rc.json "*) printf '%s' '${JSON.stringify((kv.list ?? []).map((name) => ({ name })))}' ;;
          "wrangler kv key get latest-rc.json "*) cat .kv-candidate ;;
        esac
      }
    `;
    const r = Bun.spawnSync(["bash", "-c", `${stubs}\n${run}`], {
      cwd,
      env: { PATH: process.env.PATH, GITHUB_OUTPUT: path.join(cwd, ".output"), ...env },
    });
    const read = (name: string) =>
      fs.existsSync(path.join(cwd, name)) ? fs.readFileSync(path.join(cwd, name), "utf8") : "";
    return {
      code: r.exitCode,
      log: r.stdout.toString() + r.stderr.toString(),
      calls: read(".calls").split("\n").filter(Boolean),
      output: Object.fromEntries(
        read(".output")
          .split("\n")
          .filter(Boolean)
          .map((line) => line.split(/=(.*)/s).slice(0, 2)),
      ) as Record<string, string>,
    };
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

describe("release candidate feed: which key a dispatch writes", () => {
  const validate = step("validate", "Validate and output version").run ?? "";
  const resolve = (version: string, mode = "promote-only", bump = "false") =>
    runStep(validate, { INPUT_VERSION: version, MODE: mode, BUMP_SOURCE: bump });

  test("the key and the channel derive from the version, never from an input", () => {
    expect(resolve("1.3.0").output).toMatchObject({
      feed_key: "latest.json",
      is_prerelease: "false",
    });
    expect(resolve("1.3.0-rc.2").output).toMatchObject({
      feed_key: "latest-rc.json",
      is_prerelease: "true",
    });
    for (const bad of ["1.3.0-beta.1", "01.3.0", "1.3.0+build.7"]) {
      expect(resolve(bad).code, bad).toBe(1);
    }
    const promote = WF.jobs.promote;
    expect(promote?.env?.FEED_KEY).toBe(gha("needs.validate.outputs.feed_key"));
    expect(promote?.env?.CHANNEL).toBe(
      gha("needs.validate.outputs.is_prerelease == 'true' && 'rc' || 'stable'"),
    );
    const promoteText = JSON.stringify(promote);
    expect(promoteText.match(/inputs\.[a-z_]+/g)?.sort()).toEqual([
      "inputs.auth_probe",
      "inputs.dry_run",
      "inputs.dry_run",
      "inputs.dry_run",
      "inputs.mode",
    ]);
  });

  test("a release candidate cannot bump the source, and withdraw-rc names a candidate", () => {
    expect(resolve("1.3.0-rc.2", "promote-only", "true").code).toBe(1);
    expect(resolve("1.3.0", "promote-only", "true").code).toBe(0);
    expect(resolve("1.3.0", "withdraw-rc").code).toBe(1);
    expect(resolve("1.3.0-rc.2", "withdraw-rc").code).toBe(0);
  });

  test("the write refuses a feed outside its key before anything is attempted", () => {
    const write = step("promote", "Flip the KV feed").run ?? "";
    const put = (key: string, version: string) =>
      runStep(
        write,
        { FEED_KEY: key, VERSION: version, NAMESPACE_ID: "ns" },
        {},
        { [`feed/${key}`]: feed(version) },
      );
    for (const [key, version] of [
      ["latest.json", "1.3.0"],
      ["latest-rc.json", "1.3.0-rc.2"],
    ] as const) {
      const run = put(key, version);
      expect(run.code, run.log).toBe(0);
      expect(run.output.attempted).toBe("true");
      expect(run.calls).toEqual([
        `wrangler kv key put ${key} --path feed/${key} --remote --namespace-id ns`,
      ]);
    }
    for (const [key, version] of [
      ["latest.json", "1.3.0-rc.2"],
      ["latest-rc.json", "1.3.0"],
    ] as const) {
      const run = put(key, version);
      expect(run.code).toBe(1);
      expect(run.log).toContain(`${version} does not belong in ${key}`);
      expect([run.calls, run.output.attempted]).toEqual([[], undefined]);
    }
  });

  test("a candidate promote verifies as one, above the live stable, which the read-back holds still", () => {
    const preflight = step("promote", "Pre-flight").run ?? "";
    expect(preflight).toContain(`jq -e --argjson pre "$IS_PRERELEASE" '.isPrerelease == $pre'`);
    expect(preflight).toContain(`"$FEED_KEY" | LC_ALL=C sort)`);
    expect(preflight).toContain(
      `"$TOOL" verify --feed "feed/$FEED_KEY" --pubkey pubkey.b64 --channel "$CHANNEL" | tee verify.out`,
    );
    expect(preflight).toContain(`"$(grep -c ', Candidate)$' verify.out)" != 4`);
    expect(preflight).toContain(
      `"$TOOL" verify --feed live-stable.json --pubkey pubkey.b64 --channel stable`,
    );
    expect(preflight).toContain(
      `STANDING=$(bun packages/presto/scripts/release-feed-keys.ts standing "$LIVE_STABLE" "feed/$FEED_KEY")`,
    );
    expect(preflight).toContain(`if [ "$STANDING" != above ]; then`);
    const verify = step("verify-live-feed", "Poll the public routes").run ?? "";
    expect(verify).toContain(
      'promote-only/true)\n    check latest-rc.json "$VERSION" rc\n    [ -n "$LIVE_STABLE" ]',
    );
    expect(verify).toContain('check latest.json "$LIVE_STABLE" stable');
  });
});

describe("release candidate feed: a stable promote settles the candidate key", () => {
  const settle = step("promote", "Delete a staged release candidate");
  const run = (kv: KV) => runStep(settle.run ?? "", { VERSION: "1.3.0", NAMESPACE_ID: "ns" }, kv);
  const DELETE = "wrangler kv key delete latest-rc.json --remote --namespace-id ns";

  test("it runs for a written stable alone", () => {
    expect(settle.if).toBe(
      gha("!inputs.dry_run && needs.validate.outputs.is_prerelease == 'false'"),
    );
  });

  test("a candidate at or below the stable, or unreadable, is deleted; one above it stays", () => {
    const cases: [KV, boolean, string][] = [
      [{}, false, "1.3.0"],
      [{ list: ["latest-rc.json.bak"] }, false, "1.3.0"],
      [{ list: ["latest-rc.json"], candidate: feed("1.3.0-rc.4") }, true, "1.3.0"],
      [{ list: ["latest-rc.json"], candidate: feed("1.2.9-rc.1") }, true, "1.3.0"],
      [{ list: ["latest-rc.json"], candidate: "not json" }, true, "1.3.0"],
      [{ list: ["latest-rc.json"], candidate: feed("1.4.0-rc.1") }, false, "1.4.0-rc.1"],
    ];
    for (const [kv, deleted, route] of cases) {
      const result = run(kv);
      expect([kv, result.code], result.log).toEqual([kv, 0]);
      expect([kv, result.calls.includes(DELETE)]).toEqual([kv, deleted]);
      expect([kv, result.output.rc_route]).toEqual([kv, route]);
    }
  });
});

describe("release candidate feed: withdraw-rc", () => {
  const job = WF.jobs["withdraw-rc"];
  const preflight = step("withdraw-rc", "Pre-flight").run ?? "";

  test("it deletes latest-rc.json alone, behind its own mode and environment, never in a dry run", () => {
    expect(job?.if).toBe(gha("!inputs.auth_probe && inputs.mode == 'withdraw-rc'"));
    expect(WF_TEXT).toContain(
      "  withdraw-rc:\n    name: Withdraw the release candidate (delete KV latest-rc.json)\n    needs: [validate]",
    );
    const deletes = WF_TEXT.match(/wrangler kv key delete \S+/g);
    expect(deletes).toEqual(Array(2).fill("wrangler kv key delete latest-rc.json"));
    expect(step("withdraw-rc", "Delete KV latest-rc.json").if).toBe(gha("!inputs.dry_run"));
    expect(WF_TEXT.match(/wrangler kv key put/g)).toHaveLength(1);
  });

  test("it refuses while KV holds another candidate, and withdraws this one, an unreadable one or none", () => {
    const run = (kv: KV) => runStep(preflight, { VERSION: "1.3.0-rc.2", NAMESPACE_ID: "ns" }, kv);
    const other = run({ list: ["latest-rc.json"], candidate: feed("1.3.0-rc.3") });
    expect(other.code).toBe(1);
    expect(other.log).toContain("holds 1.3.0-rc.3, not 1.3.0-rc.2");
    for (const kv of [
      { list: ["latest-rc.json"], candidate: feed("1.3.0-rc.2") },
      {},
      { list: ["latest-rc.json"], candidate: "{}" },
    ]) {
      const result = run(kv);
      expect([kv, result.code], result.log).toEqual([kv, 0]);
    }
  });

  test("its read-back waits for latest-rc.json to serve latest.json's own bytes", () => {
    const live = WF.jobs["verify-live-feed"];
    expect(live?.needs).toEqual(["validate", "promote", "withdraw-rc"]);
    expect(live?.if).toContain(
      "(needs.promote.outputs.write_attempted == 'true' || needs.withdraw-rc.outputs.write_attempted == 'true')",
    );
    const verify = step("verify-live-feed", "Poll the public routes").run ?? "";
    expect(verify).toContain(
      'check latest.json "$STABLE" stable\n    check latest-rc.json "$STABLE" rc\n    cmp -s live-latest.json live-latest-rc.json',
    );
  });
});

describe("release candidate feed: the live read-back", () => {
  /**
   * Runs verify-live-feed.sh against a stubbed curl that serves `bodies` in turn (the last one from
   * then on) and answers every asset HEAD with `assetCode`; sleep is a no-op and the tool records its
   * arguments.
   */
  function poll(bodies: string[], assetCode = "200") {
    const work = fs.mkdtempSync(path.join(tmpdir(), "live-feed-"));
    try {
      const bin = path.join(work, "bin");
      fs.mkdirSync(bin);
      bodies.forEach((body, i) => {
        fs.writeFileSync(path.join(work, `body-${i}`), body);
      });
      fs.writeFileSync(
        path.join(bin, "curl"),
        `#!/usr/bin/env bash
if [[ " $* " == *" -fsIL "* ]]; then printf '%s' '${assetCode}'; exit 0; fi
n=$(cat "${work}/n" 2>/dev/null || echo 0); echo $((n + 1)) > "${work}/n"
i=$(( n < ${bodies.length - 1} ? n : ${bodies.length - 1} ))
while [ $# -gt 0 ]; do [ "$1" = -o ] && out=$2; shift; done
cp "${work}/body-$i" "$out"
`,
        { mode: 0o755 },
      );
      fs.writeFileSync(path.join(bin, "sleep"), "#!/usr/bin/env bash\n", { mode: 0o755 });
      fs.writeFileSync(
        path.join(work, "tool"),
        `#!/usr/bin/env bash\necho "$*" > "${work}/tool-args"\n`,
        { mode: 0o755 },
      );
      const r = Bun.spawnSync(
        [
          "bash",
          LIVE_FEED_SCRIPT,
          "https://presto.build/releases/latest-rc.json",
          "1.3.0-rc.2",
          "rc",
          path.join(work, "tool"),
          path.join(work, "pubkey"),
          path.join(work, "live.json"),
        ],
        { env: { PATH: `${bin}:${process.env.PATH}` } },
      );
      const read = (name: string) =>
        fs.existsSync(path.join(work, name)) ? fs.readFileSync(path.join(work, name), "utf8") : "";
      return {
        code: r.exitCode,
        log: r.stdout.toString() + r.stderr.toString(),
        polls: Number(read("n")),
        tool: read("tool-args").trim(),
        body: read("live.json"),
      };
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  }

  const served = (
    version: string,
    platforms = ["darwin-aarch64", "darwin-x86_64", "linux-x86_64", "windows-x86_64"],
  ) =>
    JSON.stringify({
      version,
      platforms: Object.fromEntries(platforms.map((p) => [p, { url: `https://github.test/${p}` }])),
    });

  test("it polls until the route serves the version, then verifies those exact bytes on its channel", () => {
    const body = served("1.3.0-rc.2");
    const result = poll([served("1.2.0"), "", body]);
    expect(result.code, result.log).toBe(0);
    expect(result.polls).toBe(3);
    expect(result.body).toBe(body);
    expect(result.tool).toMatch(/^verify --feed \S+live\.json --pubkey \S+pubkey --channel rc$/);
  });

  test("it fails after its deadline, on a missing platform or an unreachable download", () => {
    const stale = poll([served("1.2.0")]);
    expect([stale.code, stale.polls]).toEqual([1, 60]);
    expect(stale.log).toContain("still not 1.3.0-rc.2 after ~10 min");
    expect(poll([served("1.3.0-rc.2", ["darwin-aarch64"])]).code).toBe(1);
    const unreachable = poll([served("1.3.0-rc.2")], "404");
    expect([unreachable.code, unreachable.tool]).toEqual([1, ""]);
  });
});

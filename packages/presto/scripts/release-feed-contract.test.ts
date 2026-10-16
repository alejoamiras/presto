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
  if (!found) throw new Error(`no ${job} step named ${name}`);
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

describe("release candidate feed: every release stages its own signed feed", () => {
  test("a stable stages latest.json and a prerelease latest-rc.json, as the 17th asset", () => {
    const download = step("release", "Download signed update feed");
    const stage = step("release", "Stage the signed feed");
    expect([download.if, stage.if]).toEqual([undefined, undefined]);
    expect(stage.run).toContain('cp "signed-feed/$FEED_KEY" "release-files/$FEED_KEY"');
    expect(step("release", "Create release").run).toContain(
      "-o -name 'latest.json' -o -name 'latest-rc.json' \\) -print0)",
    );
    expect(step("promote", "Pre-flight").run).toContain('"$FEED_KEY" | LC_ALL=C sort)');
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
    expect(deletes).toEqual([
      "wrangler kv key delete latest-rc.json",
      "wrangler kv key delete latest-rc.json",
    ]);
    expect(step("withdraw-rc", "Delete KV latest-rc.json").if).toBe(gha("!inputs.dry_run"));
    expect(WF_TEXT.match(/wrangler kv key put/g)).toHaveLength(1);
  });

  test("every job holding the feed token installs the locked wrangler before its first use", () => {
    const tokenJobs = Object.entries(WF.jobs).filter(([, job]) =>
      JSON.stringify(job).includes("CLOUDFLARE_RELEASE_FEED_API_TOKEN"),
    );
    expect(tokenJobs.map(([name]) => name).sort()).toEqual([
      "promote",
      "release-auth-preflight",
      "withdraw-rc",
    ]);
    for (const [name, job] of tokenJobs) {
      const steps = job.steps as (Step & { uses?: string; with?: Record<string, string> })[];
      const installs = steps.findIndex(
        (s) =>
          s.run === "bun install --frozen-lockfile" ||
          (s.uses === "./.github/actions/setup-presto" && s.with?.["install-js-deps"] !== "false"),
      );
      const firstToken = steps.findIndex((s) =>
        JSON.stringify(s).includes("CLOUDFLARE_RELEASE_FEED_API_TOKEN"),
      );
      expect([name, installs >= 0 && installs < firstToken]).toEqual([name, true]);
    }
  });

  test("it refuses while KV holds another candidate, and withdraws this one, an unreadable one or none", () => {
    const run = (kv: KV) => runStep(preflight, { VERSION: "1.3.0-rc.2", NAMESPACE_ID: "ns" }, kv);
    const other = run({ list: ["latest-rc.json"], candidate: feed("1.3.0-rc.3") });
    expect(other.code).toBe(1);
    expect(other.log).toContain("holds 1.3.0-rc.3, not 1.3.0-rc.2");
    const withdrawn = [
      { list: ["latest-rc.json"], candidate: feed("1.3.0-rc.2") },
      {},
      ...[
        "{}",
        "not json",
        '{"version":7}',
        feed("1.3.0"),
        feed("1.3.0-beta.1"),
        feed("1.3.0-rc.01"),
      ].map((candidate) => ({ list: ["latest-rc.json"], candidate })),
    ];
    for (const kv of withdrawn) {
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

const SCRIPTS = path.join(REPO, "packages/presto/scripts");
const readScript = (name: string) => fs.readFileSync(path.join(SCRIPTS, name), "utf8");

describe("release smokes: a prerelease N's refusal leg", () => {
  /**
   * Runs the unix refusal leg with the app simulated: `launch_app` writes `appLog` and the feed
   * requests `requests`, and the clock advances 7 s per read, so the 60 s windows pass at once.
   */
  function refusalLeg(appLog: string, requests: string[]) {
    const work = fs.mkdtempSync(path.join(tmpdir(), "release-leg-"));
    try {
      const harness = `
        WORK=${JSON.stringify(work)}; CONFIG_DIR="$WORK/cfg"; mkdir -p "$CONFIG_DIR" "$WORK/feeds"
        HEALTH=http://127.0.0.1:1/health; N_VERSION=9.9.9-rc.1; APP_PID=$(ps -o pgid= $$ | tr -d " ")
        log() { :; }
        source ${JSON.stringify(path.join(SCRIPTS, "updater-smoke-modes.sh"))}
        echo '{"version":"9.9.9-rc.1","schema":"v1"}' > "$WORK/latest.json"
        echo '{"version":"9.9.9-rc.1","schema":"rc-v1"}' > "$WORK/latest-rc.json"
        : > "$WORK/feed.log"; echo 0 > "$WORK/clock"
        date() { local t; t=$(cat "$WORK/clock"); echo $((t + 7)) > "$WORK/clock"; echo "$t"; }
        sleep() { :; }; stop_app() { :; }
        health_version() { echo 0.0.1; }; wait_for_n1() { echo 0.0.1; }
        launch_app() {
          echo "launched with $(jq -r .schema "$WORK/feeds/latest.json") $(jq -r .schema "$WORK/feeds/latest-rc.json")"
          printf '%b' ${JSON.stringify(appLog)} > "$1"
          printf 'feed-server: GET %s -> 200\\n' ${requests.map((r) => JSON.stringify(r)).join(" ")} >> "$WORK/feed.log"
        }
        run_release_refusal_leg
        status=$?
        echo "served $(jq -r .schema "$WORK/feeds/latest.json") $(jq -r .schema "$WORK/feeds/latest-rc.json")"
        exit $status
      `;
      const r = Bun.spawnSync(["bash", "-c", harness]);
      return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  }

  // The color codes a terminal-bound tracing line may carry around a field name.
  const CHECK_CHANNEL = "INFO Checking for updates... \\033[3mchannel\\033[0m=stable endpoint=x\\n";
  const CHECK_PRE_CHANNEL = "INFO Checking for updates...\\n";

  test("on the stable channel N-1 must refuse the rc-v1 twin on its schema or as a candidate", () => {
    const channel = refusalLeg(
      `${CHECK_CHANNEL}ERROR SECURITY: update refused on channel stable: CandidateOffChannel\\n`,
      ["/releases/latest.json"],
    );
    expect(channel.code, channel.out).toBe(0);
    // The positive leg then serves each feed from its own path.
    expect(channel.out).toContain("launched with rc-v1 rc-v1");
    expect(channel.out).toContain("served v1 rc-v1");
    const pre = refusalLeg(
      `${CHECK_PRE_CHANNEL}ERROR SECURITY: update-manifest verification failed (schema); refusing update\\n`,
      ["/releases/latest.json"],
    );
    expect(pre.code, pre.out).toBe(0);
  });

  test("the refusal leg fails a build that downloads the candidate or refuses for another reason", () => {
    const downloads = refusalLeg(CHECK_CHANNEL, ["/releases/latest.json", "/releases/download/x"]);
    expect(downloads.code).toBe(1);
    expect(downloads.out).toContain("REFUSAL: the app downloaded an update it must refuse");
    const otherReason = refusalLeg(
      `${CHECK_CHANNEL}ERROR SECURITY: update refused on channel stable: PrereleaseNotCandidate\\n`,
      ["/releases/latest.json"],
    );
    expect(otherReason.code).toBe(1);
    expect(otherReason.out).toContain("no 'update refused on channel stable: CandidateOffChannel'");
    // A pre-channel check that ends without its schema refusal proves nothing.
    const preChannelFailure = refusalLeg(
      `${CHECK_PRE_CHANNEL}WARN Update check failed: connection reset\\n`,
      ["/releases/latest.json"],
    );
    expect(preChannelFailure.code).toBe(1);
    // A pre-channel build would also log its schema refusal for a channel build's candidate.
    const preChannelLine = refusalLeg(
      `${CHECK_CHANNEL}ERROR SECURITY: update-manifest verification failed (x); refusing update\\n`,
      ["/releases/latest.json"],
    );
    expect(preChannelLine.code).toBe(1);
  });
});

describe("release smokes: a prerelease N's legs, wired", () => {
  const MODES = readScript("updater-smoke-modes.sh");

  test("the unix legs: both feeds staged, the refusal leg first in positive, the channel's path first", () => {
    expect(shellFunction(MODES, "stage_release_feeds")).toContain("-name 'smoke-latest-rc.json'");
    expect(shellFunction(MODES, "stage_release_feeds")).toContain('assert_feed_binds_n "$twin"');
    expect(shellFunction(MODES, "seed_release_config")).toContain(
      "if n_is_prerelease; then\n    seed_developer true rc\n  else\n    seed_developer false stable",
    );
    expect(shellFunction(MODES, "assert_release_feed_order")).toContain(
      "if first_check_line \"$2\" | grep -q 'channel=rc'; then\n    first=/releases/latest-rc.json",
    );
    for (const name of ["updater-smoke.sh", "updater-smoke-linux.sh"]) {
      const script = readScript(name);
      expect(script, name).toContain(
        'elif n_is_prerelease; then\n  stage_release_feeds || exit 1\n  FEED_SOURCE=(--feed-dir "$WORK/feeds")',
      );
      expect(script, name).toContain(
        'if [ "$MODE" = "positive" ] || [ "$MODE" = "negative" ]; then\n  if [ "$MODE" = "positive" ] && n_is_prerelease; then\n    run_release_refusal_leg || { dump_logs; exit 1; }\n  fi\n  seed_release_config\nelse',
      );
      expect(script, name).toContain('MARK="$(feed_mark)"\nlaunch_app "$WORK/app.log"');
      expect(script, name).toContain(
        'assert_release_feed_order "$MARK" "$WORK/app.log" || { dump_logs; exit 1; }',
      );
      expect(
        script.match(/assert_never_read_only \|\| \{ dump_logs; exit 1; \}/g),
        name,
      ).toHaveLength(2);
      expect(script, name).toContain(
        '  *) if n_is_prerelease; then echo "::error::a prerelease N runs only the positive and negative modes"; exit 1; fi ;;',
      );
    }
  });

  test("the Windows legs match, with the refusal leg before crash recovery is armed", () => {
    const script = readScript("updater-smoke-windows.ps1");
    expect(script).toContain(
      '$Twin = Get-ChildItem -Path $NArtifactsDir -Recurse -Filter "smoke-latest-rc.json"',
    );
    expect(script).toContain("Assert-BindsN $Twin.FullName");
    expect(script).toContain(
      'if ($NIsPrerelease) { Set-DeveloperConfig "true" "rc" } else { Set-DeveloperConfig "false" "stable" }',
    );
    const refusalCall = script.indexOf(
      'if ($Mode -eq "positive" -and $NIsPrerelease) { Invoke-ReleaseRefusalLeg }',
    );
    expect(refusalCall).toBeGreaterThan(0);
    expect(refusalCall).toBeLessThan(
      script.indexOf("(#97) Clear any stale crash-recovery task FIRST"),
    );
    const leg = script.split("function Invoke-ReleaseRefusalLeg {")[1]?.split("\n  }\n")[0] ?? "";
    expect(leg).toContain('Set-Feed "latest.json" (Join-Path $Work "latest-rc.json")');
    expect(leg).toContain('Set-Feed "latest-rc.json" (Join-Path $Work "latest-rc.json")');
    expect(leg).toContain('$refusal = "update-manifest verification failed"');
    expect(leg).toContain(
      "if ((Get-FirstCheckLine $mark) -match 'channel=') { $refusal = \"update refused on channel stable: CandidateOffChannel\" }",
    );
    expect(script).toContain(
      '$first = if ((Get-FirstCheckLine $N1Mark) -match \'channel=rc\') { "/releases/latest-rc.json" } else { "/releases/latest.json" }',
    );
    expect(script.match(/Assert-NeverReadOnly \$ReleaseMark/g)).toHaveLength(2);
    expect(script).toContain(
      'if ($NIsPrerelease -and @("positive", "negative") -cnotcontains $Mode) {',
    );
  });

  test("the Windows workflow stages the rc-v1 twin beside the v1 smoke feed", () => {
    const wf = Bun.YAML.parse(
      fs.readFileSync(path.join(REPO, ".github/workflows/_e2e-updater-windows.yml"), "utf8"),
    ) as { jobs: Record<string, Job> };
    const stage = Object.values(wf.jobs)
      .flatMap((job) => job.steps)
      .find((s) => s.name === "Stage N updater artifacts");
    expect(stage?.run).toContain(
      "nfeed=$(find \"$RUNNER_TEMP/n-dl\" -name 'smoke-latest.json' | head -1)",
    );
    expect(stage?.run).toContain(
      'ntwin=$(find "$RUNNER_TEMP/n-dl" -name \'smoke-latest-rc.json\' | head -1)\nif [ -n "$ntwin" ]; then cp "$ntwin" "$RUNNER_TEMP/n/"; fi',
    );
  });
});

/** The text of shell function `name`, from its header to the closing brace at column 0. */
function shellFunction(script: string, name: string): string {
  return script.split(`\n${name}() {`)[1]?.split("\n}\n")[0] ?? "";
}

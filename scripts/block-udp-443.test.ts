import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SCRIPT = resolve(import.meta.dir, "../.github/scripts/block-udp-443.sh");

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Runs the script over a fake `sudo` and a fake `pfctl` that lists `rules` and fails `-E` on demand. */
function run({ rules = "", enableFails = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "pf-block-"));
  dirs.push(dir);
  writeFileSync(join(dir, "sudo"), '#!/usr/bin/env bash\nexec "$@"\n', { mode: 0o755 });
  writeFileSync(
    join(dir, "pfctl"),
    `#!/usr/bin/env bash
echo "$*" >>"${dir}/calls"
case "$1" in
  -f) cat >"${dir}/loaded" ;;
  -E) ${enableFails ? "exit 1" : ":"} ;;
  -sr) printf '%s\\n' ${JSON.stringify(rules)} ;;
esac
`,
    { mode: 0o755 },
  );
  const proc = Bun.spawnSync(["bash", SCRIPT], {
    env: { PATH: `${dir}:${process.env.PATH ?? ""}`, PFCTL: join(dir, "pfctl") },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: proc.exitCode, out: proc.stdout.toString() };
}

describe("block-udp-443.sh", () => {
  test("loads the rule, enables pf, and accepts either port rendering", () => {
    const numeric = run({ rules: "block return out quick proto udp from any to any port = 443" });
    expect(numeric.code).toBe(0);
    const named = run({ rules: "block return out quick proto udp from any to any port = https" });
    expect(named.code).toBe(0);
  });

  test("fails when the rule is not loaded", () => {
    const r = run({ rules: "pass all" });
    expect(r.code).toBe(1);
    expect(r.out).toContain("::error::the UDP 443 block rule is not loaded");
  });

  test("fails when pf cannot be enabled", () => {
    expect(run({ enableFails: true }).code).toBe(1);
  });
});

/**
 * Runs the real provisioning script against a stub `gh` that records every call's argv, environment
 * and standard input, inside a throwaway copy of the repository layout (so `key.pub` and the updater
 * key are under the test's control).
 */
import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { RFC8032_TEST1_SEED } from "./verified-sites-fixtures.ts";
import { deriveKey, normalizeSeed, publicKeyDocument } from "./verified-sites-signer.ts";

const SEED = createHash("sha256").update("presto provisioning leak test").digest("hex");
const TOKEN = "github_pat_provisioningLeakTestToken0123456789";
const OTHER_SEED = createHash("sha256").update("another key").digest("hex");

const STRONG_ENVIRONMENT = {
  can_admins_bypass: false,
  deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
  protection_rules: [
    { type: "branch_policy" },
    {
      type: "required_reviewers",
      prevent_self_review: false,
      reviewers: [{ type: "User", reviewer: { login: "alejoamiras" } }],
    },
  ],
};
const MAIN_ONLY = { branch_policies: [{ name: "main", type: "branch" }] };

/**
 * Every encoding of the seed that a careless print could produce. The PKCS#8 DER is 48 bytes, so its
 * PEM body is the single 64-character base64 line; a JWK's `d` is the unpadded base64url form.
 */
function seedForms(hex: string): string[] {
  const seed = Buffer.from(hex, "hex");
  const der = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
  const base64 = seed.toString("base64");
  return [
    hex,
    hex.toUpperCase(),
    `0x${hex}`,
    base64,
    base64.replace(/=+$/, ""),
    seed.toString("base64url"),
    base64.replaceAll("+", "-").replaceAll("/", "_"),
    [...seed].join(","),
    [...seed].join(", "),
    [...seed].join(" "),
    der.toString("base64"),
  ];
}

interface Call {
  argv: string[];
  env: Record<string, string>;
  stdin: string;
}

let root = "";
afterEach(() => rmSync(root, { recursive: true, force: true }));

interface Setup {
  environment?: unknown;
  policies?: unknown;
  secrets?: { name: string }[];
  keyPub?: string;
  updaterSeed?: string;
  setFails?: boolean;
}

function setup(options: Setup = {}): void {
  root = mkdtempSync(path.join(tmpdir(), "provision-"));
  for (const dir of ["scripts", "verified-sites", "src-tauri", "bin", "home/calls"]) {
    mkdirSync(path.join(root, dir), { recursive: true });
  }
  for (const file of ["provision-verified-sites-key.ts", "verified-sites-signer.ts"]) {
    copyFileSync(path.join(import.meta.dir, file), path.join(root, "scripts", file));
  }
  if (options.keyPub !== undefined) {
    writeFileSync(path.join(root, "verified-sites/key.pub"), options.keyPub);
  }
  const updater = publicKeyDocument(
    deriveKey(normalizeSeed(options.updaterSeed ?? OTHER_SEED)).publicKey,
  );
  const config = { plugins: { updater: { pubkey: Buffer.from(updater).toString("base64") } } };
  writeFileSync(path.join(root, "src-tauri/tauri.conf.json"), JSON.stringify(config));
  const home = path.join(root, "home");
  writeFileSync(
    path.join(home, "environment.json"),
    JSON.stringify(options.environment ?? STRONG_ENVIRONMENT),
  );
  writeFileSync(path.join(home, "policies.json"), JSON.stringify(options.policies ?? MAIN_ONLY));
  writeFileSync(path.join(home, "secrets.json"), JSON.stringify(options.secrets ?? []));
  const gh = path.join(root, "bin/gh");
  writeFileSync(
    gh,
    `#!/usr/bin/env bash
set -eu
call="$HOME/calls/$(ls "$HOME/calls" | wc -l)"
mkdir "$call"
printf '%s\\0' "$@" > "$call/argv"
env -0 > "$call/env"
case "$*" in
  "api repos/alejoamiras/presto/environments/verified-sites-signing") cat "$HOME/environment.json" ;;
  "api repos/alejoamiras/presto/environments/verified-sites-signing/deployment-branch-policies") cat "$HOME/policies.json" ;;
  "secret list --env verified-sites-signing --repo alejoamiras/presto --json name") cat "$HOME/secrets.json" ;;
  "secret set VERIFIED_SITES_SIGNING_SEED --env verified-sites-signing --repo alejoamiras/presto")
    cat > "$call/stdin"
    ${options.setFails ? "exit 1" : ""}
    printf '[{"name":"VERIFIED_SITES_SIGNING_SEED"}]' > "$HOME/secrets.json" ;;
  *) exit 64 ;;
esac
`,
  );
  chmodSync(gh, 0o755);
}

function provision(args: string[] = [], env: Record<string, string> = {}) {
  const r = Bun.spawnSync(
    [process.execPath, path.join(root, "scripts/provision-verified-sites-key.ts"), ...args],
    {
      env: {
        PATH: `${path.join(root, "bin")}:${process.env.PATH}`,
        HOME: path.join(root, "home"),
        PRESTO_VERIFIED_SITES_SIGNING_SEED: SEED,
        GH_TOKEN: TOKEN,
        ...env,
      },
    },
  );
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
}

function calls(): Call[] {
  const dir = path.join(root, "home/calls");
  return readdirSync(dir)
    .sort((a, b) => Number(a) - Number(b))
    .map((n) => {
      const at = (file: string) => path.join(dir, n, file);
      const env = Object.fromEntries(
        readFileSync(at("env"), "utf8")
          .split("\0")
          .filter(Boolean)
          .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
      );
      return {
        argv: readFileSync(at("argv"), "utf8").split("\0").filter(Boolean),
        env,
        stdin: existsSync(at("stdin")) ? readFileSync(at("stdin"), "utf8") : "",
      };
    });
}

const sets = () => calls().filter((c) => c.argv[0] === "secret" && c.argv[1] === "set");
const pinned = (hex: string) => publicKeyDocument(deriveKey(normalizeSeed(hex)).publicKey);

/** No form of the seed in anything the run exposed: its output, a child's argv or environment. */
function assertNoSeed(r: ReturnType<typeof provision>, call: Call): void {
  const exposed: Record<string, string> = {
    output: r.out + r.err,
    argv: call.argv.join(" "),
    env: Object.entries(call.env)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n"),
  };
  for (const form of seedForms(SEED)) {
    for (const [where, text] of Object.entries(exposed)) {
      expect(text.includes(form), `${form} in ${where}`).toBe(false);
    }
  }
}

describe("provisioning exposes nothing", () => {
  test("leak test: the seed reaches only gh's stdin, the token only gh's environment", () => {
    setup();
    const r = provision();
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(r.out).toStartWith(pinned(SEED));
    expect(r.out).toMatch(/\nKey ID: [0-9A-F]{16}\n$/);
    const all = calls();
    expect(all.length).toBeGreaterThanOrEqual(5);
    for (const call of all) {
      assertNoSeed(r, call);
      expect(call.env.GH_TOKEN).toBe(TOKEN);
      expect(call.argv.join(" ")).not.toContain(TOKEN);
      expect("PRESTO_VERIFIED_SITES_SIGNING_SEED" in call.env).toBe(false);
    }
    expect(r.out + r.err).not.toContain(TOKEN);
    expect(sets().map((c) => c.stdin)).toEqual([SEED]);
  });
});

describe("provisioning refuses", () => {
  test("bad inputs, before calling gh", () => {
    setup();
    const cases: [Record<string, string>, string][] = [
      [
        { PRESTO_VERIFIED_SITES_SIGNING_SEED: "not hex" },
        "the signing seed is not 64 hex characters",
      ],
      [{ GH_TOKEN: "" }, "GH_TOKEN is missing"],
      [{ GH_TOKEN: "two\nlines" }, "GH_TOKEN is missing"],
    ];
    for (const [env, why] of cases) {
      const r = provision([], env);
      expect(r.code).toBe(2);
      expect(r.err).toBe(
        `provision: ${why}${why.startsWith("GH_TOKEN") ? ": the template imports the provisioning token" : ""}\n`,
      );
    }
    expect(provision(["--force"]).code).toBe(2);
    expect(calls()).toEqual([]);
  });

  test("to store the secret in a weaker environment", () => {
    const weak: Setup[] = [
      { environment: { ...STRONG_ENVIRONMENT, can_admins_bypass: true } },
      { environment: { ...STRONG_ENVIRONMENT, protection_rules: [{ type: "branch_policy" }] } },
      {
        environment: {
          ...STRONG_ENVIRONMENT,
          deployment_branch_policy: { protected_branches: true, custom_branch_policies: false },
        },
      },
      {
        policies: {
          branch_policies: [
            { name: "main", type: "branch" },
            { name: "dev", type: "branch" },
          ],
        },
      },
      { policies: { branch_policies: [{ name: "main", type: "tag" }] } },
    ];
    for (const options of weak) {
      setup(options);
      const r = provision();
      expect(r.code).toBe(1);
      expect(sets()).toEqual([]);
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("any mode outside its own starting state", () => {
    const cases: [string[], Setup, boolean][] = [
      [[], { secrets: [{ name: "VERIFIED_SITES_SIGNING_SEED" }] }, false],
      [[], { keyPub: pinned(SEED) }, false],
      [
        ["--restore"],
        { keyPub: pinned(SEED), secrets: [{ name: "VERIFIED_SITES_SIGNING_SEED" }] },
        true,
      ],
      [["--restore"], { keyPub: pinned(OTHER_SEED) }, false],
      [["--restore"], {}, false],
      [
        ["--rotate"],
        { keyPub: pinned(OTHER_SEED), secrets: [{ name: "VERIFIED_SITES_SIGNING_SEED" }] },
        true,
      ],
      [["--rotate"], { keyPub: pinned(SEED) }, false],
      [["--rotate"], {}, false],
    ];
    for (const [args, options, allowed] of cases) {
      setup(options);
      const r = provision(args);
      expect(r.code, `${args} ${JSON.stringify(options)}`).toBe(allowed ? 0 : 1);
      expect(sets().length).toBe(allowed ? 1 : 0);
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a published test vector and the updater key, and reports a failed set", () => {
    setup();
    const vector = provision([], { PRESTO_VERIFIED_SITES_SIGNING_SEED: RFC8032_TEST1_SEED });
    expect(vector.err).toBe("provision: the seed is a published test vector\n");
    rmSync(root, { recursive: true, force: true });
    setup({ updaterSeed: SEED });
    expect(provision().err).toBe("provision: the seed is the updater key\n");
    rmSync(root, { recursive: true, force: true });
    setup({ setFails: true });
    const failed = provision();
    expect(failed.code).toBe(1);
    expect(failed.err).toBe("provision: gh secret set failed\n");
    expect(failed.out).toBe("");
  });
});

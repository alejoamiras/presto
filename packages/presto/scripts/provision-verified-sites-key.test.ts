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
const OWNER_REVIEWER = { type: "User", reviewer: { login: "alejoamiras" } };
const withReviewers = (rules: unknown[]) => ({
  ...STRONG_ENVIRONMENT,
  protection_rules: [{ type: "branch_policy" }, ...rules],
});

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
    // Raw bytes, as files are read (latin1 keeps every byte).
    seed.toString("latin1"),
    der.toString("latin1"),
  ];
}

interface Call {
  argv: string[];
  env: Record<string, string>;
  stdin: string;
  /** What GH_CONFIG_DIR held when gh started. */
  config: string;
}

let root = "";
afterEach(() => rmSync(root, { recursive: true, force: true }));

interface Setup {
  environment?: unknown;
  policies?: unknown;
  secrets?: { name: string }[];
  keyPub?: string;
  updaterSeed?: string;
  /** Replaces the whole `tauri.conf.json`. */
  tauriConfig?: unknown;
  /** `gh secret set` echoes the seed it was given and the token to both streams, then fails. */
  setFails?: boolean;
}

/** What the script's own child environment may hold; bash adds the rest. */
const CHILD_ENV = [
  "GH_CONFIG_DIR",
  "GH_HOST",
  "GH_NO_UPDATE_NOTIFIER",
  "GH_PROMPT_DISABLED",
  "GH_TOKEN",
  "HOME",
  "PATH",
];
const BASH_ENV = new Set(["OLDPWD", "PWD", "SHLVL", "_"]);

function setup(options: Setup = {}): void {
  root = mkdtempSync(path.join(tmpdir(), "provision-"));
  for (const dir of ["scripts", "verified-sites", "src-tauri", "bin", "home/calls", "tmp"]) {
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
  const config = options.tauriConfig ?? {
    plugins: { updater: { pubkey: Buffer.from(updater).toString("base64") } },
  };
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
ls -A "$GH_CONFIG_DIR" > "$call/config"
case "$*" in
  "api repos/alejoamiras/presto/environments/verified-sites-signing") cat "$HOME/environment.json" ;;
  "api repos/alejoamiras/presto/environments/verified-sites-signing/deployment-branch-policies") cat "$HOME/policies.json" ;;
  "secret list --env verified-sites-signing --repo alejoamiras/presto --json name") cat "$HOME/secrets.json" ;;
  "secret set VERIFIED_SITES_SIGNING_SEED --env verified-sites-signing --repo alejoamiras/presto")
    cat > "$call/stdin"
    ${options.setFails ? 'for fd in 1 2; do echo "seed $(cat "$call/stdin") token $GH_TOKEN" >&"$fd"; done; exit 1' : ""}
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
        TMPDIR: path.join(root, "tmp"),
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
        config: readFileSync(at("config"), "utf8"),
      };
    });
}

const sets = () => calls().filter((c) => c.argv[0] === "secret" && c.argv[1] === "set");
const pinned = (hex: string) => publicKeyDocument(deriveKey(normalizeSeed(hex)).publicKey);

/** Every file the run left in the throwaway tree, except the stub's own recordings. */
function treeFiles(): Record<string, string> {
  const recordings = path.join(root, "home/calls") + path.sep;
  return Object.fromEntries(
    readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile() && !`${e.parentPath}${path.sep}`.startsWith(recordings))
      .map((e) => [
        path.join(e.parentPath, e.name),
        readFileSync(path.join(e.parentPath, e.name), "latin1"),
      ]),
  );
}

/** No form of the seed in anything the run exposed: output, files, a child's argv or environment. */
function assertNoSeed(r: ReturnType<typeof provision>): void {
  const exposed: Record<string, string> = { output: r.out + r.err, ...treeFiles() };
  for (const [n, call] of calls().entries()) {
    exposed[`argv ${n}`] = call.argv.join(" ");
    exposed[`env ${n}`] = Object.entries(call.env)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");
  }
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
    assertNoSeed(r);
    const all = calls();
    expect(all.length).toBeGreaterThanOrEqual(5);
    for (const call of all) {
      expect(
        Object.keys(call.env)
          .filter((k) => !BASH_ENV.has(k))
          .sort(),
      ).toEqual(CHILD_ENV);
      expect(call.env.GH_TOKEN).toBe(TOKEN);
      expect(call.env.GH_HOST).toBe("github.com");
      expect(call.env.GH_CONFIG_DIR).toStartWith(path.join(root, "tmp"));
      expect(call.config).toBe("");
      expect(call.argv.join(" ")).not.toContain(TOKEN);
    }
    expect(r.out + r.err).not.toContain(TOKEN);
    expect(readdirSync(path.join(root, "tmp"))).toEqual([]);
    expect(sets().map((c) => c.stdin)).toEqual([SEED]);
  });

  test("a failing gh that echoes the seed and token reaches no output", () => {
    setup({ setFails: true });
    const failed = provision();
    expect(failed).toEqual({ code: 1, out: "", err: "provision: gh secret set failed\n" });
    assertNoSeed(failed);
    expect(readdirSync(path.join(root, "tmp"))).toEqual([]);
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
      ...[
        [OWNER_REVIEWER, { type: "User", reviewer: { login: "someone-else" } }],
        [OWNER_REVIEWER, { type: "Team", reviewer: { slug: "maintainers" } }],
        [{ type: "Team", reviewer: { login: "alejoamiras" } }],
      ].map((reviewers) => ({
        environment: withReviewers([{ type: "required_reviewers", reviewers }]),
      })),
      {
        environment: withReviewers([
          { type: "required_reviewers", reviewers: [OWNER_REVIEWER] },
          { type: "required_reviewers", reviewers: [OWNER_REVIEWER] },
        ]),
      },
    ];
    for (const options of weak) {
      setup(options);
      const r = provision();
      expect(r.code).toBe(1);
      expect(sets()).toEqual([]);
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("provisioning refuses keys", () => {
  test("in any mode outside its own starting state", () => {
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

  test("a published test vector, the updater key, or an updater key it cannot read", () => {
    const short = `untrusted comment: x\n${Buffer.from("Ed12345678").toString("base64")}\n`;
    const cases: [Setup, Record<string, string>, string][] = [
      [{}, { PRESTO_VERIFIED_SITES_SIGNING_SEED: RFC8032_TEST1_SEED }, "a published test vector"],
      [{ updaterSeed: SEED }, {}, "the updater key"],
      [{ tauriConfig: {} }, {}, "could not read the updater public key"],
      [{ tauriConfig: { plugins: { updater: { pubkey: 7 } } } }, {}, "could not read"],
      [{ tauriConfig: { plugins: { updater: { pubkey: "!!" } } } }, {}, "could not read"],
      [
        {
          tauriConfig: { plugins: { updater: { pubkey: Buffer.from(short).toString("base64") } } },
        },
        {},
        "could not read",
      ],
    ];
    for (const [options, env, why] of cases) {
      setup(options);
      const r = provision([], env);
      expect(r.code).toBe(1);
      expect(r.err).toStartWith(
        `provision: ${why.startsWith("could") ? "" : "the seed is "}${why}`,
      );
      expect(sets()).toEqual([]);
      rmSync(root, { recursive: true, force: true });
    }
  });
});

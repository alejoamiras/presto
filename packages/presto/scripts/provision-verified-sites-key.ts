/**
 * The keyed run that stores the verified-sites signing seed in the `verified-sites-signing`
 * environment. op-remote supplies `PRESTO_VERIFIED_SITES_SIGNING_SEED` (generated once, backed up in
 * 1Password) and `GH_TOKEN` (a fine-grained token limited to this repository's environments); the
 * template is `verified-sites/signing-key.env.example`.
 *
 *   bun --no-install --no-env-file --config=/dev/null packages/presto/scripts/provision-verified-sites-key.ts
 *     (no flag: first key, no secret and no key.pub; `--restore`: key.pub already holds this key;
 *     `--rotate`: key.pub holds a different key)
 *
 * The launch flags keep `.env` files and bunfig preloads out of a process that holds the seed;
 * `--config` needs the `=` form, since `--config /dev/null <script>` exits 0 without running it.
 * It prints the public-key document and key ID only. Neither the seed nor the token is ever printed,
 * passed in an argument or written to a file: the seed reaches `gh secret set` on standard input.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  deriveKey,
  keyId,
  keyIdHex,
  normalizeSeed,
  publicKeyDocument,
  SEED_ENV,
  SignerError,
} from "./verified-sites-signer.ts";

const REPO = "alejoamiras/presto";
const ENVIRONMENT = "verified-sites-signing";
const SECRET = "VERIFIED_SITES_SIGNING_SEED";
const OWNER = "alejoamiras";
const KEY_PUB = path.join(import.meta.dir, "..", "verified-sites", "key.pub");
const TAURI_CONFIG = path.join(import.meta.dir, "..", "src-tauri", "tauri.conf.json");
/** RFC 8032 §7.1 TEST 1 and TEST 2 public keys: published, so never a real signing key. */
const TEST_VECTOR_KEYS = [
  "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
  "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c",
];

class Refusal extends Error {}

/** Missing or malformed inputs exit 2, like the signer's invalid seed; every other refusal exits 1. */
class InputRefusal extends Refusal {}

type Mode = "first" | "restore" | "rotate";

interface Gh {
  token: string;
  /** An empty config directory, so no stored host, credential or alias can redirect a call. */
  configDir: string;
}

/** Runs `gh` against github.com with only the token; output is captured, never echoed. */
function gh(ctx: Gh, args: string[], stdin?: string): { ok: boolean; stdout: string } {
  const child = Bun.spawnSync(["gh", ...args], {
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      GH_CONFIG_DIR: ctx.configDir,
      GH_HOST: "github.com",
      GH_PROMPT_DISABLED: "1",
      GH_NO_UPDATE_NOTIFIER: "1",
      GH_TOKEN: ctx.token,
    },
    stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  return { ok: child.exitCode === 0, stdout: child.stdout.toString() };
}

function ghJson(ctx: Gh, args: string[], what: string): unknown {
  const result = gh(ctx, args);
  if (!result.ok) throw new Refusal(`could not read ${what}`);
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Refusal(`could not parse ${what}`);
  }
}

/**
 * The secret must never land somewhere weaker than a main-only environment that only the owner can
 * approve: GitHub accepts one approval from any listed reviewer, so he must be the only one.
 */
function checkEnvironment(ctx: Gh): void {
  const env = ghJson(
    ctx,
    ["api", `repos/${REPO}/environments/${ENVIRONMENT}`],
    "the environment",
  ) as {
    can_admins_bypass?: boolean;
    deployment_branch_policy?: { protected_branches?: boolean; custom_branch_policies?: boolean };
    protection_rules?: {
      type?: string;
      reviewers?: { type?: string; reviewer?: { login?: string } }[];
    }[];
  };
  const approvals = (env.protection_rules ?? []).filter((r) => r.type === "required_reviewers");
  const reviewers = approvals.flatMap((rule) => rule.reviewers ?? []);
  const only = reviewers[0];
  if (
    approvals.length !== 1 ||
    reviewers.length !== 1 ||
    only?.type !== "User" ||
    only.reviewer?.login !== OWNER
  ) {
    throw new Refusal(`${OWNER} is not the only required reviewer`);
  }
  if (env.can_admins_bypass !== false) throw new Refusal("administrators can bypass the reviewer");
  const policy = env.deployment_branch_policy;
  if (policy?.protected_branches !== false || policy.custom_branch_policies !== true) {
    throw new Refusal("the environment is not limited to selected branches");
  }
  const branches = ghJson(
    ctx,
    ["api", `repos/${REPO}/environments/${ENVIRONMENT}/deployment-branch-policies`],
    "the branch policies",
  ) as { branch_policies?: { name?: string; type?: string }[] };
  const rules = (branches.branch_policies ?? []).map((b) => `${b.type}:${b.name}`);
  if (rules.length !== 1 || rules[0] !== "branch:main") {
    throw new Refusal("the environment does not allow exactly the main branch");
  }
}

function secretNames(ctx: Gh): string[] {
  const listed = ghJson(
    ctx,
    ["secret", "list", "--env", ENVIRONMENT, "--repo", REPO, "--json", "name"],
    "the environment's secrets",
  ) as { name?: string }[];
  return listed.map((s) => s.name ?? "");
}

/** The updater's raw Ed25519 key; anything but a well-formed minisign key refuses the run. */
function updaterPublicKey(): string {
  const config = JSON.parse(readFileSync(TAURI_CONFIG, "utf8")) as {
    plugins?: { updater?: { pubkey?: unknown } };
  };
  const encoded = config.plugins?.updater?.pubkey;
  const lines =
    typeof encoded === "string" ? Buffer.from(encoded, "base64").toString("utf8").split("\n") : [];
  const raw = Buffer.from(lines[1] ?? "", "base64");
  if (raw.length !== 42 || raw.subarray(0, 2).toString("latin1") !== "Ed") {
    throw new Refusal("could not read the updater public key");
  }
  return raw.subarray(10).toString("hex");
}

function checkMode(mode: Mode, derived: string, secretExists: boolean): void {
  const pinned = existsSync(KEY_PUB) ? readFileSync(KEY_PUB, "utf8") : undefined;
  if (mode === "first" && (pinned !== undefined || secretExists)) {
    throw new Refusal("a key already exists: use --restore or --rotate");
  }
  if (mode === "restore" && pinned !== derived) {
    throw new Refusal("--restore needs key.pub to hold this seed's key");
  }
  if (mode === "rotate" && (pinned === undefined || pinned === derived)) {
    throw new Refusal("--rotate needs key.pub to hold a different key");
  }
}

function readMode(args: string[]): Mode {
  if (args.length === 0) return "first";
  if (args.length === 1 && args[0] === "--restore") return "restore";
  if (args.length === 1 && args[0] === "--rotate") return "rotate";
  throw new InputRefusal("usage: provision-verified-sites-key.ts [--restore | --rotate]");
}

function provision(args: string[], seedValue: string | undefined, token: string | undefined): void {
  const mode = readMode(args);
  const seed = normalizeSeed(seedValue);
  if (token === undefined || token.length < 8 || /\s/.test(token)) {
    throw new InputRefusal("GH_TOKEN is missing: the template imports the provisioning token");
  }
  const ctx: Gh = { token, configDir: mkdtempSync(path.join(tmpdir(), "presto-provision-gh-")) };
  try {
    store(mode, seed, ctx);
  } finally {
    rmSync(ctx.configDir, { recursive: true, force: true });
  }
}

function store(mode: Mode, seed: Uint8Array, ctx: Gh): void {
  checkEnvironment(ctx);
  const key = deriveKey(seed);
  const publicHex = Buffer.from(key.publicKey).toString("hex");
  if (TEST_VECTOR_KEYS.includes(publicHex))
    throw new Refusal("the seed is a published test vector");
  if (publicHex === updaterPublicKey()) throw new Refusal("the seed is the updater key");
  const document = publicKeyDocument(key.publicKey);
  checkMode(mode, document, secretNames(ctx).includes(SECRET));
  const hex = Buffer.from(seed).toString("hex");
  const set = gh(ctx, ["secret", "set", SECRET, "--env", ENVIRONMENT, "--repo", REPO], hex);
  if (!set.ok) throw new Refusal("gh secret set failed");
  if (!secretNames(ctx).includes(SECRET))
    throw new Refusal("the secret is not listed after setting it");
  process.stdout.write(document);
  console.log(`Key ID: ${keyIdHex(keyId(key.publicKey))}`);
}

if (import.meta.main) {
  const seed = process.env[SEED_ENV];
  const token = process.env.GH_TOKEN;
  delete process.env[SEED_ENV];
  delete process.env.GH_TOKEN;
  try {
    provision(process.argv.slice(2), seed, token);
  } catch (error) {
    // Only this file's and the signer's fixed messages: an exception from elsewhere could carry input.
    const known = error instanceof Refusal || error instanceof SignerError;
    console.error(`provision: ${known ? error.message : "unexpected failure"}`);
    process.exit(error instanceof InputRefusal || error instanceof SignerError ? 2 : 1);
  }
}

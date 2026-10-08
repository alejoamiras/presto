/**
 * The keyed run that stores the verified-sites signing seed in the `verified-sites-signing`
 * environment. op-remote supplies `PRESTO_VERIFIED_SITES_SIGNING_SEED` (generated once, backed up in
 * 1Password) and `GH_TOKEN` (a fine-grained token limited to this repository's environments); the
 * template is `verified-sites/signing-key.env.example`.
 *
 *   bun packages/presto/scripts/provision-verified-sites-key.ts            first key: no secret, no key.pub
 *   bun packages/presto/scripts/provision-verified-sites-key.ts --restore  key.pub already holds this key
 *   bun packages/presto/scripts/provision-verified-sites-key.ts --rotate   key.pub holds a different key
 *
 * It prints the public-key document and key ID only. Neither the seed nor the token is ever printed,
 * passed in an argument or written to a file: the seed reaches `gh secret set` on standard input.
 */
import { existsSync, readFileSync } from "node:fs";
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

/** Runs `gh` with only PATH, HOME and the token; output is captured, never echoed. */
function gh(token: string, args: string[], stdin?: string): { ok: boolean; stdout: string } {
  const child = Bun.spawnSync(["gh", ...args], {
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", GH_TOKEN: token },
    stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  return { ok: child.exitCode === 0, stdout: child.stdout.toString() };
}

function ghJson(token: string, args: string[], what: string): unknown {
  const result = gh(token, args);
  if (!result.ok) throw new Refusal(`could not read ${what}`);
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Refusal(`could not parse ${what}`);
  }
}

/** The secret must never land somewhere weaker than a main-only environment the owner approves. */
function checkEnvironment(token: string): void {
  const env = ghJson(
    token,
    ["api", `repos/${REPO}/environments/${ENVIRONMENT}`],
    "the environment",
  ) as {
    can_admins_bypass?: boolean;
    deployment_branch_policy?: { protected_branches?: boolean; custom_branch_policies?: boolean };
    protection_rules?: { type?: string; reviewers?: { reviewer?: { login?: string } }[] }[];
  };
  const reviewers = (env.protection_rules ?? [])
    .filter((rule) => rule.type === "required_reviewers")
    .flatMap((rule) => rule.reviewers ?? [])
    .map((r) => r.reviewer?.login);
  if (!reviewers.includes(OWNER)) throw new Refusal(`${OWNER} is not a required reviewer`);
  if (env.can_admins_bypass !== false) throw new Refusal("administrators can bypass the reviewer");
  const policy = env.deployment_branch_policy;
  if (policy?.protected_branches !== false || policy.custom_branch_policies !== true) {
    throw new Refusal("the environment is not limited to selected branches");
  }
  const branches = ghJson(
    token,
    ["api", `repos/${REPO}/environments/${ENVIRONMENT}/deployment-branch-policies`],
    "the branch policies",
  ) as { branch_policies?: { name?: string; type?: string }[] };
  const rules = (branches.branch_policies ?? []).map((b) => `${b.type}:${b.name}`);
  if (rules.length !== 1 || rules[0] !== "branch:main") {
    throw new Refusal("the environment does not allow exactly the main branch");
  }
}

function secretNames(token: string): string[] {
  const listed = ghJson(
    token,
    ["secret", "list", "--env", ENVIRONMENT, "--repo", REPO, "--json", "name"],
    "the environment's secrets",
  ) as { name?: string }[];
  return listed.map((s) => s.name ?? "");
}

function updaterPublicKey(): string {
  const config = JSON.parse(readFileSync(TAURI_CONFIG, "utf8")) as {
    plugins?: { updater?: { pubkey?: string } };
  };
  const document = Buffer.from(config.plugins?.updater?.pubkey ?? "", "base64").toString("utf8");
  const raw = Buffer.from(document.split("\n")[1] ?? "", "base64");
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
  checkEnvironment(token);
  const key = deriveKey(seed);
  const publicHex = Buffer.from(key.publicKey).toString("hex");
  if (TEST_VECTOR_KEYS.includes(publicHex))
    throw new Refusal("the seed is a published test vector");
  if (publicHex === updaterPublicKey()) throw new Refusal("the seed is the updater key");
  const document = publicKeyDocument(key.publicKey);
  checkMode(mode, document, secretNames(token).includes(SECRET));
  const hex = Buffer.from(seed).toString("hex");
  const set = gh(token, ["secret", "set", SECRET, "--env", ENVIRONMENT, "--repo", REPO], hex);
  if (!set.ok) throw new Refusal("gh secret set failed");
  if (!secretNames(token).includes(SECRET))
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

/**
 * Runtime-neutral checks for `POST /prove/ultra-honk`: load the committed Noir fixtures, build the
 * request, compare the response against the bb.js WASM references, and verify with a native bb.
 * Imported by the Bun smoke entrypoint and by the Node-run WebDriver spec, so nothing here may touch
 * a Bun API.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const FIXTURE_NAMES = ["square", "nopub"] as const;

export interface Fixture {
  name: string;
  bytecode: string;
  witness: Uint8Array;
  vk: Uint8Array;
  proof: Uint8Array;
  publicInputs: Uint8Array;
  verifierTarget: string;
}

export interface ProveResponse {
  proof: string;
  public_inputs: string;
  vk?: string;
}

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const unb64 = (text: string) => new Uint8Array(Buffer.from(text, "base64"));

export function loadFixture(root: string, name: string): Fixture {
  const dir = join(root, "fixtures", "noir", name);
  const read = (file: string) => new Uint8Array(readFileSync(join(dir, file)));
  const artifact = JSON.parse(readFileSync(join(dir, "circuit.json"), "utf8"));
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  return {
    name,
    bytecode: artifact.bytecode,
    witness: read("witness.gz"),
    vk: read("vk"),
    proof: read("proof"),
    publicInputs: read("public_inputs"),
    verifierTarget: manifest.verifierTarget,
  };
}

/** The wire body: the artifact's bytecode string verbatim, everything else base64. */
export function buildJob(fixture: Fixture, withVk: boolean): Record<string, string> {
  const job: Record<string, string> = {
    bytecode: fixture.bytecode,
    witness: b64(fixture.witness),
    verifier_target: fixture.verifierTarget,
  };
  if (withVk) job.vk = b64(fixture.vk);
  return job;
}

function same(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Every way the response differs from the WASM reference, or an empty list. */
export function checkOutputs(
  response: ProveResponse,
  fixture: Fixture,
  expectVk: boolean,
): string[] {
  const problems: string[] = [];
  if (!same(unb64(response.proof), fixture.proof))
    problems.push("proof differs from the WASM reference");
  if (!same(unb64(response.public_inputs), fixture.publicInputs)) {
    problems.push("public inputs differ from the WASM reference");
  }
  if (expectVk) {
    if (response.vk === undefined) problems.push("server did not return the key it computed");
    else if (!same(unb64(response.vk), fixture.vk))
      problems.push("computed vk differs from the WASM key");
  } else if (response.vk !== undefined) {
    problems.push("server echoed a client-supplied key");
  }
  return problems;
}

/** `bb verify` exits 1 for an invalid proof and for a failure alike; success is the only signal. */
export function verifyNatively(
  bb: string,
  proof: Uint8Array,
  publicInputs: Uint8Array,
  vk: Uint8Array,
  target: string,
): boolean {
  const dir = mkdtempSync(join(tmpdir(), "ultra-honk-smoke-"));
  try {
    writeFileSync(join(dir, "proof"), proof);
    writeFileSync(join(dir, "public_inputs"), publicInputs);
    writeFileSync(join(dir, "vk"), vk);
    const result = spawnSync(
      bb,
      [
        "verify",
        "--scheme",
        "ultra_honk",
        "-p",
        join(dir, "proof"),
        "-i",
        join(dir, "public_inputs"),
        "-k",
        join(dir, "vk"),
        "-t",
        target,
      ],
      { stdio: "ignore" },
    );
    return result.status === 0;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function postJob(baseUrl: string, job: Record<string, string>): Promise<ProveResponse> {
  const response = await fetch(`${baseUrl}/prove/ultra-honk`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(job),
    redirect: "error",
  });
  if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
  return (await response.json()) as ProveResponse;
}

export async function smoke(root: string, baseUrl: string, bb: string): Promise<string[]> {
  const problems: string[] = [];
  for (const name of FIXTURE_NAMES) {
    const fixture = loadFixture(root, name);
    for (const withVk of [true, false]) {
      const label = `${name}${withVk ? " (client vk)" : " (--write_vk)"}`;
      const response = await postJob(baseUrl, buildJob(fixture, withVk));
      const issues = checkOutputs(response, fixture, !withVk);
      const proof = unb64(response.proof);
      if (
        !verifyNatively(
          bb,
          proof,
          unb64(response.public_inputs),
          fixture.vk,
          fixture.verifierTarget,
        )
      ) {
        issues.push("native bb verify failed");
      }
      if (issues.length === 0) console.log(`${label}: ok (${proof.length / 32} fields)`);
      problems.push(...issues.map((i) => `${label}: ${i}`));
    }
  }
  return problems;
}

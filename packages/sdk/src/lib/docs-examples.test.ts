import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BBLazyPrivateKernelProver } from "@aztec/bb-prover/client/lazy";
import { WASMSimulator } from "@aztec/simulator/client";
import * as stdlibKernel from "@aztec/stdlib/kernel";
import { askBeforeConnecting } from "../../examples/consent.js";
import { PrestoProver } from "./presto-prover.js";

// The integration docs quote examples/consent.ts verbatim; this suite runs it. The lint below keeps
// every other copy-pasteable example from reaching Presto before the visitor connects.

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const fakeStep = {
  functionName: "f",
  witness: new Map(),
  bytecode: new Uint8Array(),
  vk: new Uint8Array(),
  timings: {},
} as any;

type Listener = () => void;

/** A browser whose loopback decision the test flips; `observable: false` models one without change events. */
const permission = { state: "prompt" as string, observable: true };
const listeners = new Set<Listener>();
let permissionsDescriptor: PropertyDescriptor | undefined;

function setPermission(state: string) {
  permission.state = state;
  for (const l of listeners) l();
}

function stubPermissions() {
  permissionsDescriptor = Object.getOwnPropertyDescriptor(navigator, "permissions");
  listeners.clear();
  permission.state = "prompt";
  permission.observable = true;
  Object.defineProperty(navigator, "permissions", {
    configurable: true,
    value: {
      query: async () => ({
        get state() {
          return permission.state;
        },
        ...(permission.observable && {
          addEventListener: (_: string, l: Listener) => listeners.add(l),
          removeEventListener: (_: string, l: Listener) => listeners.delete(l),
        }),
      }),
    },
  });
}

function restorePermissions() {
  if (permissionsDescriptor) Object.defineProperty(navigator, "permissions", permissionsDescriptor);
  else delete (navigator as { permissions?: unknown }).permissions;
}

describe("examples/consent.ts, executed", () => {
  let originalFetch: typeof globalThis.fetch;
  let fetched: string[];

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    stubPermissions();
    fetched = [];
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      fetched.push(new URL(url).pathname);
      if (url.includes("/health")) return Response.json({ status: "ok", api_version: 1 });
      return new Response("busy", { status: 503 });
    }) as typeof fetch;
    spyOn(stdlibKernel, "serializePrivateExecutionSteps").mockReturnValue(Buffer.from([1]));
    spyOn(BBLazyPrivateKernelProver.prototype, "createChonkProof").mockRejectedValue(
      new Error("wasm"),
    );
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    restorePermissions();
    mock.restore();
  });

  const setup = async () => {
    const prover = new PrestoProver({ simulator: new WASMSimulator() });
    const statuses: unknown[] = [];
    const presto = await askBeforeConnecting(prover, (s) => statuses.push(s));
    const prove = () => prover.createChonkProof([fakeStep]).catch(() => undefined);
    return { presto, statuses, prove };
  };

  test("before consent nothing reaches Presto, status checks and proofs alike", async () => {
    for (const state of ["prompt", "denied", "unsupported"]) {
      permission.state = state;
      const { statuses, prove } = await setup();
      await prove();
      expect(statuses).toEqual([]);
    }
    delete (navigator as { permissions?: unknown }).permissions;
    const { prove } = await setup();
    await prove();
    expect(fetched).toEqual([]);
  });

  test("connect() checks from the click, then proofs go to Presto; a block sends nothing", async () => {
    const { presto, statuses, prove } = await setup();
    await presto.connect();
    expect(fetched.some((p) => p === "/health")).toBe(true);
    expect(statuses[0]).toMatchObject({ available: true });
    await prove();
    expect(fetched).toContain("/prove");

    fetched.length = 0;
    permission.state = "denied";
    const blocked = await setup();
    await blocked.presto.connect();
    expect(blocked.statuses).toEqual(["blocked"]);
    expect(fetched).toEqual([]);
  });

  test("a returning visitor who allowed it connects with no click", async () => {
    permission.state = "granted";
    const { statuses } = await setup();
    expect(fetched).toContain("/health");
    expect(statuses[0]).toMatchObject({ available: true });
  });

  test("a reset forces proofs local again, reported or not", async () => {
    permission.state = "granted";
    const watched = await setup();
    setPermission("prompt");
    fetched.length = 0;
    await watched.prove();
    expect(fetched).toEqual([]);

    permission.observable = false;
    permission.state = "granted";
    const silent = await setup();
    permission.state = "prompt"; // no change event in this browser
    await silent.presto.beforeProving();
    fetched.length = 0;
    await silent.prove();
    expect(fetched).toEqual([]);
  });
});

/** Fenced TypeScript/JavaScript blocks, plus the scripts inside HTML blocks. */
function codeBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  for (const [, lang, body] of markdown.matchAll(/```(\w*)\n([\s\S]*?)```/g)) {
    if (/^(ts|typescript|js|javascript)$/.test(lang ?? "")) blocks.push(body ?? "");
    if (lang === "html") {
      for (const [, script] of (body ?? "").matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) {
        blocks.push(script ?? "");
      }
    }
  }
  return blocks;
}

const DOCS = [
  "../../../../README.md",
  "../../README.md",
  "../../../sdk-noir/README.md",
  "../../.claude/skills/presto/SKILL.md",
  "../../../banners/README.md",
];
const PROVES = /\.(generateProof|createChonkProof)\(|EmbeddedWallet\.create\(|getSchnorrAccount\(/;
const CONSTRUCTS = /new (PrestoProver|PrestoUltraHonkBackend)\(/g;
const MARKER = "// after the user connects";

/** Why a block could reach Presto before consent, or null when it cannot. */
function violation(block: string): string | null {
  if (block.includes("export async function askBeforeConnecting")) return null;
  if (block.includes("checkPrestoStatus(") && !block.includes(MARKER)) {
    return `checkPrestoStatus() without "${MARKER}"`;
  }
  const proves = block.search(PROVES);
  if (proves === -1) return null;
  const constructed = [...block.matchAll(CONSTRUCTS)];
  if (constructed.length === 0) return block.includes(MARKER) ? null : `proves without "${MARKER}"`;
  if (constructed.length > 1) return "constructs more than one Presto instance";
  const name =
    /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?new (?:PrestoProver|PrestoUltraHonkBackend)\(/.exec(
      block,
    )?.[1];
  if (!name) return "constructs a Presto instance inline instead of in one variable";
  const gate = block.indexOf(`${name}.setForceLocal(true)`);
  if (gate === -1 || gate > proves)
    return `${name}.setForceLocal(true) must come before the first proof`;
  return null;
}

describe("integration docs", () => {
  test("the README and the skill quote examples/consent.ts verbatim", () => {
    const source = read("../../examples/consent.ts").trim();
    expect(read("../../README.md")).toContain(source);
    expect(read("../../.claude/skills/presto/SKILL.md")).toContain(source);
  });

  test("no example reaches Presto before the visitor connects", () => {
    const failures = DOCS.flatMap((doc) =>
      codeBlocks(read(doc)).flatMap((block) => {
        const why = violation(block);
        return why ? [`${doc}: ${why}\n${block.trim().split("\n").slice(0, 3).join("\n")}`] : [];
      }),
    );
    expect(failures).toEqual([]);
  });
});

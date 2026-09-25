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
let held: { started: () => void; released: Promise<void> } | null = null;

/** Holds every permission read started from now until `release()`; each keeps the decision it saw. */
function holdReads() {
  let started!: () => void;
  let release!: () => void;
  const readStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  held = { started, released: new Promise<void>((resolve) => (release = resolve)) };
  return {
    readStarted,
    release: () => {
      held = null;
      release();
    },
  };
}

function setPermission(state: string) {
  permission.state = state;
  for (const l of listeners) l();
}

function stubPermissions() {
  permissionsDescriptor = Object.getOwnPropertyDescriptor(navigator, "permissions");
  listeners.clear();
  held = null;
  permission.state = "prompt";
  permission.observable = true;
  Object.defineProperty(navigator, "permissions", {
    configurable: true,
    value: {
      query: async () => {
        if (held) {
          const seen = permission.state;
          const { started, released } = held;
          started();
          await released;
          return { state: seen };
        }
        return {
          get state() {
            return permission.state;
          },
          ...(permission.observable && {
            addEventListener: (_: string, l: Listener) => listeners.add(l),
            removeEventListener: (_: string, l: Listener) => listeners.delete(l),
          }),
        };
      },
    },
  });
}

function restorePermissions() {
  if (permissionsDescriptor) Object.defineProperty(navigator, "permissions", permissionsDescriptor);
  else delete (navigator as { permissions?: unknown }).permissions;
}

let fetched: string[] = [];
/** Runs while `/health` is in flight: the moment a real browser shows its prompt. */
let duringHealth: () => void = () => {};
const originalFetch = globalThis.fetch;

function stubFetch() {
  fetched = [];
  duringHealth = () => {};
  globalThis.fetch = mock(async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    fetched.push(new URL(url).pathname);
    if (!url.includes("/health")) return new Response("busy", { status: 503 });
    duringHealth();
    return Response.json({ status: "ok", api_version: 1 });
  }) as typeof fetch;
}

const newProver = () => new PrestoProver({ simulator: new WASMSimulator() });

/** Every proof here ends in the WASM stub's rejection, native attempt or not; anything else fails. */
async function proveWith(prover: PrestoProver) {
  const wasm = BBLazyPrivateKernelProver.prototype.createChonkProof as ReturnType<typeof spyOn>;
  const calls = wasm.mock.calls.length;
  await expect(prover.createChonkProof([fakeStep])).rejects.toThrow("wasm");
  expect(wasm.mock.calls.length).toBe(calls + 1);
}

async function setup() {
  const prover = newProver();
  const views: unknown[] = [];
  const presto = await askBeforeConnecting(prover, (view) => views.push(view));
  return { presto, views, prove: () => proveWith(prover) };
}

function useStubs() {
  beforeEach(() => {
    stubPermissions();
    stubFetch();
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
}

describe("examples/consent.ts, executed", () => {
  useStubs();

  test("before consent nothing reaches Presto, status checks and proofs alike", async () => {
    for (const [state, view] of [
      ["prompt", "ask"],
      ["denied", "blocked"],
      ["unsupported", "ask"],
    ] as const) {
      permission.state = state;
      const { views, prove } = await setup();
      await prove();
      expect(views).toEqual([view]);
    }
    delete (navigator as { permissions?: unknown }).permissions;
    await (await setup()).prove();
    expect(fetched).toEqual([]);
  });

  test("connect() checks from the click, then proofs go to Presto; a block sends nothing", async () => {
    const { presto, views, prove } = await setup();
    await presto.connect();
    expect(fetched).toContain("/health");
    expect(views.at(-1)).toMatchObject({ available: true });
    await prove();
    expect(fetched).toContain("/prove");

    fetched.length = 0;
    permission.state = "denied";
    const blocked = await setup();
    await blocked.presto.connect();
    expect(blocked.views.at(-1)).toBe("blocked");
    expect(fetched).toEqual([]);
  });

  test("a returning visitor who allowed it connects with no click", async () => {
    permission.state = "granted";
    const { views } = await setup();
    expect(fetched).toContain("/health");
    expect(views.at(-1)).toMatchObject({ available: true });
  });

  test("a reset forces proofs local, reported or not; a later grant or click restores Presto", async () => {
    permission.state = "granted";
    const watched = await setup();
    setPermission("prompt");
    fetched.length = 0;
    await watched.prove();
    expect(fetched).toEqual([]);
    expect(watched.views.at(-1)).toBe("ask");

    // No change events: the grant made at the prompt is only visible to a later read.
    permission.observable = false;
    permission.state = "prompt";
    const silent = await setup();
    duringHealth = () => {
      permission.state = "granted";
    };
    await silent.presto.connect();
    duringHealth = () => {};
    permission.state = "prompt";
    await silent.presto.beforeProving();
    fetched.length = 0;
    await silent.prove();
    expect(fetched).toEqual([]);

    permission.state = "granted"; // allowed again in site settings
    await silent.presto.beforeProving();
    await silent.prove();
    expect(fetched).toContain("/prove");

    permission.state = "prompt"; // reset again; the visitor clicks Connect and never answers
    await silent.presto.beforeProving();
    await silent.presto.connect();
    await silent.presto.beforeProving();
    expect(permission.state).toBe("prompt");
    fetched.length = 0;
    await silent.prove();
    expect(fetched).toContain("/prove");
  });
});

describe("examples/consent.ts, races", () => {
  useStubs();

  test("a block during a check hides its result and says so", async () => {
    const { presto, views } = await setup();
    duringHealth = () => setPermission("denied");
    await presto.connect();
    expect(views.some((view) => typeof view === "object")).toBe(false);
    expect(views.at(-1)).toBe("blocked");
  });

  test("proofs stay local while the module is still reading the decision", async () => {
    permission.state = "granted";
    const reads = holdReads();
    const prover = newProver();
    const ready = askBeforeConnecting(prover, () => {});
    await reads.readStarted;
    await proveWith(prover);
    expect(fetched).toEqual([]);
    reads.release();
    await ready;
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
  "../../../sdk-core/README.md",
];
const PROVES =
  /\.(generateProof|createChonkProof|prove)\(|EmbeddedWallet\.create\(|getSchnorrAccount\(/;
const CONSTRUCTS = /new (PrestoProver|PrestoUltraHonkBackend)\(/g;
/** `checkPrestoStatus()` (SDK) and `checkStatus()` (core) send whatever force-local says. */
const CHECKS = /\.check(Presto)?Status\(/;
const MARKER = "// after the user connects";

/** Why a block could reach Presto before consent, or null when it cannot. */
function violation(block: string): string | null {
  if (block.includes("export async function askBeforeConnecting")) return null;
  if (CHECKS.test(block) && !block.includes(MARKER)) return `status check without "${MARKER}"`;
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

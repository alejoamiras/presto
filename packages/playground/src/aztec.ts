import {
  type PrestoPhase,
  type PrestoPhaseData,
  PrestoProver,
  type PrestoStatus,
  type PrestoStatusCheckOptions,
} from "@alejoamiras/presto";
import { NO_FROM } from "@aztec/aztec.js/account";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { NO_WAIT } from "@aztec/aztec.js/contracts";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee";
import { Fq, Fr } from "@aztec/aztec.js/fields";
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import type { TxHash } from "@aztec/aztec.js/tx";
import type { Wallet } from "@aztec/aztec.js/wallet";
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC";
import { getContractInstanceFromInstantiationParams } from "@aztec/stdlib/contract";
import { EmbeddedWallet } from "@aztec/wallets/embedded";
// Deep-path import: the standards package ships no `exports` map / `main`, and
// moduleResolution "Bundler" + vite both resolve package-internal paths directly
// (same pattern the noir-contracts artifacts use internally).
import { TokenContract } from "@aztec-foundation/aztec-standards/dist/src/artifacts/Token.js";

export type LogFn = (
  msg: string,
  level?: "info" | "warn" | "error" | "success",
  url?: string,
) => void;

/** Extract a human-readable message from an unknown error value. */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export type UiMode = "local" | "accelerated";

const AZTEC_NODE_URL = process.env.AZTEC_NODE_URL || "/aztec";

/** Display-friendly Aztec node URL for the services panel (reads env set by Vite define). */
export const AZTEC_DISPLAY_URL = process.env.AZTEC_NODE_URL || "localhost:8080";

// ── Retry & timeout constants ──
const MAX_INIT_ATTEMPTS = 3;
const MAX_SEND_ATTEMPTS = 3;
const TX_TIMEOUT_MS = 10 * 60 * 1_000; // 10 minutes
const TX_POLL_INTERVAL_MS = 1_000;
const BLOCK_HEADER_NOT_FOUND = "Block header not found";
/** Retry stale block headers only in E2E tests — not safe in production
 *  because re-simulating may pick up different contract state. */
const RETRY_STALE_HEADER = !!process.env.E2E_RETRY_STALE_HEADER;

/** @aztec/stdlib version from SDK package.json, embedded at build time */
export const AZTEC_SDK_VERSION = process.env.VITE_AZTEC_SDK_VERSION || "unknown";

export interface AztecState {
  node: ReturnType<typeof createAztecNodeClient> | null;
  prover: PrestoProver | null;
  wallet: Wallet | null;
  embeddedWallet: EmbeddedWallet | null;
  registeredAddresses: AztecAddress[];
  /**
   * Accounts DEPLOYED in this session (vs imported). Only these can act as tx senders:
   * the wallet is ephemeral, and an imported account's contract notes (created long ago
   * by another PXE — e.g. the sandbox's genesis test accounts) are never discovered here,
   * so its entrypoint fails in-circuit with "Failed to get a note".
   */
  sessionAddresses: AztecAddress[];
  uiMode: UiMode;
  /** True when the network requires real proofs (not simulated). */
  proofsRequired: boolean;
  feePaymentMethod: SponsoredFeePaymentMethod | undefined;
}

/**
 * Global mutable application state. Concurrent mutations are prevented at
 * the UI layer via the `deploying` flag in main.ts, which disables action
 * buttons while an async operation is in flight.
 */
export const state: AztecState = {
  node: null,
  prover: null,
  wallet: null,
  embeddedWallet: null,
  registeredAddresses: [],
  sessionAddresses: [],
  uiMode: "accelerated",
  proofsRequired: false,
  feePaymentMethod: undefined,
};

/** Pick the tx sender: the first session-deployed account (imported accounts can't sign here). */
function pickSessionSender(): AztecAddress {
  const sender = state.sessionAddresses[0];
  if (!sender) {
    throw new Error(
      "Deploy a test account first — imported accounts (e.g. sandbox test accounts) can't send from this session's wallet",
    );
  }
  return sender;
}

/**
 * One lazy prover for the whole page. Startup detection creates it first; wallet initialization,
 * Retry, and every proof then reuse the same status cache, protocol pin, generation, and HTTPS
 * history.
 */
export function getPrestoProver(): PrestoProver {
  if (!state.prover) {
    // Browser SDK instances are HTTPS-only by default. This explicit flag remains solely as a
    // packaged-E2E assertion knob; there is intentionally no `httpsOnly=false` URL switch.
    const httpsOnly = new URLSearchParams(window.location.search).get("httpsOnly") === "true";
    state.prover = httpsOnly
      ? new PrestoProver({ presto: { httpsOnly: true, allowInsecureDowngrade: false } })
      : new PrestoProver();
    state.prover.setForceLocal(state.uiMode === "local");
  }
  return state.prover;
}

/**
 * Deliberately allow plaintext proving for this page's in-memory prover instance. The caller owns
 * the warning/confirmation UI. Nothing is written to storage, the URL, or desktop configuration.
 */
export function enableInsecureHttpForSession(): void {
  getPrestoProver().setPrestoConfig({
    httpsOnly: false,
    allowInsecureDowngrade: true,
  });
}

export function checkPrestoStatus(options?: PrestoStatusCheckOptions): Promise<PrestoStatus> {
  return getPrestoProver().checkPrestoStatus(options);
}

export async function checkAztecNode(): Promise<{ reachable: boolean; nodeVersion?: string }> {
  // Probe via JSON-RPC: 5.0.0 nodes reject a plain GET /status with 405, so the
  // node_getNodeInfo POST (which we needed for the version anyway) is the health check.
  try {
    const rpc = await fetch(AZTEC_NODE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "node_getNodeInfo", params: [], id: 1 }),
      signal: AbortSignal.timeout(5000),
    });
    if (!rpc.ok) return { reachable: false };
    const data = await rpc.json();
    return { reachable: true, nodeVersion: data.result?.nodeVersion };
  } catch {
    return { reachable: false };
  }
}

// Legacy cleanup: pre-5.0 wallets persisted PXE/wallet state in IndexedDB. The 5.0 wallet is
// ephemeral (in-memory, see doInitializeWallet), so this only evicts residue left by earlier
// visits — it is NOT the recovery path for current wallet state.
async function clearIndexedDB(): Promise<void> {
  const dbs = await indexedDB.databases();
  const aztecPrefixes = ["pxe-", "pxe_data_", "wallet-", "wallet_data_", "aztec-"];
  await Promise.all(
    dbs
      .filter((db) => db.name && aztecPrefixes.some((prefix) => db.name!.startsWith(prefix)))
      .map(
        (db) =>
          new Promise<void>((resolve, reject) => {
            const req = indexedDB.deleteDatabase(db.name!);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
            req.onblocked = () => resolve(); // best-effort: proceed even if blocked
          }),
      ),
  );
}

/**
 * bb.js caches the CRS in IndexedDB (idb-keyval's `keyval-store`) under keys (`g1Data`/`g2Data`)
 * that are NOT version-suffixed. Across an `@aztec/bb.js` bump the on-disk CRS format can change,
 * but those keys aren't busted — so a returning visitor's stale blob (wrong bytes-per-point) gets
 * fed to `SrsInitSrs` → "invalid points_buf size … got 128". Clear the CRS store once per bb
 * version so a fresh, correctly-formatted CRS is downloaded. Only the bb.js CRS lives in
 * `keyval-store`; current wallet/PXE state is in-memory (ephemeral) — the prefixed-DB clear
 * above only evicts pre-5.0 residue. Bump CRS_CACHE_VERSION whenever `@aztec/bb.js` changes
 * the CRS format.
 */
const CRS_CACHE_VERSION = "5.2.0";
async function bustStaleCrsCacheOnce(log: LogFn): Promise<void> {
  if (typeof indexedDB === "undefined" || typeof localStorage === "undefined") return;
  const KEY = "bb-crs-cache-version";
  try {
    if (localStorage.getItem(KEY) === CRS_CACHE_VERSION) return;
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase("keyval-store");
      req.onsuccess = () => resolve();
      req.onerror = () => resolve(); // best-effort — a fresh CRS download will overwrite anyway
      req.onblocked = () => resolve();
    });
    localStorage.setItem(KEY, CRS_CACHE_VERSION);
    log("Reset bb.js CRS cache (prover version changed)", "info");
  } catch {
    // non-fatal: worst case the user clears site data manually
  }
}

/**
 * Connect to the Aztec node and set up the PrestoProver.
 * Shared by both embedded and external wallet paths.
 */
export async function initializeNode(log: LogFn): Promise<void> {
  // B4 packaged-E2E harness: `?httpsOnly=true` explicitly pins the browser-safe default so a green
  // proof against the installed desktop app positively exercises the seeded TLS trust path. There is
  // intentionally no URL-controlled opt-out; HTTP consent exists only in the in-memory recovery UI.
  const httpsOnly = new URLSearchParams(window.location.search).get("httpsOnly") === "true";
  log(
    httpsOnly ? "Creating PrestoProver (HTTPS-only, packaged-E2E)..." : "Creating PrestoProver...",
  );
  state.prover = getPrestoProver();

  log("Connecting to Aztec node...");
  state.node = createAztecNodeClient(AZTEC_NODE_URL);
  const nodeInfo = await state.node.getNodeInfo();

  state.proofsRequired = nodeInfo.l1ChainId !== 31337;

  // Allow forcing proofs via ?forceProofs=true for testing IVC locally
  const forceProofs = new URLSearchParams(window.location.search).get("forceProofs") === "true";
  if (forceProofs && !state.proofsRequired) {
    state.proofsRequired = true;
    log("Forced proverEnabled=true via ?forceProofs query param", "warn");
  }

  log(
    `Connected — chain ${nodeInfo.l1ChainId} (proofs ${state.proofsRequired ? "required" : "simulated"})`,
    "success",
  );
}

/**
 * Derive the canonical Sponsored FPC address and register it in the PXE.
 * Shared by both embedded and external wallet paths.
 *
 * Always uses salt=0 — the canonical SponsoredFPC, deployed + funded on every
 * network we target (local sandbox auto-deploys it; testnet has it).
 */
export async function initializeFPC(wallet: Wallet, log: LogFn): Promise<void> {
  log("Setting up Sponsored FPC...");
  const fpcInstance = await getContractInstanceFromInstantiationParams(
    SponsoredFPCContract.artifact,
    { salt: new Fr(0) },
  );
  await wallet.registerContract(fpcInstance, SponsoredFPCContract.artifact);
  state.feePaymentMethod = new SponsoredFeePaymentMethod(fpcInstance.address);
  log("Sponsored FPC registered", "success");
}

async function doInitializeWallet(log: LogFn): Promise<boolean> {
  // Fresh wallet instance → any previously-tracked addresses belong to a dead ephemeral
  // store and must not survive a retry (their notes are gone with the old store).
  state.registeredAddresses = [];
  state.sessionAddresses = [];

  await initializeNode(log);

  log("Creating wallet (may take a moment)...");
  // ephemeral: the playground creates throwaway accounts per session, so persistence buys
  // nothing — and 5.0's persistent browser store (SQLite-OPFS) holds an origin-wide exclusive
  // lock (second tab fails to init) that in-memory stores sidestep entirely.
  state.embeddedWallet = await EmbeddedWallet.create(state.node!, {
    ephemeral: true,
    pxe: {
      proverEnabled: state.proofsRequired,
      proverOrOptions: state.prover!,
      dataStoreMapSizeKb: 2e10,
    },
  });
  state.wallet = state.embeddedWallet;
  log("Wallet created", "success");

  await initializeFPC(state.wallet!, log);

  // NOTE: sandbox genesis test accounts are deliberately NOT registered anymore — since only
  // session-deployed accounts can send (see sessionAddresses), importing them served nothing.

  return true;
}

export async function initializeWallet(log: LogFn): Promise<boolean> {
  // Evict a stale-format CRS left by a previous bb version before any proving runs (see fn docs).
  await bustStaleCrsCacheOnce(log);
  for (let attempt = 1; attempt <= MAX_INIT_ATTEMPTS; attempt++) {
    try {
      return await doInitializeWallet(log);
    } catch (err) {
      if (attempt < MAX_INIT_ATTEMPTS) {
        log(
          `Wallet init failed (attempt ${attempt}/${MAX_INIT_ATTEMPTS}), clearing stale data...`,
          "warn",
        );
        await clearIndexedDB();
      } else {
        log(`Wallet initialization failed: ${errorMessage(err)}`, "error");
        return false;
      }
    }
  }
  return false;
}

export function setUiMode(mode: UiMode): void {
  state.uiMode = mode;
  state.prover?.setForceLocal(mode === "local");
}

export interface SimStepDetail {
  syncMs: number;
  totalMs: number;
  perFunction: { name: string; ms: number }[];
}

export interface StepTiming {
  step: string;
  durationMs: number;
  simulation?: SimStepDetail;
  proveMs?: number;
  proveSendMs?: number;
  confirmMs?: number;
}

const EXPLORER_BASE = "https://testnet.aztecscan.xyz/tx-effects";

/** Create a scoped prove-timing tracker. Avoids module-level shared state. */
function createProveTracker() {
  let ms: number | undefined;
  return {
    set(value: number) {
      ms = value;
    },
    take(): number | undefined {
      const v = ms;
      ms = undefined;
      return v;
    },
  };
}

export interface DeployResult {
  address: string;
  steps: StepTiming[];
  totalDurationMs: number;
  mode: UiMode;
}

export interface TokenFlowResult {
  mode: UiMode;
  steps: StepTiming[];
  totalDurationMs: number;
  aliceBalance: bigint;
  bobBalance: bigint;
  tokenAddress: string;
}

interface SimTimings {
  sync?: number;
  total?: number;
  perFunction?: { functionName: string; time: number }[];
}

/** Extract our SimStepDetail from a simulate() result with includeMetadata: true. */
function extractSimDetail(simResult: {
  stats?: { timings: SimTimings };
}): SimStepDetail | undefined {
  const t = simResult.stats?.timings;
  if (!t) return undefined;
  return {
    syncMs: t.sync ?? 0,
    totalMs: t.total ?? 0,
    perFunction: (t.perFunction ?? []).map((f) => ({ name: f.functionName, ms: f.time })),
  };
}

/**
 * Send a tx, optionally retrying on "Block header not found" when enabled
 * via E2E_RETRY_STALE_HEADER. Re-simulates to refresh the block header when
 * proving takes long enough for it to go stale on live networks.
 */
async function sendWithRetry(
  method: { simulate: (opts: any) => Promise<any>; send: (opts: any) => Promise<any> },
  sendOpts: Record<string, unknown>,
  log: LogFn,
): Promise<TxHash> {
  const maxAttempts = RETRY_STALE_HEADER ? MAX_SEND_ATTEMPTS : 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (attempt > 1) {
        log(`Retrying (attempt ${attempt}/${maxAttempts}) — refreshing block header...`, "warn");
        await method.simulate(sendOpts);
      }
      const { txHash } = await method.send({ ...sendOpts, wait: NO_WAIT });
      return txHash;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < maxAttempts && msg.includes(BLOCK_HEADER_NOT_FOUND)) {
        log(`Block header went stale during proving (attempt ${attempt}/${maxAttempts})`, "warn");
        continue;
      }
      throw err;
    }
  }
  throw new Error("Unreachable");
}

/** Simulate → prove/send → confirm a transaction and return a StepTiming. */
async function executeStep(opts: {
  step: string;
  method: { simulate: (opts: any) => Promise<any>; send: (opts: any) => Promise<any> };
  sendOpts: Record<string, unknown>;
  log: LogFn;
  onConfirming: () => void;
  proveTracker: ReturnType<typeof createProveTracker>;
}): Promise<{ timing: StepTiming; txHash: string }> {
  const { step, method, sendOpts, log, onConfirming, proveTracker } = opts;
  const stepStart = Date.now();

  const simResult = await method.simulate({ ...sendOpts, includeMetadata: true });
  const simulation = extractSimDetail(simResult);

  const sendStart = Date.now();
  const hash = await sendWithRetry(method, sendOpts, log);
  const proveSendMs = Date.now() - sendStart;
  const proveMs = proveTracker.take();

  onConfirming();
  const confirmStart = Date.now();
  await waitForTx(hash);
  const confirmMs = Date.now() - confirmStart;

  return {
    timing: {
      step,
      durationMs: Date.now() - stepStart,
      simulation,
      proveMs,
      proveSendMs,
      confirmMs,
    },
    txHash: hash.toString(),
  };
}

/** Poll until a transaction is mined. Throws on dropped, reverted, or timed-out txs. */
async function waitForTx(txHash: TxHash): Promise<void> {
  const deadline = Date.now() + TX_TIMEOUT_MS;
  while (true) {
    const receipt = await state.node!.getTxReceipt(txHash);
    if (!receipt.isPending()) {
      if (receipt.isDropped()) throw new Error("Transaction dropped");
      // v5: a mined tx can still have reverted in public execution — that is NOT success.
      if (receipt.hasExecutionReverted()) throw new Error("Transaction reverted");
      return;
    }
    if (Date.now() > deadline) {
      throw new Error("Transaction confirmation timed out after 10 minutes");
    }
    await new Promise((r) => setTimeout(r, TX_POLL_INTERVAL_MS));
  }
}

export async function deployTestAccount(
  log: LogFn,
  onTick: (elapsedMs: number) => void,
  onStep: (stepName: string) => void,
  onPhase?: (phase: PrestoPhase, data?: PrestoPhaseData) => void,
): Promise<DeployResult> {
  if (!state.embeddedWallet) {
    throw new Error("Embedded wallet not initialized");
  }
  // (5.0) The deploy is self-paid via `from: NO_FROM`, so it no longer needs a registered sandbox
  // sender — the only requirement is an initialized wallet (checked above) + the Sponsored FPC.

  const mode = state.uiMode;
  const steps: StepTiming[] = [];
  const totalStart = Date.now();
  const proveTracker = createProveTracker();
  // B4 packaged-E2E witness: expose the raw phase trail on `window` so the composed-proof spec can assert the
  // accelerated path was USED (a `receive` phase, and NO `fallback`). The network `/prove`-header witness
  // proves native bb RAN, but proof decode can still fall back to WASM afterward (presto-prover.ts), so
  // the phase trail is the complementary check. Reset per deploy; harmless in prod (an unused window field).
  const phaseSink = window as typeof window & { __PRESTO_PHASES__?: PrestoPhase[] };
  phaseSink.__PRESTO_PHASES__ = [];
  state.prover?.setOnPhase((phase, data) => {
    phaseSink.__PRESTO_PHASES__?.push(phase);
    if (phase === "proved" && data?.durationMs) proveTracker.set(data.durationMs);
    onPhase?.(phase, data);
  });

  const interval = setInterval(() => {
    onTick(Date.now() - totalStart);
  }, 100);

  try {
    // Step 1: Create account
    onStep("creating account");
    log("Creating Schnorr account...");
    let stepStart = Date.now();

    const secret = Fr.random();
    const salt = Fr.random();
    // 5.0: the signing key is required and is the account's root of ownership.
    const signingKey = Fq.random();
    const accountManager = await state.embeddedWallet!.createSchnorrAccount(
      secret,
      salt,
      signingKey,
    );
    const deployMethod = await accountManager.getDeployMethod();

    steps.push({ step: "create account", durationMs: Date.now() - stepStart });
    log(`Account: ${accountManager.address.toString()}`);

    // 5.0: a self-paid account deploy uses from: NO_FROM. DeployAccountMethod then auto-sets
    // sendMessagesAs = the new account, so it discovers its own constructor notes. A signer `from`
    // tags those notes as that signer instead → in-circuit "Failed to get a note". The new address
    // is also injected into additionalScopes by DeployAccountMethod, so we no longer pass it. Fee
    // is paid by the Sponsored FPC regardless of from.
    const sendOpts = {
      from: NO_FROM,
      skipClassPublication: true,
      fee: { paymentMethod: state.feePaymentMethod! },
    };

    // Step 2: Simulate (captures witness gen timing). Best-effort: the try/catch below keeps the
    // flow going if sim-stat extraction throws.
    onStep("simulating deploy");
    log("Simulating deploy...");
    stepStart = Date.now();

    let simDetail: SimStepDetail | undefined;
    try {
      const simResult = await deployMethod.simulate({ ...sendOpts, includeMetadata: true });
      simDetail = extractSimDetail(simResult);
    } catch {
      log("Simulation stats unavailable (first deploy)", "warn");
    }

    steps.push({
      step: "simulate",
      durationMs: Date.now() - stepStart,
      simulation: simDetail,
    });

    // Step 3: Prove + send + confirm
    onStep("proving + sending");
    log("Proving and sending...");
    stepStart = Date.now();

    const txHash = await sendWithRetry(deployMethod, sendOpts, log);
    const proveSendMs = Date.now() - stepStart;
    const proveMs = proveTracker.take();

    onStep("confirming");
    const confirmStart = Date.now();
    await waitForTx(txHash);
    const confirmMs = Date.now() - confirmStart;

    const deployTxHash = txHash.toString();

    steps.push({
      step: "prove + send",
      durationMs: proveSendMs + confirmMs,
      proveMs,
      proveSendMs,
      confirmMs,
    });

    const totalDurationMs = Date.now() - totalStart;
    const address = accountManager.address.toString();
    log(
      `Deployed in ${(totalDurationMs / 1000).toFixed(1)}s → ${address}`,
      "success",
      `${EXPLORER_BASE}/${deployTxHash}`,
    );

    // Session-deployed accounts are the only valid tx senders (see sessionAddresses).
    state.sessionAddresses.push(accountManager.address);
    // On live networks, also surface it in the registered list for subsequent operations
    if (state.proofsRequired) {
      state.registeredAddresses.push(accountManager.address);
    }

    return { address, steps, totalDurationMs, mode };
  } finally {
    state.prover?.setOnPhase(null);
    clearInterval(interval);
  }
}

interface TokenFlowContext {
  alice: AztecAddress;
  fee: { paymentMethod: SponsoredFeePaymentMethod };
  steps: StepTiming[];
  log: LogFn;
  onStep: (stepName: string) => void;
  proveTracker: ReturnType<typeof createProveTracker>;
}

async function resolveBob(context: TokenFlowContext): Promise<AztecAddress> {
  // Registered addresses can be imported; only session accounts have usable entrypoint notes here.
  const existing = state.sessionAddresses.find((address) => !address.equals(context.alice));
  if (existing) return existing;

  context.onStep("deploying bob account");
  context.log("Deploying second account (Bob) for transfer...");
  const manager = await state.embeddedWallet!.createSchnorrAccount(
    Fr.random(),
    Fr.random(),
    Fq.random(),
  );
  const method = await manager.getDeployMethod();
  const { timing, txHash } = await executeStep({
    step: "deploy bob",
    method,
    // NO_FROM lets DeployAccountMethod scope and tag the new account's constructor notes.
    sendOpts: { from: NO_FROM, skipClassPublication: true, fee: context.fee },
    log: context.log,
    onConfirming: () => context.onStep("confirming bob"),
    proveTracker: context.proveTracker,
  });
  const bob = manager.address;
  state.sessionAddresses.push(bob);
  state.registeredAddresses.push(bob);
  context.steps.push(timing);
  context.log(
    `Bob deployed in ${(timing.durationMs / 1000).toFixed(1)}s`,
    "success",
    `${EXPLORER_BASE}/${txHash}`,
  );
  return bob;
}

async function deployToken(context: TokenFlowContext): Promise<TokenContract> {
  context.onStep("deploying token");
  context.log("Deploying TokenContract (minter=Alice)...");
  const deployment = TokenContract.deployWithOpts(
    { method: "constructor_with_minter", wallet: state.wallet! },
    "Presto",
    "ACEL",
    18,
    context.alice,
    AztecAddress.ZERO,
  );
  const { timing, txHash } = await executeStep({
    step: "deploy token",
    method: deployment,
    sendOpts: { from: context.alice, fee: context.fee },
    log: context.log,
    onConfirming: () => context.onStep("confirming token deploy"),
    proveTracker: context.proveTracker,
  });
  const token = TokenContract.at(await deployment.getAddress(), state.wallet!);
  context.steps.push(timing);
  context.log(
    `Token deployed in ${(timing.durationMs / 1000).toFixed(1)}s → ${token.address.toString()}`,
    "success",
    `${EXPLORER_BASE}/${txHash}`,
  );
  return token;
}

async function mintAndTransfer(
  context: TokenFlowContext,
  token: TokenContract,
  bob: AztecAddress,
): Promise<void> {
  context.onStep("minting 1000 ACEL");
  context.log("Minting 1000 ACEL to Alice...");
  const mint = await executeStep({
    step: "mint to private",
    method: token.methods.mint_to_private(context.alice, 1000n),
    sendOpts: { from: context.alice, fee: context.fee },
    log: context.log,
    onConfirming: () => context.onStep("confirming mint"),
    proveTracker: context.proveTracker,
  });
  context.steps.push(mint.timing);
  context.log(
    `Minted in ${(mint.timing.durationMs / 1000).toFixed(1)}s`,
    "success",
    `${EXPLORER_BASE}/${mint.txHash}`,
  );

  context.onStep("transferring 500 ACEL");
  context.log("Transferring 500 ACEL Alice → Bob...");
  const transfer = await executeStep({
    step: "private transfer",
    method: token.methods.transfer_private_to_private(context.alice, bob, 500n, 0),
    sendOpts: { from: context.alice, fee: context.fee },
    log: context.log,
    onConfirming: () => context.onStep("confirming transfer"),
    proveTracker: context.proveTracker,
  });
  context.steps.push(transfer.timing);
  context.log(
    `Transferred in ${(transfer.timing.durationMs / 1000).toFixed(1)}s`,
    "success",
    `${EXPLORER_BASE}/${transfer.txHash}`,
  );
}

async function readTokenBalances(
  context: TokenFlowContext,
  token: TokenContract,
  bob: AztecAddress,
): Promise<{ alice: bigint; bob: bigint }> {
  context.onStep("checking balances");
  context.log("Checking balances...");
  const startedAt = Date.now();
  const [{ result: alice }, { result: bobBalance }] = await Promise.all([
    token.methods.balance_of_private(context.alice).simulate({ from: context.alice }),
    token.methods.balance_of_private(bob).simulate({ from: bob }),
  ]);
  const durationMs = Date.now() - startedAt;
  context.steps.push({ step: "check balances", durationMs });
  context.log(
    `Balances — Alice: ${alice}, Bob: ${bobBalance} (${(durationMs / 1000).toFixed(1)}s)`,
    "success",
  );
  return { alice: BigInt(alice.toString()), bob: BigInt(bobBalance.toString()) };
}

export async function runTokenFlow(
  log: LogFn,
  onTick: (elapsedMs: number) => void,
  onStep: (stepName: string) => void,
  onPhase?: (phase: PrestoPhase, data?: PrestoPhaseData) => void,
): Promise<TokenFlowResult> {
  if (!state.wallet) {
    throw new Error("Wallet not initialized");
  }
  // Sender validity (session-deployed account exists) is checked by pickSessionSender below,
  // which throws the actionable "deploy a test account first" guidance on every network.

  const mode = state.uiMode;
  const alice = pickSessionSender();
  const fee = { paymentMethod: state.feePaymentMethod! };
  const steps: StepTiming[] = [];
  const totalStart = Date.now();
  const proveTracker = createProveTracker();
  state.prover?.setOnPhase(
    onPhase
      ? (phase, data) => {
          if (phase === "proved" && data?.durationMs) proveTracker.set(data.durationMs);
          onPhase(phase, data);
        }
      : null,
  );

  const interval = setInterval(() => {
    onTick(Date.now() - totalStart);
  }, 100);

  try {
    const context = { alice, fee, steps, log, onStep, proveTracker };
    const bob = await resolveBob(context);
    const token = await deployToken(context);
    await mintAndTransfer(context, token, bob);
    const balances = await readTokenBalances(context, token, bob);

    const totalDurationMs = Date.now() - totalStart;
    log(`Token flow complete in ${(totalDurationMs / 1000).toFixed(1)}s`, "success");

    return {
      mode,
      steps,
      totalDurationMs,
      aliceBalance: balances.alice,
      bobBalance: balances.bob,
      tokenAddress: token.address.toString(),
    };
  } finally {
    state.prover?.setOnPhase(null);
    clearInterval(interval);
  }
}

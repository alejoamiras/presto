import { loopbackPermission, watchLoopbackPermission } from "@alejoamiras/presto";
import type { PrestoBanner } from "@alejoamiras/presto-banners";
import "@alejoamiras/presto-banners/register";
import "./style.css";
import {
  AZTEC_DISPLAY_URL,
  AZTEC_SDK_VERSION,
  checkAztecNode,
  checkPrestoStatus,
  deployTestAccount,
  enableInsecureHttpForSession,
  initializeWallet,
  routeRun,
  runTokenFlow,
  setUiMode,
  state,
  type UiMode,
} from "./aztec";
import {
  diagMemory,
  downloadDiagnostics,
  installErrorHandlers,
  installWasmDiagnostics,
  installWorkerDiagnostics,
} from "./diagnostics";
import { proveNoirFixture } from "./noir";
import {
  ConfirmDialogController,
  type ConnectionPhase,
  connectionView,
  httpSessionConsent,
  PrestoStatusController,
} from "./presto-status";
import { showResult, stepToPhase } from "./results";
import { SparkOrbitController } from "./spark-orbit";
import { $, $btn, appendLog, formatDuration, setStatus, startClock } from "./ui";
import { sameMajor } from "./version";

let deploying = false;
// `initializeWallet()` succeeded, FPC included; `state.wallet` alone is set before the FPC step.
let walletReady = false;

function toggle(id: string, visible: boolean): void {
  $(id).classList.toggle("hidden", !visible);
}

function renderConnection(phase: ConnectionPhase): void {
  const view = connectionView(phase);
  const focused = document.activeElement;
  const settled = phase.kind === "checked" || phase.kind === "blocked";
  setStatus("presto-status", view.connected || (settled ? false : null));
  $("presto-label").textContent = view.label;
  $("presto-mode-hint").textContent = view.modeHint;
  toggle("presto-connect", view.showConnectLink);
  toggle("presto-may-ask", view.showMayAskHint);
  toggle("presto-cta", view.showInstall);
  toggle("presto-permission-help", view.showPermissionHelp);
  toggle("presto-secure-help", view.showSecureConnectionHelp);
  toggle("presto-retry-help", view.retryHelp !== null);
  $("presto-retry-text").textContent = view.retryHelp ?? "";
  $("presto-secure-title").textContent = view.secureConnectionTitle ?? "";
  $("presto-secure-message").textContent = view.secureConnectionMessage ?? "";
  if (!view.showSecureConnectionHelp) httpConsent.cancel();
  // A control that just disappeared must not strand keyboard focus on the page body.
  if (focused instanceof HTMLElement && focused.closest(".hidden")) {
    $("presto-service-status").focus();
  }

  // The ribbon is the install pitch only; the panels above own the warn-state recovery flows.
  ($("accel-banner") as PrestoBanner).state = view.showInstall
    ? "offline"
    : view.connected
      ? "available"
      : null;
  appendLog(view.log, view.logLevel);
}

const prestoStatus = new PrestoStatusController({
  check: checkPrestoStatus,
  permission: loopbackPermission,
  render: renderConnection,
  setPending: (pending) => {
    for (const [id, label] of [
      ["presto-permission-retry", "Retry"],
      ["presto-try-again", "Try again"],
      ["presto-secure-retry", "Retry secure connection"],
    ] as const) {
      const button = $btn(id);
      button.disabled = pending;
      button.textContent = pending ? "Checking…" : label;
    }
    $btn("presto-use-http").disabled = pending;
    if (pending) httpConsent.cancel();
  },
  onAuthorizationChange: (authorized) => {
    if (!authorized && deploying && state.uiMode === "accelerated") {
      appendLog("Access to Presto was turned off. This run continues in the browser", "warn");
    }
    const mode = authorized ? "accelerated" : "local";
    if (state.uiMode !== mode) applyMode(mode);
  },
});

function announce(message: string): void {
  $("presto-recovery-announcement").textContent = message;
}

/** Closes a dialog and returns focus to `returnTo`, or to the Services panel if it is gone. */
function closeDialog(id: string, returnTo: HTMLElement | null): void {
  const dialog = $(id) as HTMLDialogElement;
  if (dialog.open) dialog.close();
  const target = returnTo?.isConnected && !returnTo.closest(".hidden") ? returnTo : null;
  (target ?? $("presto-service-status")).focus();
}

let connectOpener: HTMLElement | null = null;
const connectDialog = new ConfirmDialogController({
  run: () => prestoStatus.connect(),
  setOpen: (open) => {
    if (!open) return closeDialog("presto-connect-dialog", connectOpener);
    connectOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ($("presto-connect-dialog") as HTMLDialogElement).showModal();
  },
  setPending: () => {},
  announce,
  cancelled: "Presto not connected. Proofs keep running in this tab.",
});

const httpConsent = httpSessionConsent({
  configure: () => {
    const displayed = prestoStatus.displayed;
    if (!displayed || displayed.available || displayed.reason !== "secure-connection-unavailable") {
      throw new Error("secure connection status changed before HTTP consent was confirmed");
    }
    enableInsecureHttpForSession();
  },
  refresh: () => prestoStatus.refresh({ forceRefresh: true }),
  setOpen: (open) => {
    if (open) ($("http-session-confirmation") as HTMLDialogElement).showModal();
    else closeDialog("http-session-confirmation", null);
  },
  setPending: (pending) => {
    const confirm = $btn("http-session-confirm");
    confirm.disabled = pending;
    $btn("presto-use-http").disabled = pending;
    confirm.textContent = pending ? "Checking…" : "Use HTTP for this session";
  },
  announce,
});

/** Escape, a backdrop click and a browser-forced close all cancel; nothing runs without Confirm. */
function wireDialog(
  id: string,
  controller: ConfirmDialogController,
  buttons: { cancel: string; confirm: string },
  failure: string,
): void {
  const dialog = $(id) as HTMLDialogElement;
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    controller.cancel();
  });
  dialog.addEventListener("close", () => controller.cancel());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) controller.cancel();
  });
  $btn(buttons.cancel).addEventListener("click", () => controller.cancel());
  $btn(buttons.confirm).addEventListener("click", () => {
    void controller.confirm().catch(() => appendLog(failure, "error"));
  });
}

// ── Clock ──
startClock();

// ── Mode toggle ──
const INACTIVE_BTN = "mode-btn";
const ACTIVE_BTN = "mode-btn mode-active";

function updateModeUI(mode: UiMode): void {
  const buttons: Record<UiMode, HTMLElement> = {
    local: $("mode-local"),
    accelerated: $("mode-accelerated"),
  };

  for (const [key, btn] of Object.entries(buttons)) {
    const active = key === mode;
    btn.className = active ? ACTIVE_BTN : INACTIVE_BTN;
    btn.dataset.active = String(active);
  }
}

function applyMode(mode: UiMode): void {
  setUiMode(mode);
  updateModeUI(mode);
  appendLog(mode === "local" ? "Proving mode → in-browser" : "Proving mode → Presto");
}

/** Presto mode needs consent first: the explainer when the browser has not blocked this site. */
function choosePresto(): void {
  if (deploying) return;
  const phase = prestoStatus.phase;
  if (prestoStatus.authorized) {
    applyMode("accelerated");
    return;
  }
  if (phase.kind === "blocked") {
    $("presto-permission-help").focus();
    return;
  }
  $("presto-connect-verb").textContent =
    phase.kind === "not-connected" && phase.permission === "prompt" ? "will ask" : "may ask";
  connectDialog.request();
}

$("mode-local").addEventListener("click", () => {
  if (deploying) return;
  applyMode("local");
});
$("mode-accelerated").addEventListener("click", choosePresto);
$("presto-connect").addEventListener("click", choosePresto);

// ── Shared helpers ──

/** Handle a prover phase: feed the dial and react to fallback. */
function handleProverPhase(ascii: SparkOrbitController, phase: string, _data?: unknown): void {
  ascii.pushPhase(phase as Parameters<typeof ascii.pushPhase>[0]);
  if (phase === "fallback") {
    appendLog("Presto's offline, proving in-browser for now (slower)", "warn");
    // The proof path never awaits this. The controller starts a single forced refresh only if its
    // last rendered state was available, so in-browser fallback remains immediate and failure-proof.
    if (state.uiMode === "accelerated") prestoStatus.refreshAfterFallback();
  }
}

/** Re-reads the browser's decision and routes this run; returns the mode the run reports. */
async function startRun(): Promise<() => UiMode> {
  const native = await prestoStatus.beforeProving();
  if (!native && prestoStatus.authorized && state.uiMode === "accelerated") {
    appendLog("Waiting for your browser's answer. This run proves in the browser", "warn");
  }
  return routeRun(native);
}

function setActionButtonsDisabled(disabled: boolean): void {
  $btn("deploy-btn").disabled = disabled;
  // The token flow needs a session-deployed sender (see pickSessionSender) — an enabled
  // button must imply the action can succeed, so it stays disabled until one exists.
  $btn("token-flow-btn").disabled = disabled || state.sessionAddresses.length === 0;
  $btn("noir-btn").disabled = disabled;
}

// ── Noir circuit ──
$("noir-btn").addEventListener("click", async () => {
  if (deploying) return;
  deploying = true;
  setActionButtonsDisabled(true);

  const btn = $btn("noir-btn");
  btn.textContent = "Proving...";
  $("progress").classList.remove("hidden");

  const ascii = new SparkOrbitController($("ascii-art"), document.getElementById("ascii-elapsed"));
  const runMode = await startRun();
  ascii.start(runMode());

  try {
    const result = await proveNoirFixture(runMode, appendLog, (phase, data) =>
      handleProverPhase(ascii, phase, data),
    );
    appendLog(
      `noir proof: ${formatDuration(result.durationMs)}`,
      result.identical ? "success" : "error",
    );
    showResult(
      "noir-",
      result.fellBack ? "local" : result.mode,
      result.durationMs,
      result.identical ? "identical to fixture" : "differs from fixture",
    );
  } catch (err) {
    appendLog(`Noir proof failed: ${err instanceof Error ? err.message : String(err)}`, "error");
  } finally {
    ascii.stop();
    deploying = false;
    // The Aztec actions stay disabled until the wallet is ready (it may have become ready during
    // this proof); the Noir circuit needs no node.
    setActionButtonsDisabled(!walletReady);
    btn.disabled = false;
    btn.textContent = "Prove Noir Circuit";
    $("progress").classList.add("hidden");
  }
});

// ── Deploy ──
$("deploy-btn").addEventListener("click", async () => {
  if (deploying) return;
  deploying = true;
  setActionButtonsDisabled(true);

  const btn = $btn("deploy-btn");
  btn.textContent = "Proving...";

  $("progress").classList.remove("hidden");

  const ascii = new SparkOrbitController($("ascii-art"), document.getElementById("ascii-elapsed"));
  const runMode = await startRun();
  ascii.start(runMode());

  try {
    diagMemory("deploy-start");
    const result = await deployTestAccount(
      appendLog,
      () => {},
      (stepName) => {
        const phase = stepToPhase(stepName);
        if (phase) ascii.pushPhase(phase);
      },
      (phase, data) => handleProverPhase(ascii, phase, data),
    );
    diagMemory("deploy-end");

    for (const step of result.steps) {
      appendLog(`${step.step} ${formatDuration(step.durationMs)}`);
    }
    appendLog(`total: ${formatDuration(result.totalDurationMs)}`, "success");

    showResult("", runMode(), result.totalDurationMs, undefined, result.steps);
  } catch (err) {
    diagMemory("deploy-error");
    appendLog(`Deploy failed: ${err instanceof Error ? err.message : String(err)}`, "error");
  } finally {
    ascii.stop();
    deploying = false;
    setActionButtonsDisabled(false);
    btn.textContent = "Deploy Test Account";
    $("progress").classList.add("hidden");
  }
});

// ── Token Flow ──
$("token-flow-btn").addEventListener("click", async () => {
  if (deploying) return;
  deploying = true;
  setActionButtonsDisabled(true);

  const btn = $btn("token-flow-btn");
  btn.textContent = "Running...";

  $("progress").classList.remove("hidden");

  const ascii = new SparkOrbitController($("ascii-art"), document.getElementById("ascii-elapsed"));
  const runMode = await startRun();
  ascii.start(runMode());

  try {
    diagMemory("token-flow-start");
    const result = await runTokenFlow(
      appendLog,
      () => {},
      (stepName) => {
        const phase = stepToPhase(stepName);
        if (phase) ascii.pushPhase(phase);
      },
      (phase, data) => handleProverPhase(ascii, phase, data),
    );
    diagMemory("token-flow-end");

    for (const step of result.steps) {
      appendLog(`${step.step} ${formatDuration(step.durationMs)}`);
    }
    appendLog(`total: ${formatDuration(result.totalDurationMs)}`, "success");

    showResult("", runMode(), result.totalDurationMs, "token flow", result.steps);
  } catch (err) {
    diagMemory("token-flow-error");
    appendLog(`Token flow failed: ${err instanceof Error ? err.message : String(err)}`, "error");
  } finally {
    ascii.stop();
    deploying = false;
    setActionButtonsDisabled(false);
    btn.textContent = "Run Token Flow";
    $("progress").classList.add("hidden");
  }
});

// ── Init ──
async function initWallet(): Promise<void> {
  appendLog("Initializing wallet...");
  $("wallet-state").textContent = "initializing...";
  setStatus("wallet-dot", null);

  const ok = await initializeWallet(appendLog);
  walletReady = ok;
  if (ok) {
    $("wallet-state").textContent = "ready";
    $("wallet-state").className = "text-brand-accent/80 ml-auto text-[10px] font-mono font-light";
    setStatus("wallet-dot", true);
    // A Noir proof in flight re-enables the actions itself when it finishes.
    if (!deploying) setActionButtonsDisabled(false);

    const networkLabel = $("network-label");
    if (state.proofsRequired) {
      networkLabel.textContent = "proofs enabled";
      networkLabel.className = "text-brand-warning text-[10px] uppercase tracking-wider ml-auto";
      appendLog("Ready. Deploy a test account to get started (proofs enabled)", "success");
    } else {
      networkLabel.textContent = "proofs simulated";
      networkLabel.className =
        "text-brand-text-muted/50 text-[10px] uppercase tracking-wider ml-auto";
      appendLog("Ready. Deploy a test account to get started", "success");
    }
  } else {
    $("wallet-state").textContent = "failed";
    $("wallet-state").className = "text-brand-danger ml-auto text-[10px] font-mono font-light";
    setStatus("wallet-dot", false);
  }
}

function wirePrestoControls(): void {
  for (const id of ["presto-permission-retry", "presto-try-again"]) {
    $btn(id).addEventListener("click", () => {
      void prestoStatus.connect().catch(() => {
        appendLog("Couldn't re-check Presto. Proving stays in-browser", "error");
      });
    });
  }

  $btn("presto-secure-retry").addEventListener("click", () => {
    void prestoStatus.retrySecureConnection().catch(() => {
      appendLog("Couldn't retry the secure connection. Proving stays in-browser", "error");
    });
  });

  $btn("presto-use-http").addEventListener("click", () => httpConsent.request());
  wireDialog(
    "http-session-confirmation",
    httpConsent,
    { cancel: "http-session-cancel", confirm: "http-session-confirm" },
    "Couldn't switch to HTTP. Proving stays in-browser",
  );
  wireDialog(
    "presto-connect-dialog",
    connectDialog,
    { cancel: "presto-connect-cancel", confirm: "presto-connect-continue" },
    "Couldn't connect to Presto. Proving stays in-browser",
  );
}

async function init(): Promise<void> {
  // Install diagnostics BEFORE any Worker/WASM is created
  installWorkerDiagnostics();
  installWasmDiagnostics();
  installErrorHandlers();

  // Subscribed before the first read, so a decision made while the page loads is not missed. A
  // later Allow owns a fresh, cache-bypassing refresh; a block or a reset revokes consent.
  await watchLoopbackPermission((next) => prestoStatus.permissionChanged(next));

  $("aztec-url").textContent = AZTEC_DISPLAY_URL;

  // Wire diagnostics export
  $("export-diagnostics-btn").addEventListener("click", downloadDiagnostics);
  wirePrestoControls();

  updateModeUI("local");
  // The Noir circuit proves without an Aztec node or a wallet.
  $btn("noir-btn").disabled = false;

  appendLog("Checking Aztec node...");
  const { reachable: aztec, nodeVersion } = await checkAztecNode();
  setStatus("aztec-status", aztec);

  // Show versions row once we have data
  if (AZTEC_SDK_VERSION !== "unknown" || nodeVersion) {
    $("versions-row").classList.remove("hidden");
    const sdkEl = $("version-sdk");
    const nodeEl = $("version-node");
    if (AZTEC_SDK_VERSION !== "unknown") sdkEl.textContent = AZTEC_SDK_VERSION;
    if (nodeVersion) {
      nodeEl.textContent = nodeVersion;
      appendLog(`Aztec node version: ${nodeVersion}`);
      if (sameMajor(AZTEC_SDK_VERSION, nodeVersion) === false) {
        appendLog(`Version mismatch: SDK ${AZTEC_SDK_VERSION} ≠ node ${nodeVersion}`, "warn");
        sdkEl.classList.add("text-brand-warning");
        nodeEl.classList.add("text-brand-warning");
      } else if (sameMajor(AZTEC_SDK_VERSION, nodeVersion) && nodeVersion !== AZTEC_SDK_VERSION) {
        appendLog(`SDK ${AZTEC_SDK_VERSION} / node ${nodeVersion}: same major, compatible`);
      }
    }
  }

  // Contacts Presto only if this site was already allowed; otherwise waits for Connect.
  await prestoStatus.start();

  // Show embedded UI and hide fallback placeholder
  $("embedded-ui").classList.remove("hidden");
  document.querySelector(".embedded-ui-fallback")?.classList.add("hidden");

  if (aztec) {
    await initWallet();
  } else {
    appendLog(`Aztec node not reachable at ${AZTEC_DISPLAY_URL}`, "error");
    appendLog("Start the Aztec node before using the demo", "warn");
    $("wallet-state").textContent = "aztec unavailable";
    setStatus("wallet-dot", false);
  }
}

init();

import type {
  LoopbackPermissionState,
  PrestoStatus,
  PrestoStatusCheckOptions,
} from "@alejoamiras/presto";

export interface PrestoStatusView {
  connected: boolean;
  label: string;
  log: string;
  logLevel: "info" | "success" | "warn" | "error";
  showInstall: boolean;
  showPermissionHelp: boolean;
  showSecureConnectionHelp: boolean;
  secureConnectionTitle?: string;
  secureConnectionMessage?: string;
}

/** Exhaustive UI model for every public SDK status arm. */
export function prestoStatusView(status: PrestoStatus): PrestoStatusView {
  if (status.available) {
    return {
      connected: true,
      label: "running",
      log: "Presto found on this computer",
      logLevel: "success",
      showInstall: false,
      showPermissionHelp: false,
      showSecureConnectionHelp: false,
    };
  }

  switch (status.reason) {
    case "permission-blocked":
      return {
        connected: false,
        label: "blocked by your browser",
        log: "Your browser blocked access to Presto. Allow it in site settings, then Retry",
        logLevel: "warn",
        showInstall: false,
        showPermissionHelp: true,
        showSecureConnectionHelp: false,
      };
    case "secure-connection-unavailable": {
      const explanation = {
        "https-disabled": {
          title: "Encrypted Connection is disabled",
          message:
            "Presto is running, but its encrypted connection is off. Turn on Encrypted Connection in Presto's Settings.",
        },
        "tls-or-trust-failure": {
          title: "Secure connection is not trusted",
          message:
            "Presto offers an encrypted connection, but this browser doesn't trust it yet. Run Presto's certificate setup again.",
        },
        "presto-reachable": {
          title: "Presto is reachable",
          message:
            "Presto answered, but not over an encrypted connection. Check Encrypted Connection in Presto's Settings.",
        },
        unconfirmed: {
          title: "Secure connection unavailable",
          message:
            "Presto didn't answer. It may be stopped or not installed, or your browser may have blocked the check.",
        },
      }[status.diagnosis];
      return {
        connected: false,
        label: "secure connection unavailable, in-browser",
        log: `${explanation.title}. Proving stays in-browser`,
        logLevel: "warn",
        showInstall: status.diagnosis === "unconfirmed",
        showPermissionHelp: false,
        showSecureConnectionHelp: true,
        secureConnectionTitle: explanation.title,
        secureConnectionMessage: explanation.message,
      };
    }
    case "offline":
      return {
        connected: false,
        label: "not found, in-browser",
        log: "Presto not found, proving stays in-browser",
        logLevel: "warn",
        showInstall: true,
        showPermissionHelp: false,
        showSecureConnectionHelp: false,
      };
    case "error":
      return {
        connected: false,
        label: "unexpected answer, in-browser",
        log: "Presto answered unexpectedly, proving in-browser",
        logLevel: "error",
        showInstall: false,
        showPermissionHelp: false,
        showSecureConnectionHelp: false,
      };
    case "version-mismatch":
      return {
        connected: false,
        label: "version mismatch, in-browser",
        log: "Presto's Aztec version is incompatible, proving in-browser",
        logLevel: "warn",
        showInstall: false,
        showPermissionHelp: false,
        showSecureConnectionHelp: false,
      };
  }
}

export type ConnectionPhase =
  | { kind: "not-connected"; permission: "prompt" | "unsupported" }
  /** The stored decision is "denied"; nothing is sent. */
  | { kind: "blocked" }
  | { kind: "checking"; browserMayAsk: boolean }
  /** No answer from Presto while the stored decision is still "prompt". */
  | { kind: "awaiting-browser" }
  /** `unsupportedHint`: no answer, and the browser does not report its decision. */
  | { kind: "checked"; status: PrestoStatus; unsupportedHint: boolean };

export interface ConnectionView extends PrestoStatusView {
  modeHint:
    | "connect"
    | "checking…"
    | "waiting"
    | "blocked"
    | "not found"
    | "couldn't connect"
    | "fastest";
  showConnectLink: boolean;
  showMayAskHint: boolean;
  /** Text beside a Try again button; null hides both. */
  retryHelp: string | null;
}

const QUIET: Omit<PrestoStatusView, "label" | "log" | "logLevel"> = {
  connected: false,
  showInstall: false,
  showPermissionHelp: false,
  showSecureConnectionHelp: false,
};
const NO_CONNECT = { showConnectLink: false, showMayAskHint: false, retryHelp: null };

/** An answer that could equally mean "not installed" or "the browser held the request". */
function inconclusive(status: PrestoStatus): boolean {
  return (
    !status.available &&
    (status.reason === "offline" ||
      (status.reason === "secure-connection-unavailable" && status.diagnosis === "unconfirmed"))
  );
}

export function connectionView(phase: ConnectionPhase): ConnectionView {
  switch (phase.kind) {
    case "not-connected":
      return {
        ...QUIET,
        ...NO_CONNECT,
        label: "not connected",
        log: "Presto not connected. Proofs run in this tab until you connect",
        logLevel: "info",
        modeHint: "connect",
        showConnectLink: true,
      };
    case "blocked":
      return {
        ...prestoStatusView({ available: false, reason: "permission-blocked" }),
        ...NO_CONNECT,
        modeHint: "blocked",
      };
    case "checking":
      return {
        ...QUIET,
        ...NO_CONNECT,
        label: "checking…",
        log: "Connecting to Presto…",
        logLevel: "info",
        modeHint: "checking…",
        showMayAskHint: phase.browserMayAsk,
      };
    case "awaiting-browser":
      return {
        ...QUIET,
        ...NO_CONNECT,
        label: "waiting for your browser",
        log: "Waiting for your browser's answer",
        logLevel: "info",
        modeHint: "waiting",
        retryHelp:
          "If your browser is asking whether this site can reach apps on this device, choose Allow. Closed it?",
      };
    case "checked": {
      const view = prestoStatusView(phase.status);
      if (phase.status.available) return { ...view, ...NO_CONNECT, modeHint: "fastest" };
      if (phase.unsupportedHint && inconclusive(phase.status)) {
        return {
          ...view,
          ...NO_CONNECT,
          label: "couldn't connect, in-browser",
          log: "Couldn't connect to Presto, proving stays in-browser",
          modeHint: "couldn't connect",
          // The secure-connection panel already offers a retry and names both causes.
          retryHelp: view.showSecureConnectionHelp
            ? null
            : "If your browser asked for permission, allow it and try again. Otherwise, check that Presto is running.",
        };
      }
      return {
        ...view,
        ...NO_CONNECT,
        modeHint: phase.status.reason === "offline" ? "not found" : "couldn't connect",
      };
    }
  }
}

interface PrestoStatusControllerOptions {
  check: (options?: PrestoStatusCheckOptions) => Promise<PrestoStatus>;
  /** The stored decision, read without prompting (`loopbackPermission`). */
  permission: () => Promise<LoopbackPermissionState>;
  render: (phase: ConnectionPhase) => void;
  setPending: (pending: boolean) => void;
  /** Consent was given (a click or a grant) or withdrawn; the page's mode follows it. */
  onAuthorizationChange: (authorized: boolean) => void;
}

/**
 * The page's single owner of consent, status checks and the Presto row. Nothing reaches Presto until
 * a click or a reported grant authorizes it; a block, or a reset to "ask" after a grant, revokes
 * consent and drops every result still in flight. A newer refresh invalidates an older one's right
 * to render; the SDK itself coalesces same-generation probes.
 */
export class PrestoStatusController {
  /** Display ownership: bumped by every refresh and every revocation. */
  #epoch = 0;
  /** Bumped by every applied permission decision and revocation, so a read that raced one yields. */
  #decisions = 0;
  /** Bumped by every revocation, so a click whose read raced one cannot undo it. */
  #revocations = 0;
  #shown = false;
  #authorized = false;
  /** "granted" read or reported since consent, so a later "prompt" means the site was reset. */
  #seenGranted = false;
  /** Presto answered definitively since consent, so a lingering "prompt" does not gate it. */
  #reached = false;
  #permission: LoopbackPermissionState = "unsupported";
  #phase: ConnectionPhase = { kind: "not-connected", permission: "unsupported" };
  #displayed: PrestoStatus | null = null;
  #fallbackRefresh: Promise<void> | null = null;
  #inFlight = new Set<Promise<void>>();
  #permissionRefresh: Promise<void> | null = null;
  #secureRefresh: Promise<void> | null = null;

  constructor(private readonly options: PrestoStatusControllerOptions) {}

  get authorized(): boolean {
    return this.#authorized;
  }

  get phase(): ConnectionPhase {
    return this.#phase;
  }

  /** The last checked status; null while not connected, checking or waiting. */
  get displayed(): PrestoStatus | null {
    return this.#displayed;
  }

  /**
   * Reads the decision once at load: only "granted" connects without a click. A click or a reported
   * change that already authorized or rendered owns the row, so this read then yields; a decision
   * that changed nothing (a read before an early run) does not.
   */
  async start(): Promise<void> {
    const { state } = await this.#read();
    if (this.#shown || this.#authorized) return;
    if (state === "granted") {
      this.#seenGranted = true;
      this.#authorize();
      await this.refresh();
    } else if (state === "denied") {
      this.#show({ kind: "blocked" });
    } else {
      this.#show({ kind: "not-connected", permission: state });
    }
  }

  /** An explained click (Continue, Try again, Retry): proceeds unless the browser reports a block. */
  async connect(): Promise<void> {
    const revocations = this.#revocations;
    const { state } = await this.#read();
    if (this.#revocations !== revocations) return;
    if (state === "denied") return this.#revoke("denied");
    this.#seenGranted = state === "granted";
    this.#authorize();
    await this.refresh({ forceRefresh: true });
  }

  /** A change the browser reported. It wins over any read still in flight. */
  permissionChanged(state: Exclude<LoopbackPermissionState, "unsupported">): void {
    this.#decisions++;
    this.#permission = state;
    this.#apply(state, true);
  }

  /**
   * Re-reads the decision before a run and says whether its proofs may use Presto. A reset after a
   * grant revokes consent; a "prompt" nobody has answered keeps this run in the browser only.
   */
  async beforeProving(): Promise<boolean> {
    const { state, fresh } = await this.#read();
    if (fresh) this.#apply(state, false);
    return this.#authorized && (state !== "prompt" || this.#reached || this.#seenGranted);
  }

  /** Re-reads the decision first, so a block or reset nobody reported still stops the check. */
  refresh(checkOptions?: PrestoStatusCheckOptions): Promise<void> {
    if (!this.#authorized) return Promise.resolve();
    const operation = (async () => {
      const { state, fresh } = await this.#read();
      if (fresh) {
        // This check is the probe a newly seen grant would otherwise schedule.
        if (state === "granted") this.#seenGranted = true;
        this.#apply(state, false);
      }
      if (!this.#authorized) return;
      const epoch = ++this.#epoch;
      this.options.setPending(true);
      this.#show({ kind: "checking", browserMayAsk: this.#permission !== "granted" });
      try {
        const status = await this.options.check(checkOptions);
        if (epoch === this.#epoch) await this.#settle(status, epoch);
      } finally {
        if (epoch === this.#epoch) this.options.setPending(false);
      }
    })();
    this.#inFlight.add(operation);
    void operation.then(
      () => this.#inFlight.delete(operation),
      () => this.#inFlight.delete(operation),
    );
    return operation;
  }

  /**
   * Re-probe after a browser permission transition. If the old bounded check has not settled yet,
   * wait for it before forcing the new probe: SDK force-refresh deliberately joins an in-flight
   * same-generation probe, which would otherwise reproduce the stale post-prompt result. Consent is
   * checked again after the wait, by `refresh`.
   */
  refreshAfterPermissionChange(): Promise<void> {
    if (this.#permissionRefresh) return this.#permissionRefresh;

    const pending = [...this.#inFlight];
    if (pending.length > 0) {
      // Revoke every old operation's display ownership while the new permission state waits to probe.
      ++this.#epoch;
      this.options.setPending(true);
    }

    const refresh = Promise.allSettled(pending).then(() => this.refresh({ forceRefresh: true }));
    this.#permissionRefresh = refresh.finally(() => {
      this.#permissionRefresh = null;
    });
    return this.#permissionRefresh;
  }

  /** Coalesce repeated secure-recovery clicks into one forced status refresh. */
  retrySecureConnection(): Promise<void> {
    if (this.#secureRefresh) return this.#secureRefresh;
    const refresh = this.refresh({ forceRefresh: true });
    this.#secureRefresh = refresh.finally(() => {
      this.#secureRefresh = null;
    });
    return this.#secureRefresh;
  }

  /** Fire-and-forget refresh after a native attempt fell back. Never rejects into the proof path. */
  refreshAfterFallback(): void {
    if (!this.#displayed?.available || this.#fallbackRefresh) return;
    this.#fallbackRefresh = this.refresh({ forceRefresh: true })
      .catch(() => {})
      .finally(() => {
        this.#fallbackRefresh = null;
      });
  }

  /** `fresh` is false when a decision was applied during the read; its state is returned instead. */
  async #read(): Promise<{ state: LoopbackPermissionState; fresh: boolean }> {
    const decisions = this.#decisions;
    const state = await this.options.permission();
    if (decisions !== this.#decisions) return { state: this.#permission, fresh: false };
    this.#decisions++;
    this.#permission = state;
    return { state, fresh: true };
  }

  /** Applies a decision seen outside a click: `reported` by the watcher, or read before a run. */
  #apply(state: LoopbackPermissionState, reported: boolean): void {
    const blocked = this.#phase.kind === "blocked";
    if (state === "denied") {
      if (this.#authorized || !blocked) this.#revoke("denied");
    } else if (state === "prompt") {
      if (this.#seenGranted || blocked || (reported && this.#authorized)) this.#revoke("prompt");
    } else if (state === "granted") {
      const news = reported || !this.#seenGranted;
      this.#seenGranted = true;
      this.#authorize();
      if (news) void this.refreshAfterPermissionChange().catch(() => {});
    }
  }

  async #settle(status: PrestoStatus, epoch: number): Promise<void> {
    if (!status.available && status.reason === "permission-blocked") return this.#revoke("denied");
    if (!inconclusive(status)) {
      this.#reached = true;
      return this.#show({ kind: "checked", status, unsupportedHint: false });
    }
    const { state } = await this.#read();
    if (epoch !== this.#epoch) return;
    if (state === "denied") return this.#revoke("denied");
    if (state === "prompt" && this.#seenGranted) return this.#revoke("prompt");
    if (state === "prompt" && !this.#reached) return this.#show({ kind: "awaiting-browser" });
    if (state === "granted") this.#seenGranted = true;
    this.#show({ kind: "checked", status, unsupportedHint: state === "unsupported" });
  }

  #authorize(): void {
    if (this.#authorized) return;
    this.#authorized = true;
    this.#reached = false;
    this.options.onAuthorizationChange(true);
  }

  #revoke(to: "denied" | "prompt"): void {
    ++this.#epoch;
    ++this.#revocations;
    ++this.#decisions;
    this.#permission = to;
    const wasAuthorized = this.#authorized;
    this.#authorized = false;
    this.#seenGranted = false;
    this.#reached = false;
    this.options.setPending(false);
    this.#show(to === "denied" ? { kind: "blocked" } : { kind: "not-connected", permission: to });
    if (wasAuthorized) this.options.onAuthorizationChange(false);
  }

  #show(phase: ConnectionPhase): void {
    this.#shown = true;
    this.#phase = phase;
    this.#displayed = phase.kind === "checked" ? phase.status : null;
    this.options.render(phase);
  }
}

interface ConfirmDialogOptions {
  /** Runs once per confirmation, after the dialog has closed. */
  run: () => Promise<void>;
  setOpen: (open: boolean) => void;
  setPending: (pending: boolean) => void;
  announce: (message: string) => void;
  cancelled: string;
}

/** One confirmation dialog: nothing runs on cancel, and duplicate activation is suppressed. */
export class ConfirmDialogController {
  #open = false;
  #operation: Promise<void> | null = null;

  constructor(private readonly options: ConfirmDialogOptions) {}

  request(): void {
    if (this.#open || this.#operation) return;
    this.#open = true;
    this.options.setOpen(true);
  }

  cancel(): void {
    if (!this.#open || this.#operation) return;
    this.#open = false;
    this.options.setOpen(false);
    this.options.announce(this.options.cancelled);
  }

  confirm(): Promise<void> {
    if (this.#operation) return this.#operation;
    if (!this.#open) return Promise.resolve();

    this.#open = false;
    this.options.setOpen(false);
    this.options.setPending(true);
    const operation = Promise.resolve()
      .then(() => this.options.run())
      .finally(() => {
        this.options.setPending(false);
        if (this.#operation === operation) this.#operation = null;
      });
    this.#operation = operation;
    return operation;
  }
}

/** The explicit, non-persistent HTTP-for-this-tab confirmation. */
export function httpSessionConsent(options: {
  configure: () => void;
  refresh: () => Promise<void>;
  setOpen: (open: boolean) => void;
  setPending: (pending: boolean) => void;
  announce: (message: string) => void;
}): ConfirmDialogController {
  const { announce } = options;
  return new ConfirmDialogController({
    ...options,
    cancelled: "HTTP session fallback cancelled. HTTPS-only proving remains enabled.",
    run: async () => {
      announce("Enabling HTTP for this tab and checking Presto status.");
      try {
        options.configure();
      } catch (error) {
        announce(
          "HTTP was not enabled because configuration failed. HTTPS-only proving remains enabled.",
        );
        throw error;
      }
      try {
        await options.refresh();
      } catch (error) {
        announce(
          "HTTP is allowed for this tab, but the status refresh failed. Proving stays in the browser.",
        );
        throw error;
      }
      announce("HTTP is allowed for this tab only. Presto status refreshed.");
    },
  });
}

import { describe, expect, test } from "bun:test";
import type {
  LoopbackPermissionState,
  PrestoStatus,
  PrestoStatusCheckOptions,
} from "@alejoamiras/presto";
import {
  type ConnectionPhase,
  connectionView,
  httpSessionConsent,
  PrestoStatusController,
  prestoStatusView,
} from "./presto-status";

const AVAILABLE: PrestoStatus = { available: true, needsDownload: false, protocol: "https" };
const OFFLINE: PrestoStatus = { available: false, reason: "offline" };
const UNCONFIRMED: PrestoStatus = {
  available: false,
  reason: "secure-connection-unavailable",
  diagnosis: "unconfirmed",
};
const ERROR: PrestoStatus = { available: false, reason: "error", protocol: "https" };
const VERSION_MISMATCH: PrestoStatus = {
  available: false,
  reason: "version-mismatch",
  nativeAztecVersion: "4.0.0",
  protocol: "https",
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/**
 * A controller over a scripted browser. `permission` is what a read returns; a read taken while
 * `holdReads()` is active returns the value it saw at its start, once released.
 */
function harness(initial: LoopbackPermissionState) {
  let permission = initial;
  let gate: Promise<void> | null = null;
  const phases: ConnectionPhase[] = [];
  const authorizations: boolean[] = [];
  const checks: (PrestoStatusCheckOptions | undefined)[] = [];
  let answer: () => Promise<PrestoStatus> = async () => AVAILABLE;
  const controller = new PrestoStatusController({
    check: (options) => {
      checks.push(options);
      return answer();
    },
    permission: async () => {
      const seen = permission;
      if (gate) await gate;
      return seen;
    },
    render: (phase) => phases.push(phase),
    setPending: () => {},
    onAuthorizationChange: (authorized) => authorizations.push(authorized),
  });
  return {
    controller,
    phases,
    authorizations,
    checks,
    last: () => phases.at(-1),
    setPermission: (next: LoopbackPermissionState) => {
      permission = next;
    },
    answer: (next: PrestoStatus | (() => Promise<PrestoStatus>)) => {
      answer = typeof next === "function" ? next : async () => next;
    },
    holdReads: () => {
      const release = deferred<void>();
      gate = release.promise;
      return () => {
        gate = null;
        release.resolve();
      };
    },
  };
}

describe("prestoStatusView", () => {
  test("renders every unavailable reason without contradictory install UI", () => {
    const offline = prestoStatusView(OFFLINE);
    expect(offline.showInstall).toBe(true);

    for (const status of [
      { available: false, reason: "permission-blocked" },
      ERROR,
      VERSION_MISMATCH,
    ] satisfies PrestoStatus[]) {
      const view = prestoStatusView(status);
      expect(view.connected).toBe(false);
      expect(view.showInstall).toBe(false);
    }

    expect(
      prestoStatusView({ available: false, reason: "permission-blocked" }).showPermissionHelp,
    ).toBe(true);
  });

  test.each([
    ["https-disabled", "Encrypted Connection is disabled", false],
    ["tls-or-trust-failure", "Secure connection is not trusted", false],
    ["presto-reachable", "Presto is reachable", false],
    ["unconfirmed", "Secure connection unavailable", true],
  ] as const)("renders the %s secure recovery diagnosis", (diagnosis, title, showInstall) => {
    const view = prestoStatusView({
      available: false,
      reason: "secure-connection-unavailable",
      diagnosis,
    });
    expect(view.showSecureConnectionHelp).toBe(true);
    expect(view.showPermissionHelp).toBe(false);
    expect(view.secureConnectionTitle).toBe(title);
    expect(view.showInstall).toBe(showInstall);
  });
});

describe("connectionView", () => {
  const phases: ConnectionPhase[] = [
    { kind: "not-connected", permission: "prompt" },
    { kind: "blocked" },
    { kind: "checking", browserMayAsk: true },
    { kind: "awaiting-browser" },
    ...[AVAILABLE, OFFLINE, UNCONFIRMED, ERROR, VERSION_MISMATCH].flatMap((status) =>
      [false, true].map((unsupportedHint) => ({
        kind: "checked" as const,
        status,
        unsupportedHint,
      })),
    ),
  ];

  test("each phase offers exactly its own next step", () => {
    const notConnected = connectionView({ kind: "not-connected", permission: "unsupported" });
    expect(notConnected).toMatchObject({ showConnectLink: true, modeHint: "connect" });
    expect(connectionView({ kind: "blocked" })).toMatchObject({
      showPermissionHelp: true,
      showConnectLink: false,
      modeHint: "blocked",
    });
    expect(connectionView({ kind: "checking", browserMayAsk: true }).showMayAskHint).toBe(true);
    expect(connectionView({ kind: "checking", browserMayAsk: false }).showMayAskHint).toBe(false);
    expect(connectionView({ kind: "awaiting-browser" }).retryHelp).toContain("choose Allow");
    expect(
      connectionView({ kind: "checked", status: AVAILABLE, unsupportedHint: false }),
    ).toMatchObject({ connected: true, modeHint: "fastest", retryHelp: null });
  });

  test("an unreadable decision with no answer says couldn't connect, never not found", () => {
    const offline = connectionView({ kind: "checked", status: OFFLINE, unsupportedHint: true });
    expect(offline).toMatchObject({ label: "couldn't connect, in-browser", showInstall: true });
    expect(offline.retryHelp).toContain("allow it and try again");
    const unconfirmed = connectionView({
      kind: "checked",
      status: UNCONFIRMED,
      unsupportedHint: true,
    });
    expect(unconfirmed).toMatchObject({ showSecureConnectionHelp: true, retryHelp: null });
    expect(connectionView({ kind: "checked", status: OFFLINE, unsupportedHint: false }).label).toBe(
      "not found, in-browser",
    );
  });

  test("no rendered string names addresses or network jargon", () => {
    for (const phase of phases) {
      const view = connectionView(phase);
      const text = [
        view.label,
        view.log,
        view.modeHint,
        view.retryHelp,
        view.secureConnectionTitle,
        view.secureConnectionMessage,
      ].join(" ");
      expect(text).not.toMatch(/loopback|127\.0\.0\.1|localhost|local network|health check/i);
    }
  });
});

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: Suite registration is not production control flow.
describe("PrestoStatusController consent", () => {
  test("granted at load probes once; denied or undecided sends nothing", async () => {
    const granted = harness("granted");
    await granted.controller.start();
    expect(granted.checks).toHaveLength(1);
    expect(granted.authorizations).toEqual([true]);
    expect(granted.last()).toMatchObject({ kind: "checked", status: AVAILABLE });

    for (const [state, phase] of [
      ["denied", { kind: "blocked" }],
      ["prompt", { kind: "not-connected", permission: "prompt" }],
      ["unsupported", { kind: "not-connected", permission: "unsupported" }],
    ] as const) {
      const h = harness(state);
      await h.controller.start();
      expect(await h.controller.beforeProving()).toBe(false);
      expect(h.checks).toEqual([]);
      expect(h.authorizations).toEqual([]);
      expect(h.last()).toEqual(phase);
    }
  });

  test("Continue and Try again proceed on a prompt read; no answer waits for the browser", async () => {
    const h = harness("prompt");
    await h.controller.start();
    h.answer(OFFLINE);
    await h.controller.connect();
    expect(h.phases).toContainEqual({ kind: "checking", browserMayAsk: true });
    expect(h.last()).toEqual({ kind: "awaiting-browser" });

    // A proof before anyone answered stays in the browser and starts no detection.
    expect(await h.controller.beforeProving()).toBe(false);
    expect(h.checks).toHaveLength(1);

    await h.controller.connect();
    expect(h.checks).toHaveLength(2);
    expect(h.authorizations).toEqual([true]);

    // The next proof after a grant goes native, and the grant refreshes the row.
    h.setPermission("granted");
    h.answer(AVAILABLE);
    expect(await h.controller.beforeProving()).toBe(true);
    await tick();
    expect(h.checks).toHaveLength(3);
    expect(h.last()).toMatchObject({ kind: "checked", status: AVAILABLE });
  });

  test.each([
    ["available", AVAILABLE],
    ["error", ERROR],
    ["version-mismatch", VERSION_MISMATCH],
  ] as const)(
    "with a persistent prompt, a(n) %s answer is shown as itself and proofs proceed",
    async (_, status) => {
      const h = harness("prompt");
      await h.controller.start();
      h.answer(status);
      await h.controller.connect();
      expect(h.last()).toEqual({ kind: "checked", status, unsupportedHint: false });
      expect(await h.controller.beforeProving()).toBe(true);
      expect(h.checks).toHaveLength(1);
    },
  );

  test("an unreadable decision with no answer is checked with the hint", async () => {
    const h = harness("unsupported");
    await h.controller.start();
    h.answer(OFFLINE);
    await h.controller.connect();
    expect(h.last()).toEqual({ kind: "checked", status: OFFLINE, unsupportedHint: true });
    expect(await h.controller.beforeProving()).toBe(true);
  });

  test("a permission-blocked result revokes without a watcher event", async () => {
    const h = harness("prompt");
    await h.controller.start();
    h.answer({ available: false, reason: "permission-blocked" });
    await h.controller.connect();
    expect(h.last()).toEqual({ kind: "blocked" });
    expect(h.authorizations).toEqual([true, false]);
  });

  test("Retry while still denied stays blocked and sends nothing", async () => {
    const h = harness("denied");
    await h.controller.start();
    await h.controller.connect();
    expect(h.last()).toEqual({ kind: "blocked" });
    expect(h.checks).toEqual([]);
    expect(h.authorizations).toEqual([]);
  });

  test("a result that arrives after revocation is dropped", async () => {
    const h = harness("granted");
    const answer = deferred<PrestoStatus>();
    h.answer(() => answer.promise);
    const startup = h.controller.start();
    await tick();
    h.controller.permissionChanged("denied");
    answer.resolve(AVAILABLE);
    await startup;
    expect(h.last()).toEqual({ kind: "blocked" });
    expect(h.phases.some((phase) => phase.kind === "checked")).toBe(false);
  });

  test("a reset to prompt while a refresh is queued starts nothing", async () => {
    const h = harness("granted");
    const answer = deferred<PrestoStatus>();
    h.answer(() => answer.promise);
    const startup = h.controller.start();
    await tick();
    const queued = h.controller.refreshAfterPermissionChange();
    h.controller.permissionChanged("prompt");
    answer.resolve(OFFLINE);
    await startup;
    await queued;
    expect(h.checks).toHaveLength(1);
    expect(h.last()).toEqual({ kind: "not-connected", permission: "prompt" });
  });

  test("prompt after a seen grant revokes with no change event", async () => {
    const h = harness("granted");
    await h.controller.start();
    h.setPermission("prompt");
    expect(await h.controller.beforeProving()).toBe(false);
    expect(h.authorizations).toEqual([true, false]);
    expect(h.last()).toEqual({ kind: "not-connected", permission: "prompt" });
  });

  test("a grant after revocation restores Presto, by event or by a read before a proof", async () => {
    const byEvent = harness("granted");
    await byEvent.controller.start();
    byEvent.controller.permissionChanged("denied");
    byEvent.controller.permissionChanged("granted");
    await tick();
    expect(byEvent.authorizations).toEqual([true, false, true]);
    expect(byEvent.checks).toHaveLength(2);
    expect(await byEvent.controller.beforeProving()).toBe(true);

    const byRead = harness("granted");
    await byRead.controller.start();
    byRead.setPermission("prompt");
    expect(await byRead.controller.beforeProving()).toBe(false);
    byRead.setPermission("granted");
    expect(await byRead.controller.beforeProving()).toBe(true);
    expect(byRead.authorizations).toEqual([true, false, true]);
  });

  test("a click before the load-time read finishes is not overwritten by it", async () => {
    const h = harness("prompt");
    const release = h.holdReads();
    const click = h.controller.connect();
    const startup = h.controller.start();
    release();
    await Promise.all([click, startup]);
    expect(h.controller.authorized).toBe(true);
    expect(h.last()).toMatchObject({ kind: "checked", status: AVAILABLE });
  });

  test("a read before an early run does not stop the startup render", async () => {
    const h = harness("prompt");
    expect(await h.controller.beforeProving()).toBe(false);
    await h.controller.start();
    expect(h.phases).toEqual([{ kind: "not-connected", permission: "prompt" }]);
  });

  test("a click whose read raced a reset does not undo it", async () => {
    const h = harness("prompt");
    await h.controller.start();
    const release = h.holdReads();
    const click = h.controller.connect();
    h.controller.permissionChanged("granted");
    h.controller.permissionChanged("prompt");
    release();
    await click;
    await tick();
    expect(h.controller.authorized).toBe(false);
    expect(h.checks).toEqual([]);
    expect(h.last()).toEqual({ kind: "not-connected", permission: "prompt" });
  });

  test("a read that predates a status-driven block cannot re-authorize", async () => {
    const h = harness("granted");
    await h.controller.start();
    const blocked = deferred<PrestoStatus>();
    h.answer(() => blocked.promise);
    const retry = h.controller.retrySecureConnection();
    await tick();
    const release = h.holdReads();
    const proof = h.controller.beforeProving();
    blocked.resolve({ available: false, reason: "permission-blocked" });
    await retry;
    release();
    expect(await proof).toBe(false);
    await tick();
    expect(h.checks).toHaveLength(2);
    expect(h.last()).toEqual({ kind: "blocked" });
  });

  test.each(["denied", "prompt"] as const)(
    "a late startup read that sees a %s after an early Connect revokes for every overlapping read",
    async (state) => {
      const h = harness("granted");
      await h.controller.connect();
      h.setPermission(state);
      const release = h.holdReads();
      const startup = h.controller.start();
      const proof = h.controller.beforeProving();
      release();
      await startup;
      expect(await proof).toBe(false);
      expect(h.controller.authorized).toBe(false);
      expect(h.checks).toHaveLength(1);
    },
  );

  test("a grant read by a startup that yields still marks a later prompt as a reset", async () => {
    const h = harness("prompt");
    await h.controller.connect();
    h.setPermission("granted");
    await h.controller.start();
    await tick();
    h.setPermission("prompt");
    expect(await h.controller.beforeProving()).toBe(false);
    expect(h.controller.authorized).toBe(false);
  });

  test("Retry after the site went from blocked to ask connects", async () => {
    const h = harness("denied");
    await h.controller.start();
    h.setPermission("prompt");
    await h.controller.connect();
    expect(h.authorizations).toEqual([true]);
    expect(h.checks).toHaveLength(1);
  });

  test("a settlement that lost the row to a newer refresh still applies the block it read", async () => {
    const reads: ReturnType<typeof deferred<LoopbackPermissionState>>[] = [];
    const checks: ReturnType<typeof deferred<PrestoStatus>>[] = [];
    const controller = new PrestoStatusController({
      check: () => {
        checks.push(deferred<PrestoStatus>());
        return checks.at(-1)!.promise;
      },
      permission: () => {
        reads.push(deferred<LoopbackPermissionState>());
        return reads.at(-1)!.promise;
      },
      render: () => {},
      setPending: () => {},
      onAuthorizationChange: () => {},
    });
    controller.permissionChanged("granted");
    await tick();
    reads[0]!.resolve("granted");
    await tick();
    void controller.refresh({ forceRefresh: true });
    // A's inconclusive answer lands between B's read being recorded and B claiming the row.
    reads[1]!.resolve("granted");
    checks[0]!.resolve(OFFLINE);
    await tick();
    expect(reads).toHaveLength(3);
    expect(checks).toHaveLength(2);

    const proof = controller.beforeProving();
    reads[2]!.resolve("denied");
    reads[3]!.resolve("granted");
    expect(await proof).toBe(false);
    expect(controller.authorized).toBe(false);
  });

  test("every refresh re-reads: a reset nobody reported stops it before any request", async () => {
    const h = harness("granted");
    await h.controller.start();
    h.setPermission("prompt");
    h.controller.refreshAfterFallback();
    await h.controller.retrySecureConnection();
    await tick();
    expect(h.checks).toHaveLength(1);
    expect(h.controller.authorized).toBe(false);
    expect(h.last()).toEqual({ kind: "not-connected", permission: "prompt" });
  });

  test("a reported change during the read before a proof wins over the read", async () => {
    const h = harness("granted");
    await h.controller.start();
    const release = h.holdReads();
    const proof = h.controller.beforeProving();
    h.controller.permissionChanged("denied");
    release();
    expect(await proof).toBe(false);
    expect(h.controller.authorized).toBe(false);
    expect(h.last()).toEqual({ kind: "blocked" });
  });
});

describe("PrestoStatusController refreshes", () => {
  test("a stale result cannot overwrite a newer forced refresh", async () => {
    const h = harness("granted");
    const first = deferred<PrestoStatus>();
    let calls = 0;
    h.answer(() => (++calls === 1 ? first.promise : Promise.resolve(AVAILABLE)));
    const startup = h.controller.start();
    await tick();
    await h.controller.refresh({ forceRefresh: true });
    first.resolve(OFFLINE);
    await startup;

    const checked = h.phases.filter((phase) => phase.kind === "checked");
    expect(checked).toEqual([{ kind: "checked", status: AVAILABLE, unsupportedHint: false }]);
    expect(h.controller.displayed).toEqual(AVAILABLE);
  });

  test("proof fallback refresh is coalesced and only starts after available was displayed", async () => {
    const h = harness("granted");
    const later = deferred<PrestoStatus>();
    let calls = 0;
    h.answer(() => (++calls === 1 ? Promise.resolve(AVAILABLE) : later.promise));

    h.controller.refreshAfterFallback();
    expect(h.checks).toHaveLength(0);
    await h.controller.start();
    h.controller.refreshAfterFallback();
    h.controller.refreshAfterFallback();
    await tick();
    expect(h.checks).toHaveLength(2);
    later.resolve(OFFLINE);
  });

  test("a grant waits out the old SDK single-flight before forcing a fresh probe", async () => {
    const h = harness("prompt");
    await h.controller.start();
    const first = deferred<PrestoStatus>();
    let calls = 0;
    h.answer(() => (++calls === 1 ? first.promise : Promise.resolve(AVAILABLE)));
    const click = h.controller.connect();
    await tick();
    h.setPermission("granted");
    h.controller.permissionChanged("granted");
    await tick();
    expect(h.checks).toHaveLength(1);

    first.resolve(OFFLINE);
    await click;
    await tick();
    expect(h.checks).toEqual([{ forceRefresh: true }, { forceRefresh: true }]);
    const checked = h.phases.filter((phase) => phase.kind === "checked");
    expect(checked).toEqual([{ kind: "checked", status: AVAILABLE, unsupportedHint: false }]);
  });

  test("duplicate secure retry clicks share one forced refresh", async () => {
    const h = harness("granted");
    await h.controller.start();
    const gate = deferred<PrestoStatus>();
    h.answer(() => gate.promise);
    const first = h.controller.retrySecureConnection();
    expect(h.controller.retrySecureConnection()).toBe(first);
    gate.resolve(OFFLINE);
    await first;
    expect(h.checks).toEqual([undefined, { forceRefresh: true }]);
  });
});

describe("httpSessionConsent", () => {
  function consent(overrides: { configure?: () => void; refresh?: () => Promise<void> }) {
    const openStates: boolean[] = [];
    const pendingStates: boolean[] = [];
    const announcements: string[] = [];
    const controller = httpSessionConsent({
      configure: overrides.configure ?? (() => {}),
      refresh: overrides.refresh ?? (async () => {}),
      setOpen: (open) => openStates.push(open),
      setPending: (pending) => pendingStates.push(pending),
      announce: (message) => announcements.push(message),
    });
    return { controller, openStates, pendingStates, announcements };
  }

  test("cancellation leaves HTTPS-only configuration untouched", async () => {
    let configured = 0;
    const { controller, openStates, announcements } = consent({ configure: () => configured++ });

    controller.request();
    controller.cancel();
    await controller.confirm();

    expect(openStates).toEqual([true, false]);
    expect(configured).toBe(0);
    expect(announcements.at(-1)).toContain("HTTPS-only proving remains enabled");
  });

  test("confirmation configures once, force-refreshes once, and announces accessibly", async () => {
    let configured = 0;
    let refreshed = 0;
    const gate = deferred<void>();
    const { controller, openStates, pendingStates, announcements } = consent({
      configure: () => configured++,
      refresh: async () => {
        refreshed++;
        await gate.promise;
      },
    });

    controller.request();
    const first = controller.confirm();
    expect(controller.confirm()).toBe(first);
    await tick();
    expect(configured).toBe(1);
    expect(refreshed).toBe(1);
    gate.resolve();
    await first;

    expect(openStates).toEqual([true, false]);
    expect(pendingStates).toEqual([true, false]);
    expect(announcements[0]).toContain("this tab");
    expect(announcements.at(-1)).toContain("this tab only");
  });

  test("a failed refresh or configuration says which, and clears pending state", async () => {
    const refreshFails = consent({
      refresh: async () => {
        throw new Error("refresh failed");
      },
    });
    refreshFails.controller.request();
    await expect(refreshFails.controller.confirm()).rejects.toThrow("refresh failed");
    expect(refreshFails.pendingStates).toEqual([true, false]);
    expect(refreshFails.announcements.at(-1)).toContain("HTTP is allowed for this tab");

    const configureFails = consent({
      configure: () => {
        throw new Error("configuration failed");
      },
    });
    configureFails.controller.request();
    await expect(configureFails.controller.confirm()).rejects.toThrow("configuration failed");
    expect(configureFails.announcements.at(-1)).toContain("HTTP was not enabled");
  });
});

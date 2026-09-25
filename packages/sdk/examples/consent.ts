import {
  type LoopbackPermissionState,
  loopbackPermission,
  type PrestoProver,
  type PrestoStatus,
  watchLoopbackPermission,
} from "@alejoamiras/presto";

/** "ask": offer Connect. "blocked": explain how to allow this site again. Otherwise a status check. */
export type PrestoView = "ask" | "blocked" | PrestoStatus;

/**
 * Keeps `prover` away from Presto until the visitor opts in, and reports what to show. Call
 * `connect()` only from a click that first says the browser may ask to let this site reach apps on
 * this device, and `beforeProving()` before each proof.
 */
export async function askBeforeConnecting(prover: PrestoProver, show: (view: PrestoView) => void) {
  prover.setForceLocal(true); // before the first await, so no proof goes native while this starts
  let consented = false; // the visitor clicked Connect, or the browser reports "granted"
  let granted = false; // "granted" seen since then, so a later "prompt" means it was reset
  let epoch = 0; // bumped on revocation: a check that started earlier is dropped

  /** Follows the browser's decision. Returns true for a grant not seen before, which needs a check. */
  function apply(state: LoopbackPermissionState): boolean {
    const newGrant = state === "granted" && !granted;
    if (state === "granted") consented = granted = true;
    else if (state === "denied" || (state === "prompt" && granted)) {
      if (consented) epoch++;
      consented = granted = false;
    }
    prover.setForceLocal(!consented);
    if (!consented) show(state === "denied" ? "blocked" : "ask");
    return newGrant;
  }

  let lastCheck: Promise<void> = Promise.resolve();
  function check() {
    lastCheck = (async () => {
      const started = epoch;
      const status = await prover.checkPrestoStatus({ forceRefresh: true }); // the browser may ask now
      if (epoch !== started) return;
      apply(await loopbackPermission()); // records the answer given at the prompt
      if (epoch === started && consented) show(status);
    })();
    return lastCheck;
  }

  async function sync(state: LoopbackPermissionState) {
    if (!apply(state)) return;
    await lastCheck; // a forced check joins a probe already in flight, whose answer predates this grant
    if (consented) await check(); // allowed earlier, in site settings, or in another tab
  }

  async function connect() {
    const state = await loopbackPermission(); // never prompts, never contacts Presto
    if (state === "denied") return void apply(state);
    consented = true;
    granted = state === "granted";
    await check();
  }

  /** Catches a reset or a grant in browsers that report no changes. */
  const beforeProving = async () => sync(await loopbackPermission());

  const stop = await watchLoopbackPermission((state) => void sync(state));
  await sync(await loopbackPermission());
  return { connect, beforeProving, stop };
}

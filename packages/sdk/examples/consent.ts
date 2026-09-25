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
  let epoch = 0; // bumped on revocation: a check that started earlier is never shown
  let decisions = 0; // bumped per decision taken: a permission read that started earlier is stale

  /** The stored decision, or null when a newer one was taken while reading. Never prompts. */
  async function read(): Promise<LoopbackPermissionState | null> {
    const started = decisions;
    const state = await loopbackPermission();
    return started === decisions ? state : null;
  }

  /** Follows the browser's decision. Returns true for a grant not seen before, which needs a check. */
  function apply(state: LoopbackPermissionState): boolean {
    decisions++;
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

  async function check() {
    const started = epoch;
    const status = await prover.checkPrestoStatus({ forceRefresh: true }); // the browser may ask now
    const state = await read(); // records the answer given at the prompt
    if (state) apply(state);
    if (epoch === started && consented) show(status);
  }

  async function sync(state: LoopbackPermissionState | null) {
    if (state && apply(state)) await check(); // allowed earlier, in site settings, or in another tab
  }

  async function connect() {
    // The click is itself the newest decision; a stale read here can only reach the browser's own gate.
    const state = await loopbackPermission();
    if (state === "denied") return void apply(state);
    decisions++;
    consented = true;
    granted = state === "granted";
    await check();
  }

  /** Catches a reset or a grant in browsers that report no changes. */
  const beforeProving = async () => sync(await read());

  const stop = await watchLoopbackPermission((state) => void sync(state));
  await sync(await read());
  return { connect, beforeProving, stop };
}

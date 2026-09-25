import {
  loopbackPermission,
  type PrestoProver,
  type PrestoStatus,
  watchLoopbackPermission,
} from "@alejoamiras/presto";

/**
 * Keeps `prover` away from Presto until the visitor opts in. Call `connect()` only from a click
 * that first says the browser may ask to let this site reach apps on this device.
 */
export async function askBeforeConnecting(
  prover: PrestoProver,
  onStatus: (status: PrestoStatus | "blocked") => void,
) {
  prover.setForceLocal(true); // proofs stay in the browser until the visitor connects
  let allowed = false; // the browser has reported "granted" at least once

  async function read() {
    const state = await loopbackPermission(); // never prompts, never contacts Presto
    if (state === "granted") allowed = true;
    return state;
  }

  async function connect() {
    if ((await read()) === "denied") return onStatus("blocked"); // explain how to allow it again
    prover.setForceLocal(false);
    onStatus(await prover.checkPrestoStatus({ forceRefresh: true })); // the browser may ask now
  }

  /** Before each proof: catches a reset in browsers that never report changes. */
  async function beforeProving() {
    const state = await read();
    if (state === "denied" || (state === "prompt" && allowed)) prover.setForceLocal(true);
  }

  // Allowed late, in site settings or in another tab: connect. Blocked or reset: local again.
  const stop = await watchLoopbackPermission((state) => {
    if (state === "granted") void connect();
    else prover.setForceLocal(true);
  });

  // A returning visitor who already allowed it connects with no click, and no prompt is possible.
  if ((await read()) === "granted") await connect();
  return { connect, beforeProving, stop };
}

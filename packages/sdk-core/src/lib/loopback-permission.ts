/**
 * This site's stored Local Network Access decision for reaching apps on this device, Presto
 * included. `unsupported`: the browser exposes no readable decision, so a first request may or may
 * not prompt.
 */
export type LoopbackPermissionState = "granted" | "prompt" | "denied" | "unsupported";

type LoopbackPermissionName = "loopback-network" | "local-network-access";
type LoopbackPermissionStatus = {
  readonly state: PermissionState;
  addEventListener?(type: "change", listener: () => void): void;
  removeEventListener?(type: "change", listener: () => void): void;
};
type LoopbackPermissions = {
  query(descriptor: { name: LoopbackPermissionName }): Promise<LoopbackPermissionStatus>;
};

/**
 * Reads `navigator.permissions` on every call, never at import. The umbrella `local-network-access`
 * name is tried only when the browser rejects `loopback-network` itself.
 */
async function queryLoopbackPermission(): Promise<LoopbackPermissionStatus | undefined> {
  let permissions: LoopbackPermissions | undefined;
  try {
    if (typeof navigator === "undefined") return undefined;
    permissions = navigator.permissions as unknown as LoopbackPermissions | undefined;
    if (!permissions || typeof permissions.query !== "function") return undefined;
  } catch {
    return undefined;
  }
  try {
    return await permissions.query({ name: "loopback-network" });
  } catch {
    try {
      return await permissions.query({ name: "local-network-access" });
    } catch {
      return undefined;
    }
  }
}

function toState(state: unknown): LoopbackPermissionState {
  return state === "granted" || state === "prompt" || state === "denied" ? state : "unsupported";
}

/**
 * The stored decision, read without prompting and without contacting Presto. Gate the first status
 * check or proof on it: only `granted` may connect on page load; anything else waits for a user
 * action that explains the browser's question. Never throws.
 */
export async function loopbackPermission(): Promise<LoopbackPermissionState> {
  const status = await queryLoopbackPermission();
  return status ? toState(status.state) : "unsupported";
}

/**
 * Calls `onChange` when the stored decision changes: a prompt answered after a check gave up, a
 * site-settings edit, or a decision made in another tab of the same site. Never prompts and never
 * contacts Presto. Resolves to an unsubscribe, which is a no-op where changes cannot be observed, so
 * re-read {@link loopbackPermission} before each proof rather than relying on this alone.
 */
export async function watchLoopbackPermission(
  onChange: (state: Exclude<LoopbackPermissionState, "unsupported">) => void,
): Promise<() => void> {
  const status = await queryLoopbackPermission();
  if (
    !status ||
    typeof status.addEventListener !== "function" ||
    typeof status.removeEventListener !== "function"
  ) {
    return () => {};
  }
  let last = status.state;
  const listener = () => {
    if (status.state === last) return;
    last = status.state;
    const next = toState(last);
    if (next !== "unsupported") onChange(next);
  };
  status.addEventListener("change", listener);
  return () => status.removeEventListener?.("change", listener);
}

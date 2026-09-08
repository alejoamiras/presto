/** Dismissal record: hide until this epoch-ms, or forever (the Sheet's "Don't ask again"). */
type Dismissal = { until: number | "never" };

export const DAY_MS = 86_400_000;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // Some browsers throw on access when site data is blocked.
    return null;
  }
}

function read(key: string): Dismissal | null {
  try {
    const raw = storage()?.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || !("until" in parsed)) return null;
    const until = (parsed as { until: unknown }).until;
    return until === "never" || typeof until === "number" ? { until } : null;
  } catch {
    return null;
  }
}

/** Whether a prior dismissal still suppresses this key. A corrupt or unreadable record never does. */
export function isDismissed(key: string, now = Date.now()): boolean {
  const record = read(key);
  if (!record) return false;
  return record.until === "never" || record.until > now;
}

/** Record a dismissal for `days` (default 7) or forever. Silently no-ops without storage. */
export function dismiss(key: string, options: { days?: number; forever?: boolean } = {}): void {
  const until: Dismissal["until"] = options.forever
    ? "never"
    : Date.now() + (options.days ?? 7) * DAY_MS;
  try {
    storage()?.setItem(key, JSON.stringify({ until }));
  } catch {
    // Quota or privacy mode: the banner simply shows again next time.
  }
}

export function clearDismissal(key: string): void {
  try {
    storage()?.removeItem(key);
  } catch {
    // Nothing to clear.
  }
}

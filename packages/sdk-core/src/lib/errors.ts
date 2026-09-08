/**
 * The one typed error a prove route can surface. The presto is an optimisation, so a client degrades
 * to its local prover for every RECOGNISED condition — EVERY `403` (denial / version / cooldown),
 * EVERY `404`/`408`/`413`/`429`/`503`, and `500 download_failed`/`prove_failed` — and an unknown
 * `403`/`503` code still degrades. What must NOT be masked is a caller MISCONFIGURATION: a `400
 * invalid_version` / `invalid_origin`, a `500` with an unrecognised code, or a status the client does
 * not recognise. Falling back there would hide a real integration bug behind "slow but working", so
 * those, and only those, reach the dApp as this error.
 */
export class PrestoHttpError extends Error {
  /** HTTP status the presto returned. */
  readonly status: number;
  /** The stable server error code (e.g. `invalid_version`), when the body carried one. */
  readonly code?: string;

  constructor(status: number, code?: string, serverMessage?: string) {
    super(
      serverMessage ??
        `The Presto rejected the request with HTTP ${status}${
          code ? ` (${code})` : ""
        }. This usually means the SDK is misconfigured for this presto.`,
    );
    this.name = "PrestoHttpError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Recover the server's stable error `code` (and human `message`) from a transport error's bounded
 * pre-read body. The presto returns its error body as `text/plain` carrying a JSON string (pinned
 * by the Rust test `prove_error_responses_stay_text_plain`), so the pre-read parses to a STRING — the
 * code must be `JSON.parse`d out of it. (A JSON content-type instead gives an object; both shapes are
 * handled so tests using `Response.json(...)` and production `text/plain` agree. An unreadable body
 * gives `undefined` → `{}` here — the HTTP status still governs classification.)
 */
export function parseServerError(data: unknown): { code?: string; message?: string } {
  let obj: { error?: unknown; message?: unknown } | undefined;
  if (typeof data === "string") {
    try {
      obj = JSON.parse(data);
    } catch {
      return {};
    }
  } else if (data && typeof data === "object") {
    obj = data as { error?: unknown; message?: unknown };
  }
  if (!obj) return {};
  return {
    code: typeof obj.error === "string" ? obj.error : undefined,
    message: typeof obj.message === "string" ? obj.message : undefined,
  };
}

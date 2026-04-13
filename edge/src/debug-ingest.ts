/**
 * Optional Cursor debug NDJSON ingest. When `DEBUG_INGEST_URL` is unset, posts are skipped — the edge agent
 * often runs on a Pi with no route to a dev-machine ingest server, so there is no default localhost URL.
 */
const DEFAULT_DEBUG_SESSION_ID = "5044f5";

function resolveDebugSessionId(): string {
  const raw = process.env.DEBUG_SESSION_ID?.trim();
  return raw && raw.length > 0 ? raw : DEFAULT_DEBUG_SESSION_ID;
}

/** Fire-and-forget POST when `DEBUG_INGEST_URL` is set; otherwise no-op. */
export function postDebugIngest(payload: {
  location: string;
  message: string;
  hypothesisId: string;
  data?: Record<string, unknown>;
}): void {
  const raw = process.env.DEBUG_INGEST_URL?.trim();
  if (!raw) return;

  const url = raw.replace(/\/$/, "");
  const sessionId = resolveDebugSessionId();
  const body = {
    sessionId,
    ...payload,
    timestamp: Date.now(),
  };
  fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": sessionId,
    },
    body: JSON.stringify(body),
  }).catch(() => {});
}

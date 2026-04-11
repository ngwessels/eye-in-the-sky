import { log } from "./logger.js";

// #region agent log
/** Debug-mode NDJSON ingest (localhost) + line logs for devices without the ingest server (e.g. Pi → journalctl). */
export function sessionDebug(
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown>,
): void {
  const payload = {
    sessionId: "35c6a8",
    hypothesisId,
    location,
    message,
    data,
    timestamp: Date.now(),
  };
  fetch("http://127.0.0.1:7932/ingest/c5819765-bc3d-4bb6-91da-21204e2311a3", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "35c6a8",
    },
    body: JSON.stringify(payload),
  }).catch(() => {});
  log.info(`[dbg ${hypothesisId}] ${message}`, { ...data, _loc: location });
  // #endregion
}

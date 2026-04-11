import fs from "node:fs";
import { log } from "./logger.js";
import { EDGE_DEBUG_NDJSON } from "./debug-log-path.js";

/** Cursor debug ingest on the same machine as the agent; on a Pi this is the Pi’s loopback, not your laptop. */
const DEFAULT_DEBUG_INGEST =
  "http://127.0.0.1:7932/ingest/c5819765-bc3d-4bb6-91da-21204e2311a3";

function resolveDebugIngestUrl(): string | null {
  const raw = process.env.DEBUG_INGEST_URL?.trim();
  if (raw === "0" || raw === "off" || raw === "false") return null;
  return raw || DEFAULT_DEBUG_INGEST;
}

// #region agent log
/** Debug-mode: NDJSON file on disk (Pi-safe) + optional HTTP ingest + logger. */
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
  try {
    fs.appendFileSync(EDGE_DEBUG_NDJSON, `${JSON.stringify(payload)}\n`);
  } catch {
    /* ignore */
  }
  const ingestUrl = resolveDebugIngestUrl();
  if (ingestUrl) {
    fetch(ingestUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "35c6a8",
      },
      body: JSON.stringify(payload),
    }).catch(() => {});
  }
  try {
    log.info(`[dbg ${hypothesisId}] ${message}`, { ...data, _loc: location });
  } catch {
    /* ignore */
  }
  try {
    process.stderr.write(`[eye-edge-dbg] ${hypothesisId} ${message} ${JSON.stringify(data)}\n`);
  } catch {
    /* ignore */
  }
  // #endregion
}

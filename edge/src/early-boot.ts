import fs from "node:fs";
import { EDGE_DEBUG_NDJSON } from "./debug-log-path.js";

// #region agent log
try {
  fs.appendFileSync(
    EDGE_DEBUG_NDJSON,
    `${JSON.stringify({
      sessionId: "35c6a8",
      hypothesisId: "BOOT",
      location: "early-boot.ts",
      message: "before config import (if this file is missing, index never reached early-boot)",
      data: {},
      timestamp: Date.now(),
    })}\n`,
  );
} catch {
  /* ignore */
}
// #endregion

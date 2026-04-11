import { join } from "node:path";
import { tmpdir } from "node:os";

/** Writable on Pi/Linux/macOS; `cat "$(node -e \"console.log(require('os').tmpdir())\")/eye-edge-debug-35c6a8.ndjson"` */
export const EDGE_DEBUG_NDJSON = join(tmpdir(), "eye-edge-debug-35c6a8.ndjson");

import fs from "node:fs";

function formatLine(level: string, msg: string, meta?: Record<string, unknown>): string {
  const ts = new Date().toISOString();
  const metaStr = meta && Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
  return `[${ts}] [eye-edge] [${level}] ${msg}${metaStr}\n`;
}

/** Line-oriented logs via sync writes so output shows up under systemd, npm, and non-TTY pipes. */
export const log = {
  info(msg: string, meta?: Record<string, unknown>) {
    try {
      fs.writeSync(1, formatLine("info", msg, meta));
    } catch {
      console.log(msg, meta ?? "");
    }
  },

  warn(msg: string, meta?: Record<string, unknown>) {
    try {
      fs.writeSync(2, formatLine("warn", msg, meta));
    } catch {
      console.warn(msg, meta ?? "");
    }
  },

  error(msg: string, meta?: Record<string, unknown>) {
    try {
      fs.writeSync(2, formatLine("error", msg, meta));
    } catch {
      console.error(msg, meta ?? "");
    }
  },
};

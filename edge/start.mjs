import fs from "node:fs";

const ts = new Date().toISOString();
try {
  fs.writeSync(1, `[${ts}] [eye-edge] process started (loading dist/index.js)\n`);
} catch {
  // ignore
}

await import("./dist/index.js");

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { MOCK_JPEG } from "./camera-mock.js";

const execFileAsync = promisify(execFile) as (
  file: string,
  args: readonly string[] | undefined,
  options: { encoding: "buffer"; maxBuffer?: number; timeout?: number },
) => Promise<{ stdout: Buffer; stderr: Buffer }>;

/**
 * JPEG bytes for upload: either `CAPTURE_STILL_CMD` (shell; must write JPEG to stdout) or the built-in 1×1 mock.
 *
 * Example (Pi): `libcamera-still -e jpeg -n --immediate --width 1280 --height 720 -o -`
 */
export async function getJpegForUpload(): Promise<Buffer> {
  const cmd = process.env.CAPTURE_STILL_CMD?.trim();
  if (!cmd) {
    return MOCK_JPEG;
  }

  const { stdout } = await execFileAsync("sh", ["-c", cmd], {
    encoding: "buffer",
    maxBuffer: 40 * 1024 * 1024,
    timeout: 120_000,
  });

  if (!stdout.length) {
    throw new Error("CAPTURE_STILL_CMD produced empty stdout; expected JPEG bytes on stdout");
  }

  return stdout;
}

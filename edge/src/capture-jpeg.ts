import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { MOCK_JPEG } from "./camera-mock.js";

const execFileAsync = promisify(execFile) as (
  file: string,
  args: readonly string[] | undefined,
  options: { encoding: "buffer"; maxBuffer?: number; timeout?: number },
) => Promise<{ stdout: Buffer; stderr: Buffer }>;

async function jpegFromShell(cmd: string): Promise<Buffer> {
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

/**
 * Real still: requires `CAPTURE_STILL_CMD` (shell; JPEG bytes on stdout). Used when `MOCK_CAMERA=0`.
 *
 * Example (Pi): `libcamera-still -e jpeg -n --immediate --width 1280 --height 720 -o -`
 */
export async function getJpegForRealCamera(): Promise<Buffer> {
  const cmd = process.env.CAPTURE_STILL_CMD?.trim();
  if (!cmd) {
    throw new Error(
      "MOCK_CAMERA=0 requires CAPTURE_STILL_CMD in edge/.env — a shell command that writes a JPEG to stdout. " +
        "Example: libcamera-still -e jpeg -n --immediate --width 1280 --height 720 -o -",
    );
  }
  return jpegFromShell(cmd);
}

/**
 * Test / pipeline checks: uses `CAPTURE_STILL_CMD` if set, otherwise the tiny built-in mock JPEG.
 */
export async function getJpegForUpload(): Promise<Buffer> {
  const cmd = process.env.CAPTURE_STILL_CMD?.trim();
  if (!cmd) {
    return MOCK_JPEG;
  }
  return jpegFromShell(cmd);
}

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "./config.js";
import { MOCK_JPEG } from "./camera-mock.js";

const execFileAsync = promisify(execFile) as (
  file: string,
  args: readonly string[] | undefined,
  options: { encoding: "buffer"; maxBuffer?: number; timeout?: number },
) => Promise<{ stdout: Buffer; stderr: Buffer }>;

const CAPTURE_CLI_HINT =
  "Install tools: sudo apt update && sudo apt install -y libcamera-apps " +
  "(then try `rpicam-still` or `libcamera-still`; on older OS use `raspistill` from libraspberrypi-bin). " +
  "Check: command -v rpicam-still libcamera-still raspistill";

async function jpegFromShell(cmd: string): Promise<Buffer> {
  try {
    const { stdout } = await execFileAsync("sh", ["-c", cmd], {
      encoding: "buffer",
      maxBuffer: 40 * 1024 * 1024,
      timeout: 120_000,
    });

    if (!stdout.length) {
      throw new Error("CAPTURE_STILL_CMD produced empty stdout; expected JPEG bytes on stdout");
    }

    return stdout;
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stderr?: Buffer; status?: number };
    const code = typeof err.code === "number" ? err.code : err.status;
    const stderr = err.stderr ? err.stderr.toString("utf8") : "";
    const notFound =
      code === 127 ||
      /not found/i.test(stderr) ||
      /No such file or directory/i.test(err.message ?? "");
    if (notFound) {
      throw new Error(
        `CAPTURE_STILL_CMD failed: camera CLI missing from PATH (e.g. libcamera-still: not found). ${CAPTURE_CLI_HINT}`,
      );
    }
    throw e;
  }
}

/**
 * Real still: requires `CAPTURE_STILL_CMD` (shell; JPEG bytes on stdout). Used when `MOCK_CAMERA=0`.
 *
 * Example (Pi): `rpicam-still` or `libcamera-still` … `-o -` (see edge/.env.example).
 */
export async function getJpegForRealCamera(): Promise<Buffer> {
  const cmd = process.env.CAPTURE_STILL_CMD?.trim();
  if (!cmd) {
    throw new Error(
      "MOCK_CAMERA=0 requires CAPTURE_STILL_CMD in edge/.env — shell command that writes JPEG to stdout. " +
        "Example: rpicam-still -e jpeg -n --immediate --width 1280 --height 720 -o -",
    );
  }
  return jpegFromShell(cmd);
}

/**
 * Used by `test-pan-tilt-capture`: same rules as the agent — if `MOCK_CAMERA=0`, requires
 * `CAPTURE_STILL_CMD` (no silent fallback to the tiny mock JPEG).
 */
export async function getJpegForUpload(): Promise<Buffer> {
  const cmd = process.env.CAPTURE_STILL_CMD?.trim();
  if (cmd) {
    return jpegFromShell(cmd);
  }
  if (!config.mockCamera) {
    return getJpegForRealCamera();
  }
  return MOCK_JPEG;
}

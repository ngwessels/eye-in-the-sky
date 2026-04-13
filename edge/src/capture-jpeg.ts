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

let warnedAboutImmediateAf = false;

function maybeWarnImmediateWithoutAf(baseCmd: string) {
  if (warnedAboutImmediateAf) return;
  if (!/\b--immediate\b/.test(baseCmd)) return;
  if (/\b--autofocus-on-capture\b/.test(baseCmd) || /\b--autofocus\b/.test(baseCmd)) return;
  warnedAboutImmediateAf = true;
  console.warn(
    "[edge] CAPTURE_STILL_CMD uses --immediate without --autofocus-on-capture / --autofocus. " +
      "AF cameras (e.g. Arducam 64MP) often look blurry — remove --immediate, add -t 6000 --autofocus-on-capture, " +
      "and raise --width/--height. See edge/.env.example.",
  );
}

function hasExplicitQuality(cmd: string): boolean {
  return /(^|\s)-q(?:\s+|=)\d/.test(cmd) || /(^|\s)--quality(?:\s+|=)\d/.test(cmd);
}

/**
 * Appends `-q N` for rpicam / libcamera / raspistill when the command does not already set quality.
 * - Unset env → default **96** (high quality, larger files than rpicam’s ~93 default).
 * - `CAPTURE_JPEG_QUALITY=none` or `off` → do not append (you control quality inside CAPTURE_STILL_CMD).
 * - `1`…`100` → append that value.
 */
function parseJpegQualityForAppend(): number | null {
  const raw = process.env.CAPTURE_JPEG_QUALITY?.trim();
  if (raw === undefined || raw === "") return 96;
  const lower = raw.toLowerCase();
  if (lower === "off" || lower === "none") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1 || n > 100) return 96;
  return Math.round(n);
}

function buildCaptureShellCommand(baseCmd: string): string {
  const base = baseCmd.trim();
  if (!base) return base;
  maybeWarnImmediateWithoutAf(base);
  const q = parseJpegQualityForAppend();
  if (q === null || hasExplicitQuality(base)) return base;
  return `${base} -q ${q}`;
}

function buildDefaultCaptureShellCommand(): string {
  const base = process.env.CAPTURE_STILL_CMD?.trim() ?? "";
  return buildCaptureShellCommand(base);
}

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
    const stderr =
      (err.stderr ? err.stderr.toString("utf8") : "") + (err.message ?? "");
    const notFound =
      code === 127 ||
      /not found/i.test(stderr) ||
      /No such file or directory/i.test(err.message ?? "");
    if (notFound) {
      throw new Error(
        `CAPTURE_STILL_CMD failed: camera CLI missing from PATH (e.g. libcamera-still: not found). ${CAPTURE_CLI_HINT}`,
      );
    }
    if (/invalid encoding format/i.test(stderr)) {
      throw new Error(
        "CAPTURE_STILL_CMD: `rpicam-still` only accepts `-e jpg` (not `jpeg`); default encoding is already jpg so you can omit `-e`. " +
          "Example: rpicam-still -e jpg -n --immediate --width 1280 --height 720 -o -",
      );
    }
    throw e;
  }
}

/**
 * Real still: requires `CAPTURE_STILL_CMD` (shell; JPEG bytes on stdout). Default unless `MOCK_CAMERA=1`.
 *
 * Example (Pi): `rpicam-still` or `libcamera-still` … `-o -` (see edge/.env.example).
 */
export async function getJpegForRealCamera(): Promise<Buffer> {
  const cmd = buildDefaultCaptureShellCommand();
  if (!cmd) {
    throw new Error(
      "Set CAPTURE_STILL_CMD in edge/.env — shell command that writes JPEG to stdout " +
        "(or set MOCK_CAMERA=1 for a tiny test JPEG only). " +
        "Example: rpicam-still -e jpg -n --immediate --width 1280 --height 720 -o -",
    );
  }
  return jpegFromShell(cmd);
}

/**
 * Omni / multi-camera adapter: `CAPTURE_STILL_CMD_TEMPLATE` must contain `{{INDEX}}` (libcamera `--camera` index).
 * Quality suffix behavior matches `CAPTURE_STILL_CMD`.
 */
export async function getJpegForRealCameraAtIndex(cameraIndex: number): Promise<Buffer> {
  const tpl = process.env.CAPTURE_STILL_CMD_TEMPLATE?.trim() ?? "";
  if (!tpl || !tpl.includes("{{INDEX}}")) {
    throw new Error(
      "Set CAPTURE_STILL_CMD_TEMPLATE with literal {{INDEX}} for omni capture, e.g. " +
        "`rpicam-still -e jpg -n --immediate --camera {{INDEX}} --width 1920 --height 1080 -o -`",
    );
  }
  const substituted = tpl.replaceAll("{{INDEX}}", String(cameraIndex));
  const cmd = buildCaptureShellCommand(substituted);
  if (!cmd) {
    throw new Error("CAPTURE_STILL_CMD_TEMPLATE produced an empty command after substitution");
  }
  return jpegFromShell(cmd);
}

/**
 * Manual / diagnostic: prefers `CAPTURE_STILL_CMD` when set; otherwise `MOCK_CAMERA=1` uses
 * the tiny mock JPEG; without either, errors (same as the agent).
 */
export async function getJpegForUpload(): Promise<Buffer> {
  const cmd = buildDefaultCaptureShellCommand();
  if (cmd) {
    return jpegFromShell(cmd);
  }
  if (!config.mockCamera) {
    return getJpegForRealCamera();
  }
  return MOCK_JPEG;
}

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "./config.js";
import { MOCK_JPEG } from "./camera-mock.js";
import { postDebugIngest } from "./debug-ingest.js";
import { log } from "./logger.js";

const execFileAsync = promisify(execFile) as (
  file: string,
  args: readonly string[] | undefined,
  options: { encoding: "buffer"; maxBuffer?: number; timeout?: number },
) => Promise<{ stdout: Buffer; stderr: Buffer }>;

const CAPTURE_CLI_HINT =
  "Install tools: sudo apt update && sudo apt install -y libcamera-apps " +
  "(then try `rpicam-still` or `libcamera-still`; on older OS use `raspistill` from libraspberrypi-bin). " +
  "Check: command -v rpicam-still libcamera-still raspistill";

/**
 * Default `run_calibration` still when no `CALIBRATION_CAPTURE_STILL_CMD*` override.
 * Uses `--immediate` + 720p to minimize ISP/AF load (1080p AF still timed out on some 64MP + Pi setups).
 * For sharper calibration frames set `CALIBRATION_CAPTURE_STILL_CMD` (e.g. 1080p/4K + AF).
 */
const DEFAULT_CALIBRATION_STILL_CMD =
  "rpicam-still -e jpg -n --immediate --width 1280 --height 720 -o -";
const DEFAULT_CALIBRATION_STILL_CMD_TEMPLATE =
  "rpicam-still -e jpg -n --immediate --camera {{INDEX}} --width 1280 --height 720 -o -";

function calibrationMatchCaptureStillCmd(): boolean {
  const v = process.env.CALIBRATION_MATCH_CAPTURE_STILL_CMD?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

let warnedAboutImmediateAf = false;

function maybeWarnImmediateWithoutAf(baseCmd: string) {
  if (warnedAboutImmediateAf) return;
  if (!/\b--immediate\b/.test(baseCmd)) return;
  if (/\b--autofocus-on-capture\b/.test(baseCmd) || /\b--autofocus\b/.test(baseCmd)) return;
  warnedAboutImmediateAf = true;
  console.warn(
    "[edge] Still command uses --immediate without --autofocus-on-capture / --autofocus. " +
      "AF cameras (e.g. Arducam 64MP) often look blurry for ops stills — remove --immediate, add -t 6000 --autofocus-on-capture, " +
      "and raise --width/--height for CAPTURE_STILL_CMD. Calibration defaults stay light unless you set CALIBRATION_CAPTURE_STILL_CMD.",
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

/** Optional longer timeout for calibration stills (default 120s, same as ops). */
function parseCalibrationCaptureTimeoutMs(): number {
  const raw = process.env.CALIBRATION_CAPTURE_TIMEOUT_MS?.trim();
  if (!raw) return 120_000;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 10_000 || n > 600_000) return 120_000;
  return Math.round(n);
}

function stderrLooksLikeLibcameraFrontendTimeout(stderr: string): boolean {
  if (/Camera frontend has timed out/i.test(stderr)) return true;
  if (/Device timeout detected/i.test(stderr)) return true;
  return (
    /Dequeue timer of .* has expired/i.test(stderr) && /\bpipeline_base\.cpp:/i.test(stderr)
  );
}

function rewriteCameraCliError(stderr: string, errMessage: string): Error | null {
  const blob = stderr + errMessage;
  if (!stderrLooksLikeLibcameraFrontendTimeout(blob)) return null;
  const tail = stderr.trim().slice(-1800);
  return new Error(
    "Camera pipeline timeout (libcamera): the sensor did not deliver frames in time. " +
      "Reseat the ribbon/cable, verify power, or use a lighter mode: lower --width/--height, shorter -t, " +
      "or set CALIBRATION_CAPTURE_STILL_CMD / CALIBRATION_CAPTURE_STILL_CMD_TEMPLATE for run_calibration; " +
      "built-in default is 720p --immediate (see edge/.env.example). CALIBRATION_MATCH_CAPTURE_STILL_CMD=1 uses the same command as ops." +
      (tail ? `\n--- stderr (tail) ---\n${tail}` : ""),
  );
}

async function jpegFromShell(cmd: string, timeoutMs = 120_000): Promise<Buffer> {
  try {
    const { stdout } = await execFileAsync("sh", ["-c", cmd], {
      encoding: "buffer",
      maxBuffer: 40 * 1024 * 1024,
      timeout: timeoutMs,
    });

    if (!stdout.length) {
      throw new Error("CAPTURE_STILL_CMD produced empty stdout; expected JPEG bytes on stdout");
    }

    return stdout;
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stderr?: Buffer; status?: number };
    const code = typeof err.code === "number" ? err.code : err.status;
    const stderrUtf8 = err.stderr ? err.stderr.toString("utf8") : "";
    const stderr = stderrUtf8 + (err.message ?? "");
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
    const rewritten = rewriteCameraCliError(stderrUtf8, err.message ?? "");
    if (rewritten) throw rewritten;
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
  return jpegFromShell(cmd, 120_000);
}

/**
 * `run_calibration` stills only: `CALIBRATION_CAPTURE_STILL_CMD` when set; else conservative built-in default
 * (not necessarily the same as `CAPTURE_STILL_CMD`). Set `CALIBRATION_MATCH_CAPTURE_STILL_CMD=1` to use ops command.
 * Timeout from `CALIBRATION_CAPTURE_TIMEOUT_MS` (default 120s).
 */
export async function getJpegForCalibrationStill(): Promise<Buffer> {
  const timeoutMs = parseCalibrationCaptureTimeoutMs();
  const cal = process.env.CALIBRATION_CAPTURE_STILL_CMD?.trim();
  const matchCapture = calibrationMatchCaptureStillCmd();
  let source: "env" | "match_capture" | "default";
  let cmd: string;
  if (cal) {
    source = "env";
    cmd = buildCaptureShellCommand(cal);
    if (!cmd) {
      throw new Error("CALIBRATION_CAPTURE_STILL_CMD is empty after trim");
    }
  } else if (matchCapture) {
    source = "match_capture";
    cmd = buildDefaultCaptureShellCommand();
    if (!cmd) {
      throw new Error(
        "CALIBRATION_MATCH_CAPTURE_STILL_CMD=1 but CAPTURE_STILL_CMD is empty — set CAPTURE_STILL_CMD or " +
          "CALIBRATION_CAPTURE_STILL_CMD",
      );
    }
  } else {
    source = "default";
    cmd = buildCaptureShellCommand(DEFAULT_CALIBRATION_STILL_CMD);
  }
  // #region agent log
  postDebugIngest({
    location: "capture-jpeg.ts:getJpegForCalibrationStill",
    message: "calibration_still_single",
    hypothesisId: "H_cal_cmd",
    data: { source, usesCalibrationEnv: Boolean(cal), matchCapture, timeoutMs },
  });
  // #endregion
  log.info("calibration still (single) invoking shell", {
    source,
    matchCapture,
    timeoutMs,
    shellCmdPreview: cmd.length > 220 ? `${cmd.slice(0, 220)}…` : cmd,
  });
  return jpegFromShell(cmd, timeoutMs);
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
  return jpegFromShell(cmd, 120_000);
}

/**
 * Omni calibration: `CALIBRATION_CAPTURE_STILL_CMD_TEMPLATE` when set; else conservative built-in default
 * (not necessarily `CAPTURE_STILL_CMD_TEMPLATE`). `CALIBRATION_MATCH_CAPTURE_STILL_CMD=1` uses ops template.
 * Timeout from `CALIBRATION_CAPTURE_TIMEOUT_MS`.
 */
export async function getJpegForCalibrationStillAtIndex(cameraIndex: number): Promise<Buffer> {
  const timeoutMs = parseCalibrationCaptureTimeoutMs();
  const calTpl = process.env.CALIBRATION_CAPTURE_STILL_CMD_TEMPLATE?.trim() ?? "";
  const matchCapture = calibrationMatchCaptureStillCmd();
  let tpl: string;
  let source: "env" | "match_capture" | "default";
  if (calTpl && calTpl.includes("{{INDEX}}")) {
    source = "env";
    tpl = calTpl;
  } else if (matchCapture) {
    source = "match_capture";
    tpl = process.env.CAPTURE_STILL_CMD_TEMPLATE?.trim() ?? "";
  } else {
    source = "default";
    tpl = DEFAULT_CALIBRATION_STILL_CMD_TEMPLATE;
  }
  // #region agent log
  postDebugIngest({
    location: "capture-jpeg.ts:getJpegForCalibrationStillAtIndex",
    message: "calibration_still_omni",
    hypothesisId: "H_cal_cmd",
    data: {
      cameraIndex,
      source,
      usesCalibrationTemplate: Boolean(calTpl && calTpl.includes("{{INDEX}}")),
      matchCapture,
      timeoutMs,
    },
  });
  // #endregion
  if (!tpl || !tpl.includes("{{INDEX}}")) {
    throw new Error(
      "Omni calibration needs CAPTURE_STILL_CMD_TEMPLATE with {{INDEX}} when CALIBRATION_MATCH_CAPTURE_STILL_CMD=1, " +
        "or set CALIBRATION_CAPTURE_STILL_CMD_TEMPLATE, or rely on the built-in default template.",
    );
  }
  const substituted = tpl.replaceAll("{{INDEX}}", String(cameraIndex));
  const cmd = buildCaptureShellCommand(substituted);
  if (!cmd) {
    throw new Error("Omni calibration template produced an empty command after substitution");
  }
  log.info("calibration still (omni) invoking shell", {
    cameraIndex,
    source,
    matchCapture,
    timeoutMs,
    shellCmdPreview: cmd.length > 220 ? `${cmd.slice(0, 220)}…` : cmd,
  });
  return jpegFromShell(cmd, timeoutMs);
}

/**
 * Manual / diagnostic: prefers `CAPTURE_STILL_CMD` when set; otherwise `MOCK_CAMERA=1` uses
 * the tiny mock JPEG; without either, errors (same as the agent).
 */
export async function getJpegForUpload(): Promise<Buffer> {
  const cmd = buildDefaultCaptureShellCommand();
  if (cmd) {
    return jpegFromShell(cmd, 120_000);
  }
  if (!config.mockCamera) {
    return getJpegForRealCamera();
  }
  return MOCK_JPEG;
}

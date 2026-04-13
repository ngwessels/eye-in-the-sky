import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "./config.js";
import { countCamerasFromListOutput } from "./omni-camera-list-parse.js";

const execFileAsync = promisify(execFile) as (
  file: string,
  args: readonly string[],
  options: { encoding: "utf8"; maxBuffer?: number; timeout?: number },
) => Promise<{ stdout: string; stderr: string }>;

const LIST_TIMEOUT_MS = Math.max(3000, Number(process.env.OMNI_CAMERA_LIST_TIMEOUT_MS ?? 15_000));

export { countCamerasFromListOutput } from "./omni-camera-list-parse.js";

function parseExplicitCountFromEnv(): number | null {
  const raw = process.env.OMNI_CAMERA_COUNT?.trim();
  if (raw === undefined || raw === "") return null;
  const lower = raw.toLowerCase();
  if (lower === "auto") return null;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.min(n, 32);
}

/** How many relative azimuth entries are listed in OMNI_SLOT_AZIMUTH_DEG (defaults imply four). */
export function countSlotsDeclaredInEnv(): number {
  const raw = (process.env.OMNI_SLOT_AZIMUTH_DEG ?? "0,90,180,270").trim();
  const parts = raw
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isFinite(n));
  return Math.max(1, parts.length);
}

let detectCache: { count: number; expiresAt: number } | null = null;

function detectCacheTtlMs(): number {
  const v = Number(process.env.OMNI_CAMERA_DETECT_CACHE_MS ?? 300_000);
  return Number.isFinite(v) && v >= 0 ? v : 300_000;
}

async function runListCameras(bin: string, args: string[]): Promise<string> {
  const { stdout, stderr } = await execFileAsync(bin, args, {
    encoding: "utf8",
    maxBuffer: 256 * 1024,
    timeout: LIST_TIMEOUT_MS,
  });
  return `${stdout}\n${stderr}`;
}

/**
 * Ask libcamera CLI how many sensors are enumerated (multiplexed adapter reports each index).
 * Tries rpicam-still, libcamera-still, then rpicam-hello.
 */
export async function detectLibcameraCameraCount(): Promise<number> {
  const attempts: { bin: string; args: string[] }[] = [
    { bin: "rpicam-still", args: ["--list-cameras"] },
    { bin: "libcamera-still", args: ["--list-cameras"] },
    { bin: "rpicam-hello", args: ["--list-cameras", "--timeout", "1", "-n"] },
  ];
  let lastErr: string | undefined;
  for (const { bin, args } of attempts) {
    try {
      const text = await runListCameras(bin, args);
      const n = countCamerasFromListOutput(text);
      if (n >= 1) return n;
      lastErr = `${bin}: listed0 cameras`;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      lastErr = `${bin}: ${msg}`;
    }
  }
  throw new Error(
    `Could not detect camera count (tried rpicam-still, libcamera-still, rpicam-hello). ${lastErr ?? ""} ` +
      "Install libcamera-apps, or set OMNI_CAMERA_COUNT to a positive integer.",
  );
}

async function resolveCountAuto(): Promise<number> {
  if (config.mockCamera) {
    return countSlotsDeclaredInEnv();
  }
  const ttl = detectCacheTtlMs();
  if (ttl > 0 && detectCache && Date.now() < detectCache.expiresAt) {
    return detectCache.count;
  }
  const count = await detectLibcameraCameraCount();
  if (ttl > 0) {
    detectCache = { count, expiresAt: Date.now() + ttl };
  }
  return count;
}

/**
 * Effective number of omni slots to capture.
 * - `OMNI_CAMERA_COUNT=<n>`: use n (no list probe).
 * - Unset / `auto`: probe libcamera (cached), except `MOCK_CAMERA=1` uses slot list length from env.
 */
export async function getOmniCameraCount(): Promise<number> {
  const explicit = parseExplicitCountFromEnv();
  if (explicit != null) return explicit;
  return resolveCountAuto();
}

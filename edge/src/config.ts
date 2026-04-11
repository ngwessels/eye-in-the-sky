import "dotenv/config";

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

/** Requested pan/tilt backend; `auto` probes I²C then uses serial path if set, else mock. */
const panTiltDriverRaw = (process.env.PAN_TILT_DRIVER ?? "auto").toLowerCase().trim();
const panTiltDriver: "auto" | "serial" | "pca9685" | "mock" =
  panTiltDriverRaw === "serial"
    ? "serial"
    : panTiltDriverRaw === "pca9685"
      ? "pca9685"
      : panTiltDriverRaw === "mock"
        ? "mock"
        : "auto";

function parseI2cAddr(raw: string | undefined, defaultDec: number): number {
  if (raw === undefined || raw.trim() === "") return defaultDec;
  const t = raw.trim();
  if (t.startsWith("0x") || t.startsWith("0X")) return parseInt(t, 16);
  return parseInt(t, 10);
}

function envBool(raw: string | undefined): boolean {
  if (raw === undefined || raw.trim() === "") return false;
  const t = raw.trim().toLowerCase();
  return t === "1" || t === "true" || t === "yes";
}

export const config = {
  cloudBaseUrl: req("CLOUD_BASE_URL").replace(/\/$/, ""),
  stationApiKey: req("STATION_API_KEY"),
  commandPollIntervalMs: Number(process.env.COMMAND_POLL_INTERVAL_MS ?? 180_000),
  /**
   * Wi-Fi scan + Mozilla MLS when GNSS has no fix. **On by default** so stations without GNSS in `gps.ts`
   * still get coarse position. Set `WIFI_POSITIONING=0` or `false` to disable (e.g. air-gapped / no MLS).
   */
  wifiPositioningEnabled:
    process.env.WIFI_POSITIONING !== "0" && process.env.WIFI_POSITIONING !== "false",
  wifiScanIface: (process.env.WIFI_SCAN_IFACE ?? "wlan0").trim(),
  /** Reuse last Wi-Fi fix for this long (ms) to avoid hammering MLS. Default 10 minutes. */
  wifiGeolocMinIntervalMs: Math.max(
    60_000,
    Number(process.env.WIFI_GEOLOC_MIN_INTERVAL_MS ?? 600_000),
  ),
  mozillaLocationApiKey: (process.env.MOZILLA_LOCATION_API_KEY ?? "").trim() || undefined,
  /** Run `sudo -n iw ...` when a plain `iw` scan fails (e.g. permission denied). */
  wifiIwUseSudo: envBool(process.env.WIFI_IW_USE_SUDO),
  /**
   * Optional: shell command that prints either `iw dev … scan` text or lines `bssid_dbm` as
   * `aa:bb:cc:dd:ee:ff -72` (one AP per line).
   */
  wifiScanShellCmd: (process.env.WIFI_SCAN_CMD ?? "").trim() || undefined,
  /**
   * After MLS fails (or if you only need IP coarse fix), call geojs.io from the Pi. Disable with
   * `WIFI_IP_GEO_FALLBACK=0` if you must avoid that third party.
   */
  wifiIpGeoFallbackEnabled:
    process.env.WIFI_IP_GEO_FALLBACK !== "0" && process.env.WIFI_IP_GEO_FALLBACK !== "false",
  /**
   * When false, `aim_absolute` is rejected if the only position fix is Wi-Fi (telemetry still sends it).
   * Default: allow coarse Wi-Fi position for slewing.
   */
  allowWifiForAim:
    process.env.ALLOW_WIFI_FOR_AIM !== "0" &&
    process.env.ALLOW_WIFI_FOR_AIM !== "false",
  /** Tiny JPEG uploads for pipeline testing (`MOCK_CAMERA=1`). Otherwise requires `CAPTURE_STILL_CMD`. */
  mockCamera: envBool(process.env.MOCK_CAMERA),
  panMin: Number(process.env.PAN_MIN_DEG ?? -180),
  panMax: Number(process.env.PAN_MAX_DEG ?? 180),
  tiltMin: Number(process.env.TILT_MIN_DEG ?? -10),
  tiltMax: Number(process.env.TILT_MAX_DEG ?? 90),
  /** `auto` (default): probe I²C for PCA9685, else serial if path set, else mock. */
  panTiltDriver,
  panTiltSerialPath: process.env.PAN_TILT_SERIAL_PATH ?? "",
  panTiltSerialBaud: Number(process.env.PAN_TILT_SERIAL_BAUD ?? 115200),
  panTiltI2cBus: Number(process.env.PAN_TILT_I2C_BUS ?? 1),
  panTiltPca9685Addr: parseI2cAddr(process.env.PAN_TILT_PCA9685_ADDR, 0x40),
  /** PCA9685 only: maps logical pan/tilt to 0–180° servo commands (same role as kOut* in pan-tilt-bridge.ino). Widen the span to move more per logical degree. */
  panTiltServoPanOutMin: Number(process.env.PAN_TILT_SERVO_PAN_OUT_MIN ?? 0),
  panTiltServoPanOutMax: Number(process.env.PAN_TILT_SERVO_PAN_OUT_MAX ?? 180),
  panTiltServoTiltOutMin: Number(process.env.PAN_TILT_SERVO_TILT_OUT_MIN ?? 15),
  panTiltServoTiltOutMax: Number(process.env.PAN_TILT_SERVO_TILT_OUT_MAX ?? 145),
  /** Mirror pan/tilt within logical min/max before PWM map (hardware mounted reversed). */
  panTiltInvertPan: envBool(process.env.PAN_TILT_INVERT_PAN),
  panTiltInvertTilt: envBool(process.env.PAN_TILT_INVERT_TILT),
  /** `npm run test-pan-tilt`: pause after each pose (ms). */
  panTiltTestDwellMs: Number(process.env.PAN_TILT_TEST_DWELL_MS ?? 2200),
  /** `npm run test-pan-tilt`: segments per sweep (positions = segments + 1). */
  panTiltTestSweepSteps: Math.max(2, Math.floor(Number(process.env.PAN_TILT_TEST_SWEEP_STEPS ?? 14))),
  /**
   * `npm run test-pan-tilt-capture`: `all` = upload at every pose (may hit API rate limits).
   * `sparse` = every pose except sweep legs are sampled every PAN_TILT_CAPTURE_SWEEP_STRIDE stops (plus last stop).
   */
  panTiltCaptureMode:
    (process.env.PAN_TILT_CAPTURE_MODE ?? "sparse").toLowerCase() === "all" ? "all" : "sparse",
  panTiltCaptureSweepStride: Math.max(
    1,
    Math.floor(Number(process.env.PAN_TILT_CAPTURE_SWEEP_STRIDE ?? 4)),
  ),
  /** After `safe_home` / pan 0 tilt 0 before calibration captures (ms). */
  calibrationHomeSettleMs: Math.max(500, Number(process.env.CALIBRATION_HOME_SETTLE_MS ?? 2500)),
  /** After each calibration pose change before progress + still (ms). */
  calibrationPhaseSettleMs: Math.max(200, Number(process.env.CALIBRATION_POSE_SETTLE_MS ?? 800)),
  /** After `calibration_sky_probe` aim before shutter (ms). */
  calibrationSkyProbeSettleMs: Math.max(400, Number(process.env.CALIBRATION_SKY_PROBE_SETTLE_MS ?? 1200)),
};

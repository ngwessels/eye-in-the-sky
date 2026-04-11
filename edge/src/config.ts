import "dotenv/config";

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

const panTiltDriverRaw = (process.env.PAN_TILT_DRIVER ?? "mock").toLowerCase();
const panTiltDriver =
  panTiltDriverRaw === "serial"
    ? "serial"
    : panTiltDriverRaw === "pca9685"
      ? "pca9685"
      : "mock";

function parseI2cAddr(raw: string | undefined, defaultDec: number): number {
  if (raw === undefined || raw.trim() === "") return defaultDec;
  const t = raw.trim();
  if (t.startsWith("0x") || t.startsWith("0X")) return parseInt(t, 16);
  return parseInt(t, 10);
}

export const config = {
  cloudBaseUrl: req("CLOUD_BASE_URL").replace(/\/$/, ""),
  stationApiKey: req("STATION_API_KEY"),
  commandPollIntervalMs: Number(process.env.COMMAND_POLL_INTERVAL_MS ?? 180_000),
  gpsMock: process.env.GPS_MOCK === "1" || process.env.GPS_MOCK === "true",
  mockCamera: process.env.MOCK_CAMERA !== "0",
  panMin: Number(process.env.PAN_MIN_DEG ?? -180),
  panMax: Number(process.env.PAN_MAX_DEG ?? 180),
  tiltMin: Number(process.env.TILT_MIN_DEG ?? -10),
  tiltMax: Number(process.env.TILT_MAX_DEG ?? 90),
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
};

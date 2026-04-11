import "dotenv/config";

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

const panTiltDriverRaw = (process.env.PAN_TILT_DRIVER ?? "mock").toLowerCase();
const panTiltDriver = panTiltDriverRaw === "serial" ? "serial" : "mock";

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
};

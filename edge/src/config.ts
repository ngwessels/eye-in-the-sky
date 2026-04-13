import "dotenv/config";

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
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
   * When false, `calibration_sky_probe` rejects Wi-Fi-only position (telemetry still sends it).
   */
  allowWifiForAim:
    process.env.ALLOW_WIFI_FOR_AIM !== "0" &&
    process.env.ALLOW_WIFI_FOR_AIM !== "false",
  /** Tiny JPEG uploads for pipeline testing (`MOCK_CAMERA=1`). Otherwise requires `CAPTURE_STILL_CMD`. */
  mockCamera: envBool(process.env.MOCK_CAMERA),
  /** Initial settle before fixed-mount calibration frames (ms). */
  calibrationHomeSettleMs: Math.max(500, Number(process.env.CALIBRATION_HOME_SETTLE_MS ?? 2500)),
  /** Between calibration progress phases before still (ms). */
  calibrationPhaseSettleMs: Math.max(200, Number(process.env.CALIBRATION_POSE_SETTLE_MS ?? 800)),
  /** Before shutter on `calibration_sky_probe` (fixed mount; allows exposure settle) (ms). */
  calibrationSkyProbeSettleMs: Math.max(400, Number(process.env.CALIBRATION_SKY_PROBE_SETTLE_MS ?? 1200)),
  /**
   * Arducam multi-camera / fixed rig: capture all slots per `capture_now`.
   * Set matching `capabilities.omni_quad` on the station at registration so cloud crons stay consistent.
   */
  omniQuad: envBool(process.env.OMNI_QUAD),
  /** Optional elevation (deg) sent on finalize for every omni slot (same semantics as mount tilt / aim). */
  omniCaptureElevationDeg: (() => {
    const v = process.env.OMNI_CAPTURE_ELEVATION_DEG?.trim();
    if (!v) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  })(),
};

/**
 * Relative azimuth offsets (deg) from slot-0 boresight for each active camera index.
 * `cameraCount` comes from detection or OMNI_CAMERA_COUNT; env must list at least that many values.
 */
export function resolveOmniSlotOffsets(cameraCount: number): number[] {
  const count = Math.max(1, Math.floor(cameraCount));
  const raw = (process.env.OMNI_SLOT_AZIMUTH_DEG ?? "0,90,180,270").trim();
  const parts = raw
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isFinite(n));
  if (parts.length < count) {
    throw new Error(
      `OMNI_SLOT_AZIMUTH_DEG must list at least ${count} comma-separated numbers (got ${parts.length})`,
    );
  }
  return parts.slice(0, count);
}

import type { GpsSnapshot } from "@eye/shared";

/** GNSS snapshot only — no Wi-Fi; see `resolveTelemetryPositionSnapshot`. */
export function readGpsSnapshot(): GpsSnapshot | undefined {
  // Integrate serial NMEA reader here; until then no GNSS fix (Wi-Fi path may still apply).
  return undefined;
}

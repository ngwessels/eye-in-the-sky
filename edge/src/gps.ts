import { config } from "./config.js";

/** Minimal GPS snapshot for telemetry (real UART NMEA parsing can replace this). */
export function readGpsSnapshot():
  | {
      lat: number;
      lon: number;
      alt_msl?: number;
      hdop: number;
      sat_count: number;
      fix_type: "3d" | "none";
      observedAt: string;
    }
  | undefined {
  if (config.gpsMock) {
    const lat = Number(process.env.MOCK_GPS_LAT ?? "37.7749");
    const lon = Number(process.env.MOCK_GPS_LON ?? "-122.4194");
    return {
      lat,
      lon,
      alt_msl: 20,
      hdop: 1.2,
      sat_count: 12,
      fix_type: "3d",
      observedAt: new Date().toISOString(),
    };
  }
  // Production: integrate serial NMEA reader; until then treat as no fix.
  return undefined;
}

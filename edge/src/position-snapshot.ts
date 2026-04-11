import type { GpsSnapshot } from "@eye/shared";
import { config } from "./config.js";
import { readGpsSnapshot } from "./gps.js";
import { scanWifiAccessPoints } from "./wifi-scan.js";
import { mozillaWifiGeolocate } from "./wifi-geolocate.js";

type WifiCache = { snapshot: GpsSnapshot; fetchedAtMs: number };
let wifiCache: WifiCache | null = null;

/**
 * GNSS when fix is valid; otherwise optional Wi-Fi geolocation via Mozilla MLS.
 */
export async function resolveTelemetryPositionSnapshot(): Promise<GpsSnapshot | undefined> {
  const gnss = readGpsSnapshot();
  if (gnss && gnss.fix_type !== "none") {
    return { ...gnss, position_source: gnss.position_source ?? "gnss" };
  }

  if (!config.wifiPositioningEnabled) {
    return gnss;
  }

  const now = Date.now();
  if (wifiCache && now - wifiCache.fetchedAtMs < config.wifiGeolocMinIntervalMs) {
    return wifiCache.snapshot;
  }

  let aps: Awaited<ReturnType<typeof scanWifiAccessPoints>> = [];
  try {
    aps = await scanWifiAccessPoints();
  } catch {
    return gnss;
  }

  if (aps.length === 0) {
    return gnss;
  }

  let loc: Awaited<ReturnType<typeof mozillaWifiGeolocate>> = null;
  try {
    loc = await mozillaWifiGeolocate(aps);
  } catch {
    return gnss;
  }

  if (!loc) {
    return gnss;
  }

  const snapshot: GpsSnapshot = {
    lat: loc.lat,
    lon: loc.lon,
    accuracy_m: loc.accuracy,
    fix_type: "wifi",
    observedAt: new Date().toISOString(),
    position_source: "wifi",
  };
  wifiCache = { snapshot, fetchedAtMs: now };
  return snapshot;
}

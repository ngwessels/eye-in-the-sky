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
  // #region agent log
  console.log(
    "[eye-debug] H1/H5 resolveTelemetryPositionSnapshot:gnss",
    JSON.stringify({
      hypothesisId: "H1_H5",
      hasGnss: Boolean(gnss),
      gnssFixType: gnss?.fix_type ?? null,
      wifiPositioningEnabled: config.wifiPositioningEnabled,
    }),
  );
  // #endregion
  if (gnss && gnss.fix_type !== "none") {
    const out = { ...gnss, position_source: gnss.position_source ?? "gnss" };
    // #region agent log
    console.log(
      "[eye-debug] H1 resolve path=gnss_ok",
      JSON.stringify({ hypothesisId: "H1", fix_type: out.fix_type, position_source: out.position_source }),
    );
    // #endregion
    return out;
  }

  if (!config.wifiPositioningEnabled) {
    // #region agent log
    console.log(
      "[eye-debug] H1 resolve path=wifi_disabled_return_gnss",
      JSON.stringify({ hypothesisId: "H1", returningUndefined: gnss === undefined }),
    );
    // #endregion
    return gnss;
  }

  const now = Date.now();
  if (wifiCache && now - wifiCache.fetchedAtMs < config.wifiGeolocMinIntervalMs) {
    // #region agent log
    console.log(
      "[eye-debug] H2 resolve path=wifi_cache_hit",
      JSON.stringify({
        hypothesisId: "H2",
        ageMs: now - wifiCache.fetchedAtMs,
        fix_type: wifiCache.snapshot.fix_type,
        position_source: wifiCache.snapshot.position_source,
      }),
    );
    // #endregion
    return wifiCache.snapshot;
  }

  let aps: Awaited<ReturnType<typeof scanWifiAccessPoints>> = [];
  try {
    aps = await scanWifiAccessPoints();
  } catch (e) {
    // #region agent log
    console.log(
      "[eye-debug] H2 scanWifiAccessPoints threw",
      JSON.stringify({
        hypothesisId: "H2",
        message: e instanceof Error ? e.message : String(e),
      }),
    );
    // #endregion
    return gnss;
  }

  if (aps.length === 0) {
    // #region agent log
    console.log("[eye-debug] H2 resolve path=no_aps", JSON.stringify({ hypothesisId: "H2", apCount: 0 }));
    // #endregion
    return gnss;
  }

  let loc: Awaited<ReturnType<typeof mozillaWifiGeolocate>> = null;
  try {
    loc = await mozillaWifiGeolocate(aps);
  } catch (e) {
    // #region agent log
    console.log(
      "[eye-debug] H2 mozillaWifiGeolocate threw",
      JSON.stringify({
        hypothesisId: "H2",
        message: e instanceof Error ? e.message : String(e),
      }),
    );
    // #endregion
    return gnss;
  }

  if (!loc) {
    // #region agent log
    console.log(
      "[eye-debug] H2 resolve path=mls_null",
      JSON.stringify({ hypothesisId: "H2", apCount: aps.length }),
    );
    // #endregion
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
  // #region agent log
  console.log(
    "[eye-debug] H2 resolve path=wifi_mls_ok",
    JSON.stringify({
      hypothesisId: "H2",
      fix_type: snapshot.fix_type,
      position_source: snapshot.position_source,
      accuracy_m: snapshot.accuracy_m,
      apCount: aps.length,
    }),
  );
  // #endregion
  return snapshot;
}

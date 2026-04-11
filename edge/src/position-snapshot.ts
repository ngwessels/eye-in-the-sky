import type { GpsSnapshot } from "@eye/shared";
import { config } from "./config.js";
import { readGpsSnapshot } from "./gps.js";
import { scanWifiAccessPoints } from "./wifi-scan.js";
import { geojsPublicIpGeo } from "./ip-fallback-geolocate.js";
import { mozillaWifiGeolocate } from "./wifi-geolocate.js";
import { fetchRegisteredStationLocation } from "./station-location-fetch.js";

type WifiCache = { snapshot: GpsSnapshot; fetchedAtMs: number };
let wifiCache: WifiCache | null = null;

/**
 * GNSS when fix is valid; else Wi-Fi / MLS / IP geolocation when enabled; else MongoDB `stations.location`.
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

  let snapshot: GpsSnapshot | undefined;

  if (config.wifiPositioningEnabled) {
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
    }

    let loc: { lat: number; lon: number; accuracy: number } | null = null;
    let usedIpGeoJs = false;

    if (aps.length > 0) {
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
      }
    } else {
      // #region agent log
      console.log("[eye-debug] H2 resolve path=no_aps_try_ip", JSON.stringify({ hypothesisId: "H2", apCount: 0 }));
      // #endregion
    }

    if (!loc && config.wifiIpGeoFallbackEnabled) {
      loc = await geojsPublicIpGeo();
      if (loc) usedIpGeoJs = true;
    }

    if (loc) {
      snapshot = {
        lat: loc.lat,
        lon: loc.lon,
        accuracy_m: loc.accuracy,
        fix_type: usedIpGeoJs ? "ip_geo" : "wifi",
        observedAt: new Date().toISOString(),
        position_source: usedIpGeoJs ? undefined : "wifi",
      };
      wifiCache = { snapshot, fetchedAtMs: now };
      // #region agent log
      console.log(
        usedIpGeoJs ? "[eye-debug] H2 resolve path=ip_geojs_ok" : "[eye-debug] H2 resolve path=wifi_mls_ok",
        JSON.stringify({
          hypothesisId: "H2",
          fix_type: snapshot.fix_type,
          position_source: snapshot.position_source ?? null,
          accuracy_m: snapshot.accuracy_m,
          apCount: aps.length,
        }),
      );
      // #endregion
    } else {
      // #region agent log
      console.log(
        "[eye-debug] H2 resolve path=no_fix_mls_and_ip",
        JSON.stringify({ hypothesisId: "H2", apCount: aps.length }),
      );
      // #endregion
    }
  }

  if (!snapshot) {
    const reg = await fetchRegisteredStationLocation();
    if (reg) {
      snapshot = {
        lat: reg.lat,
        lon: reg.lon,
        accuracy_m: 10_000,
        alt_msl: reg.alt,
        fix_type: "station_record",
        observedAt: new Date().toISOString(),
        position_source: "registered",
      };
      // #region agent log
      console.log(
        "[eye-debug] H2 resolve path=station_mongodb",
        JSON.stringify({
          hypothesisId: "H2",
          lat: reg.lat,
          lon: reg.lon,
          fix_type: "station_record",
        }),
      );
      // #endregion
    }
  }

  return snapshot ?? gnss;
}

import type { WifiAccessPoint } from "./wifi-scan.js";
import { config } from "./config.js";

const MLS_URL = "https://location.services.mozilla.com/v1/geolocate";
const MAX_APS = 20;
/** Mozilla Ichnaea rejects Wi-Fi-only fixes with fewer than 2 BSSIDs (privacy); omit Wi-Fi and use GeoIP fallback instead. */
const MLS_MIN_WIFI_APS = 2;

export type MozillaGeolocateResult = {
  lat: number;
  lon: number;
  accuracy: number;
};

function sortBySignal(aps: WifiAccessPoint[]): WifiAccessPoint[] {
  return [...aps].sort((a, b) => b.signalStrength - a.signalStrength);
}

/**
 * POST to Mozilla Location Service: Wi-Fi triangulation when ≥2 APs, else GeoIP via `considerIp` (coarse).
 * @see https://ichnaea.readthedocs.io/en/stable/api/geolocate.html — fewer than 2 Wi-Fi networks cannot yield a Wi-Fi fix.
 */
export async function mozillaWifiGeolocate(
  accessPoints: WifiAccessPoint[],
): Promise<MozillaGeolocateResult | null> {
  if (accessPoints.length === 0) return null;
  const wifiAccessPoints = sortBySignal(accessPoints).slice(0, MAX_APS).map((ap) => ({
    macAddress: ap.macAddress,
    signalStrength: ap.signalStrength,
  }));

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.mozillaLocationApiKey) {
    headers["X-API-Key"] = config.mozillaLocationApiKey;
  }

  const body: Record<string, unknown> = {
    considerIp: true,
    fallbacks: { lacf: true, ipf: true },
  };
  if (wifiAccessPoints.length >= MLS_MIN_WIFI_APS) {
    body.wifiAccessPoints = wifiAccessPoints;
  }

  const res = await fetch(MLS_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let bodySnippet = "";
    try {
      bodySnippet = (await res.text()).slice(0, 400);
    } catch {
      /* ignore */
    }
    // #region agent log
    console.log(
      "[eye-debug] H2 mozillaWifiGeolocate http_error",
      JSON.stringify({
        hypothesisId: "H2",
        status: res.status,
        bodySnippet,
        scannedApCount: accessPoints.length,
        wifiSentInBody: wifiAccessPoints.length >= MLS_MIN_WIFI_APS ? wifiAccessPoints.length : 0,
      }),
    );
    // #endregion
    return null;
  }

  const data = (await res.json()) as {
    location?: { lat?: number; lng?: number };
    accuracy?: number;
    fallback?: string;
  };
  const lat = data.location?.lat;
  const lon = data.location?.lng;
  const accuracy =
    typeof data.accuracy === "number" && Number.isFinite(data.accuracy)
      ? data.accuracy
      : 500;
  if (
    typeof lat !== "number" ||
    typeof lon !== "number" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lon)
  ) {
    // #region agent log
    console.log(
      "[eye-debug] H2 mozillaWifiGeolocate no_location_in_body",
      JSON.stringify({
        hypothesisId: "H2",
        scannedApCount: accessPoints.length,
        wifiSentInBody: wifiAccessPoints.length >= MLS_MIN_WIFI_APS ? wifiAccessPoints.length : 0,
        keys: data && typeof data === "object" ? Object.keys(data) : [],
        rawSnippet: JSON.stringify(data).slice(0, 400),
      }),
    );
    // #endregion
    return null;
  }

  // #region agent log
  if (wifiAccessPoints.length < MLS_MIN_WIFI_APS) {
    console.log(
      "[eye-debug] H2 mozillaWifiGeolocate ip_or_sparse_wifi_ok",
      JSON.stringify({
        hypothesisId: "H2",
        scannedApCount: accessPoints.length,
        mlsFallback: data.fallback ?? null,
        accuracy,
      }),
    );
  }
  // #endregion

  return { lat, lon, accuracy };
}

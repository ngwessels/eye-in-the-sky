import type { WifiAccessPoint } from "./wifi-scan.js";
import { config } from "./config.js";

const MLS_URL = "https://location.services.mozilla.com/v1/geolocate";
const MAX_APS = 20;

export type MozillaGeolocateResult = {
  lat: number;
  lon: number;
  accuracy: number;
};

function sortBySignal(aps: WifiAccessPoint[]): WifiAccessPoint[] {
  return [...aps].sort((a, b) => b.signalStrength - a.signalStrength);
}

/**
 * POST visible Wi-Fi APs to Mozilla Location Service; returns WGS84 fix + accuracy (m).
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

  const res = await fetch(MLS_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ wifiAccessPoints }),
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
        apCount: wifiAccessPoints.length,
      }),
    );
    // #endregion
    return null;
  }

  const data = (await res.json()) as {
    location?: { lat?: number; lng?: number };
    accuracy?: number;
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
        apCount: wifiAccessPoints.length,
        keys: data && typeof data === "object" ? Object.keys(data) : [],
        rawSnippet: JSON.stringify(data).slice(0, 400),
      }),
    );
    // #endregion
    return null;
  }

  return { lat, lon, accuracy };
}

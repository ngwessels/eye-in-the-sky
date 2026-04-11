/**
 * Coarse WGS84 from the requester's public IP (geojs.io). Used when Mozilla MLS returns no fix.
 * Accuracy is a conservative guess (city/region scale).
 */
const GEOJS_URL = "https://get.geojs.io/v1/ip/geo.json";

export type IpGeoResult = { lat: number; lon: number; accuracy: number };

export async function geojsPublicIpGeo(): Promise<IpGeoResult | null> {
  const ac = new AbortController();
  const tid = setTimeout(() => ac.abort(), 12_000);
  try {
    const res = await fetch(GEOJS_URL, {
      method: "GET",
      signal: ac.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      // #region agent log
      console.log(
        "[eye-debug] H2 geojsPublicIpGeo http_error",
        JSON.stringify({ hypothesisId: "H2", status: res.status }),
      );
      // #endregion
      return null;
    }
    const data = (await res.json()) as { latitude?: string; longitude?: string };
    const lat = Number.parseFloat(String(data.latitude ?? ""));
    const lon = Number.parseFloat(String(data.longitude ?? ""));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      // #region agent log
      console.log(
        "[eye-debug] H2 geojsPublicIpGeo parse_fail",
        JSON.stringify({ hypothesisId: "H2", latitude: data.latitude, longitude: data.longitude }),
      );
      // #endregion
      return null;
    }
    return { lat, lon, accuracy: 25_000 };
  } catch (e) {
    // #region agent log
    console.log(
      "[eye-debug] H2 geojsPublicIpGeo threw",
      JSON.stringify({
        hypothesisId: "H2",
        message: e instanceof Error ? e.message : String(e),
      }),
    );
    // #endregion
    return null;
  } finally {
    clearTimeout(tid);
  }
}

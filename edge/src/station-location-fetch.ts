import { stationFetch } from "./http.js";

export type RegisteredStationLocation = { lat: number; lon: number; alt?: number };

/**
 * `stations.location` from MongoDB (set by prior telemetry or admin). Used when on-device fixes fail.
 */
export async function fetchRegisteredStationLocation(): Promise<RegisteredStationLocation | null> {
  try {
    const res = await stationFetch("/api/stations/me/location", { method: "GET" });
    if (!res.ok) {
      // #region agent log
      console.log(
        "[eye-debug] H2 fetchRegisteredStationLocation http_error",
        JSON.stringify({ hypothesisId: "H2", status: res.status }),
      );
      // #endregion
      return null;
    }
    const data = (await res.json()) as {
      location?: { lat?: number; lon?: number; alt?: number } | null;
    };
    const loc = data.location;
    if (
      !loc ||
      typeof loc.lat !== "number" ||
      typeof loc.lon !== "number" ||
      !Number.isFinite(loc.lat) ||
      !Number.isFinite(loc.lon)
    ) {
      // #region agent log
      console.log(
        "[eye-debug] H2 fetchRegisteredStationLocation empty",
        JSON.stringify({ hypothesisId: "H2", hasLocation: Boolean(loc) }),
      );
      // #endregion
      return null;
    }
    return {
      lat: loc.lat,
      lon: loc.lon,
      ...(typeof loc.alt === "number" && Number.isFinite(loc.alt) ? { alt: loc.alt } : {}),
    };
  } catch (e) {
    // #region agent log
    console.log(
      "[eye-debug] H2 fetchRegisteredStationLocation threw",
      JSON.stringify({
        hypothesisId: "H2",
        message: e instanceof Error ? e.message : String(e),
      }),
    );
    // #endregion
    return null;
  }
}

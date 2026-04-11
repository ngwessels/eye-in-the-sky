import type { StationDoc } from "./types";
import { getEnv } from "./env";
import type { GpsSnapshot } from "@eye/shared";

export function applyGpsSnapshotToStation(
  station: StationDoc,
  gps: GpsSnapshot,
): Partial<StationDoc> {
  const env = getEnv();
  const source = gps.position_source ?? "gnss";

  if (source === "registered" || gps.fix_type === "station_record") {
    return { lastSeenAt: new Date() };
  }

  if (source === "wifi") {
    let quality_tier = station.quality_tier;
    let tier_reasons = [...(station.tier_reasons ?? [])];
    quality_tier = "gps_degraded";
    tier_reasons = Array.from(new Set([...tier_reasons, "gps_degraded"]));
    return {
      location: {
        lat: gps.lat,
        lon: gps.lon,
        alt: gps.alt_msl,
      },
      location_source: "wifi",
      gps: {
        fix_type: "wifi",
        degraded: true,
        last_fix_at: new Date(gps.observedAt),
        accuracy_m: gps.accuracy_m,
      },
      quality_tier,
      tier_reasons,
      lastSeenAt: new Date(),
    };
  }

  const hdop = gps.hdop ?? 99;
  const sats = gps.sat_count ?? 0;
  const degraded =
    gps.fix_type === "none" ||
    hdop > env.GPS_MAX_HDOP ||
    sats < env.GPS_MIN_SATS;

  let quality_tier = station.quality_tier;
  let tier_reasons = [...(station.tier_reasons ?? [])];

  if (degraded) {
    quality_tier = "gps_degraded";
    tier_reasons = Array.from(new Set([...tier_reasons, "gps_degraded"]));
  } else {
    tier_reasons = tier_reasons.filter((r) => r !== "gps_degraded");
    if (quality_tier === "gps_degraded") {
      quality_tier = "bronze";
    }
  }

  return {
    location: {
      lat: gps.lat,
      lon: gps.lon,
      alt: gps.alt_msl,
    },
    location_source: "gps",
    gps: {
      fix_type: String(gps.fix_type),
      hdop: gps.hdop,
      sat_count: gps.sat_count,
      last_fix_at: new Date(gps.observedAt),
      degraded,
    },
    quality_tier,
    tier_reasons,
    lastSeenAt: new Date(),
  };
}

export function stationEligibleForGeometry(station: StationDoc): boolean {
  if (station.gps?.degraded) return false;
  if (station.quality_tier === "gps_degraded") return false;
  if (!station.location) return false;
  if (
    station.calibration?.state !== "ready" &&
    station.calibration?.state !== "degraded"
  ) {
    return false;
  }
  return true;
}

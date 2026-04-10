import type { StationDoc } from "./types";
import type { QualityTier } from "@eye/shared";

/** Recompute tier from calibration, sensors, GPS, clock, and NTP hints. */
export function recomputeQualityTier(station: StationDoc): {
  quality_tier: QualityTier;
  tier_reasons: string[];
} {
  if (station.gps?.degraded || station.quality_tier === "gps_degraded") {
    return {
      quality_tier: "gps_degraded",
      tier_reasons: Array.from(
        new Set([...(station.tier_reasons ?? []), "gps_degraded"]),
      ),
    };
  }

  const conf = station.calibration?.confidence ?? 0;
  const sensors = station.capabilities?.sensors?.length ?? 0;
  const reasons: string[] = [];

  let tier: QualityTier = "bronze";
  if (conf < 0.35) {
    reasons.push("low_calibration_confidence");
  }
  if (sensors < 1) {
    reasons.push("no_environmental_sensors");
  }

  if (conf >= 0.65 && sensors >= 1) {
    tier = "silver";
  }
  if (conf >= 0.85 && sensors >= 3) {
    tier = "gold";
  }

  if (station.health?.uploadSuccessEma != null && station.health.uploadSuccessEma < 0.5) {
    reasons.push("unreliable_uploads");
    if (tier === "gold") tier = "silver";
    else if (tier === "silver") tier = "bronze";
  }

  if (station.clock_untrusted) {
    reasons.push("clock_untrusted");
    if (tier === "gold") tier = "silver";
    else if (tier === "silver") tier = "bronze";
  }

  if (station.time_quality?.synced === false) {
    reasons.push("ntp_not_synced");
    if (tier === "gold") tier = "silver";
  }

  if ((station.sensor_anomaly_flags?.length ?? 0) > 5) {
    reasons.push("repeated_sensor_anomalies");
    if (tier === "gold") tier = "silver";
  }

  return { quality_tier: tier, tier_reasons: reasons };
}

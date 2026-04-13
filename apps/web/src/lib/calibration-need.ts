import type { StationDoc } from "./types";
import { getSunPositionTrueNorth, sunElevationSufficient } from "./solar-position";

export function scoreRecalibrationNeed(
  station: StationDoc,
  options: {
    confidenceThreshold: number;
    lowHorizonFromCaptures: boolean;
  },
): { needed: boolean; reasons: string[] } {
  if (station.calibration?.state === "pending") {
    return { needed: false, reasons: [] };
  }

  const reasons: string[] = [];
  const conf = station.calibration?.confidence ?? 0;

  if (station.calibration?.state === "degraded") {
    reasons.push("calibration_state_degraded");
  }
  if (conf < options.confidenceThreshold) {
    reasons.push("low_calibration_confidence");
  }
  if (station.calibration?.suspected_location_shift) {
    reasons.push("suspected_location_shift");
  }

  const hv = station.calibration_server_validation?.horizon_validation as
    | { horizon_plausible?: boolean }
    | undefined;
  if (hv && hv.horizon_plausible === false) {
    reasons.push("horizon_not_plausible");
  }

  const sc = station.calibration_server_validation?.sun_calibration as
    | { outcome?: string }
    | undefined;
  if (sc?.outcome === "rejected_low_confidence_or_no_sun") {
    reasons.push("sun_calibration_rejected");
  }

  const methods = station.calibration?.method ?? [];
  if (methods.includes("sun_calibration_rejected")) {
    reasons.push("method_sun_calibration_rejected");
  }

  if (options.lowHorizonFromCaptures) {
    reasons.push("low_horizon_consistency_recent_captures");
  }

  return { needed: reasons.length > 0, reasons };
}

/**
 * Aim near the sun at a sky-heavy elevation, clamped to mount tilt limits when known.
 * Returns null when the sun is too low (night / twilight).
 */
export function buildSkyProbeAim(
  station: StationDoc,
  when: Date,
  opts: {
    sunElevMinDeg: number;
    targetElMin: number;
    targetElMax: number;
  },
): { azimuthDeg: number; elevationDeg: number } | null {
  if (!station.location) return null;
  const { sun_azimuth_true_deg, sun_elevation_deg } = getSunPositionTrueNorth(
    when,
    station.location.lat,
    station.location.lon,
  );
  if (!sunElevationSufficient(sun_elevation_deg, opts.sunElevMinDeg)) {
    return null;
  }

  const el = Math.min(opts.targetElMax, Math.max(opts.targetElMin, sun_elevation_deg));

  return { azimuthDeg: sun_azimuth_true_deg, elevationDeg: el };
}

import SunCalc from "suncalc";
import { normalizeAzimuthDeg } from "@eye/shared";

/**
 * Sun position for a given instant and WGS84 coordinates.
 *
 * `suncalc` reports azimuth in radians measured clockwise from south (0 = south,
 * π/2 = west, π = north, 3π/2 = east). We convert to geographic bearing:
 * clockwise from true north [0, 360), matching `initialBearingDeg` in geometry.
 */
export function getSunPositionTrueNorth(
  when: Date,
  latDeg: number,
  lonDeg: number,
): { sun_azimuth_true_deg: number; sun_elevation_deg: number } {
  const pos = SunCalc.getPosition(when, latDeg, lonDeg);
  const suncalcAzDeg = (pos.azimuth * 180) / Math.PI;
  const sun_azimuth_true_deg = normalizeAzimuthDeg(suncalcAzDeg + 180);
  const sun_elevation_deg = (pos.altitude * 180) / Math.PI;
  return { sun_azimuth_true_deg, sun_elevation_deg };
}

/** True if sun is sufficiently above geometric horizon for outdoor calibration. */
export function sunElevationSufficient(
  elevationDeg: number,
  minDeg: number = 3,
): boolean {
  return Number.isFinite(elevationDeg) && elevationDeg >= minDeg;
}

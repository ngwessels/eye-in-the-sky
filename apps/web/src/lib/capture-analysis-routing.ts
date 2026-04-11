import type { CaptureDoc } from "./types";

/** Elevation above horizon (deg), same semantics as mount tilt / aim_absolute. */
export function effectiveElevationDegForAnalysis(
  c: Pick<CaptureDoc, "view" | "mount_tilt_deg">,
): number | undefined {
  const v = c.view?.elevation_deg;
  if (v != null && Number.isFinite(v)) return v;
  const m = c.mount_tilt_deg;
  if (m != null && Number.isFinite(m)) return m;
  return undefined;
}

export function shouldUseSurfaceAnalysis(
  elevationDeg: number | undefined,
  maxDeg: number,
): boolean {
  if (elevationDeg == null || !Number.isFinite(elevationDeg)) return false;
  return elevationDeg <= maxDeg;
}

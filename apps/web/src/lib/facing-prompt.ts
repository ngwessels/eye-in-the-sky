import type { CaptureViewDoc, StationDoc } from "./types";

/** One-sentence boresight context for vision prompts. */
export function formatFacingContext(view: CaptureViewDoc | undefined): string {
  if (!view) return "Camera orientation unknown.";
  let s = `Camera boresight: ${Math.round(view.azimuth_true_deg)}° true (${view.cardinal16})`;
  if (view.elevation_deg != null && Number.isFinite(view.elevation_deg)) {
    s += `, elevation ${Math.round(view.elevation_deg)}° above horizon.`;
  } else {
    s += ".";
  }
  return s;
}

/** Pan/tilt bounds so the model does not recommend impossible aim commands. */
export function formatPanTiltLimitsForPrompt(station: StationDoc | undefined): string {
  const pt = station?.capabilities?.panTilt;
  if (!pt) {
    return "Mount limits unknown; assume logical elevation (deg above horizon) is often about -10 to +90 unless the station documents otherwise.";
  }
  return `Mount limits (logical degrees): pan [${pt.panMin}, ${pt.panMax}], tilt/elevation above horizon [${pt.tiltMin}, ${pt.tiltMax}]. Only recommend aim within these ranges.`;
}

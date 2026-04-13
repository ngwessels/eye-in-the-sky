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

/** Fixed camera — model should not assume actionable pan/tilt slews. */
export function formatPanTiltLimitsForPrompt(_station: StationDoc | undefined): string {
  return "This station uses a fixed camera mount (no pan/tilt). Do not recommend mechanical slew or aim_absolute-style corrections; optional recommended_next_aim is advisory only and is not executed as hardware motion.";
}

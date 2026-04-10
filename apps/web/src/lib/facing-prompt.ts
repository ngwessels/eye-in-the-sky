import type { CaptureViewDoc } from "./types";

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

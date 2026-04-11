import { generateObject } from "ai";
import { createGateway } from "@ai-sdk/gateway";
import { normalizeAzimuthDeg, sunCalibrationOutputSchema } from "@eye/shared";
import { getEnv } from "./env";

export type SunCalibrationContext = {
  capturedAtIso: string;
  latDeg: number;
  lonDeg: number;
  mount_pan_deg: number;
  mount_tilt_deg: number;
  sun_azimuth_true_deg: number;
  sun_elevation_deg: number;
};

function buildPrompt(ctx: SunCalibrationContext): string {
  return `Outdoor pan-tilt weather camera calibration frame.

Facts (use as ground truth for sun position in the sky):
- Capture time (UTC): ${ctx.capturedAtIso}
- Observer WGS84: ${ctx.latDeg.toFixed(6)}°N lat, ${ctx.lonDeg.toFixed(6)}°E lon (negative lon = west)
- Sun azimuth (true north, clockwise 0–360°): ${ctx.sun_azimuth_true_deg.toFixed(2)}°
- Sun elevation above horizon: ${ctx.sun_elevation_deg.toFixed(2)}°
- Mount reported pan: ${ctx.mount_pan_deg.toFixed(2)}° (logical pan; 0 = home in mount frame)
- Mount reported tilt: ${ctx.mount_tilt_deg.toFixed(2)}° (elevation-style angle from mount)

Task:
1. Determine if the sun is clearly visible in the image (disk or strong glare through clouds counts as visible if position is inferable).
2. Estimate the horizontal direction the camera center is pointing: **boresight_true_azimuth_deg**, clockwise from true north, 0–360 (same convention as sun azimuth). Use the sun's apparent position in the frame vs the ephemeris above. If the sun is not visible or position is ambiguous, set sun_visible false and confidence low.
3. Return confidence 0–1. Be conservative in haze or heavy cloud.

Do not identify people. Focus on sky geometry.`;
}

export async function runSunCalibrationAnalysis(
  imageUrl: string,
  ctx: SunCalibrationContext,
): Promise<{
  output: import("@eye/shared").SunCalibrationOutput;
  model: string;
}> {
  const env = getEnv();
  const apiKey = env.AI_GATEWAY_API_KEY;
  if (!apiKey) {
    throw new Error("AI_GATEWAY_API_KEY not configured");
  }
  const model = env.AI_VISION_MODEL;
  const gateway = createGateway({ apiKey });
  const userText = buildPrompt(ctx);

  const { object } = await generateObject({
    model: gateway(model),
    schema: sunCalibrationOutputSchema,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: userText },
          { type: "image", image: new URL(imageUrl) },
        ],
      },
    ],
  });

  return { output: object, model };
}

/** north_offset such that true_azimuth = normalizeAzimuthDeg(mount_pan + north_offset) — here mount pan is in same clockwise-from-north space. */
export function northOffsetFromBoresightAndMountPan(
  boresightTrueAzimuthDeg: number,
  mountPanDeg: number,
): number {
  const panN = normalizeAzimuthDeg(mountPanDeg);
  const boreN = normalizeAzimuthDeg(boresightTrueAzimuthDeg);
  return normalizeAzimuthDeg(boreN - panN);
}

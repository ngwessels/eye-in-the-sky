import { generateObject } from "ai";
import { createGateway } from "@ai-sdk/gateway";
import { surfaceAnalysisOutputSchema } from "@eye/shared";
import { getEnv } from "./env";
import { formatFacingContext, formatPanTiltLimitsForPrompt } from "./facing-prompt";
import type { CaptureViewDoc, StationDoc } from "./types";

const SURFACE_PROMPT = `You assess ground and near-ground surfaces visible in the image for weather-related cues.
Judge: dry vs damp vs wet soil or pavement, standing water, snow, ice, glare or washout that hides detail.
precipitation_at_surface_likelihood is how likely liquid or frozen precip is reaching the surface now (0–1). Be conservative; use moisture_evidence "ambiguous" when uncertain.
If the view is mostly sky or no surface is visible, set surface_visible false, moisture_evidence "ambiguous", and low confidence.
When a sky or higher-elevation view would better monitor storms, set recommended_next_aim with absoluteAzimuthDeg matching the current boresight when possible and absoluteElevationDeg in a typical sky range (e.g. 15–45° above horizon), with rationale and confidence. Prefer absolute aim when suggesting a large tilt change.`;

export async function runGroundSurfaceAnalysis(
  imageUrl: string,
  opts?: { modelId?: string; view?: CaptureViewDoc; station?: StationDoc },
): Promise<{ output: import("@eye/shared").SurfaceAnalysisOutput; model: string }> {
  const env = getEnv();
  const model = opts?.modelId ?? env.AI_VISION_MODEL;
  const facing = formatFacingContext(opts?.view);
  const limits = formatPanTiltLimitsForPrompt(opts?.station);
  const userText = `${facing}\n${limits}\n\n${SURFACE_PROMPT}`;
  const apiKey = env.AI_GATEWAY_API_KEY;
  if (!apiKey) {
    throw new Error("AI_GATEWAY_API_KEY not configured");
  }

  const gateway = createGateway({ apiKey });

  const { object } = await generateObject({
    model: gateway(model),
    schema: surfaceAnalysisOutputSchema,
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

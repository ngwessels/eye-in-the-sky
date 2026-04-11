import { generateObject } from "ai";
import { createGateway } from "@ai-sdk/gateway";
import { analysisOutputSchema } from "@eye/shared";
import { getEnv } from "./env";
import { formatFacingContext, formatPanTiltLimitsForPrompt } from "./facing-prompt";
import type { CaptureViewDoc, StationDoc } from "./types";

const SKY_PROMPT = `You are a meteorological vision assistant. Analyze the sky image for cloud types relevant to severe weather (cumulonimbus, shelf cloud, mammatus, dust walls, precipitation shafts).
Return structured JSON matching the schema. Be conservative with confidence. If suggesting next aim, prefer small pan/tilt deltas for fine adjustments.
When surface conditions would reduce ambiguity (e.g. virga vs reaching rain, unclear precip shafts, snow on ground vs bright cloud, post-frontal clearing), you may set recommended_next_aim using absoluteAzimuthDeg (often keep current boresight) and absoluteElevationDeg near the horizon or slightly negative (within mount limits) to sample pavement, soil, or yard — then the station can recapture.
When the facing context implies a known geographic aim, also set horizon_consistency_score (0–1): how consistent the image is with that horizon/sky geometry (low if heavy occlusion or the view cannot match the stated aim).`;

export async function runSkyImageAnalysis(
  imageUrl: string,
  opts?: { modelId?: string; view?: CaptureViewDoc; station?: StationDoc },
): Promise<{ output: import("@eye/shared").AnalysisOutput; model: string }> {
  const env = getEnv();
  const model = opts?.modelId ?? env.AI_VISION_MODEL;
  const facing = formatFacingContext(opts?.view);
  const limits = formatPanTiltLimitsForPrompt(opts?.station);
  const userText = `${facing}\n${limits}\n\n${SKY_PROMPT}`;
  const apiKey = env.AI_GATEWAY_API_KEY;
  if (!apiKey) {
    throw new Error("AI_GATEWAY_API_KEY not configured");
  }

  const gateway = createGateway({ apiKey });

  const { object } = await generateObject({
    model: gateway(model),
    schema: analysisOutputSchema,
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

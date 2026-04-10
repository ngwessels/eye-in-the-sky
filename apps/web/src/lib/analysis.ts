import { generateObject } from "ai";
import { createGateway } from "@ai-sdk/gateway";
import { analysisOutputSchema } from "@eye/shared";
import { getEnv } from "./env";

const SKY_PROMPT = `You are a meteorological vision assistant. Analyze the sky image for cloud types relevant to severe weather (cumulonimbus, shelf cloud, mammatus, dust walls, precipitation shafts).
Return structured JSON matching the schema. Be conservative with confidence. If suggesting next aim, prefer small pan/tilt deltas.`;

export async function runSkyImageAnalysis(
  imageUrl: string,
  modelId?: string,
): Promise<{ output: import("@eye/shared").AnalysisOutput; model: string }> {
  const env = getEnv();
  const model = modelId ?? env.AI_VISION_MODEL;
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
          { type: "text", text: SKY_PROMPT },
          { type: "image", image: new URL(imageUrl) },
        ],
      },
    ],
  });

  return { output: object, model };
}

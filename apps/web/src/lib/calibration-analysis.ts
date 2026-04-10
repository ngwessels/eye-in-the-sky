import { generateObject } from "ai";
import { createGateway } from "@ai-sdk/gateway";
import { calibrationValidationOutputSchema } from "@eye/shared";
import { getEnv } from "./env";

const PROMPT = `You are validating an outdoor sky calibration frame for a fixed camera weather station.
Assess whether the horizon is plausible, whether sky vs ground proportions make sense, and give a calibration_consistency_score 0-1.
Do not identify people; focus on geometry and sky.`;

export async function runCalibrationFrameValidation(imageUrl: string): Promise<{
  output: import("@eye/shared").CalibrationValidationOutput;
  model: string;
}> {
  const env = getEnv();
  const apiKey = env.AI_GATEWAY_API_KEY;
  if (!apiKey) {
    throw new Error("AI_GATEWAY_API_KEY not configured");
  }
  const model = env.AI_VISION_MODEL;
  const gateway = createGateway({ apiKey });

  const { object } = await generateObject({
    model: gateway(model),
    schema: calibrationValidationOutputSchema,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: PROMPT },
          { type: "image", image: new URL(imageUrl) },
        ],
      },
    ],
  });

  return { output: object, model };
}

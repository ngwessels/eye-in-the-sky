import { generateObject } from "ai";
import { createGateway } from "@ai-sdk/gateway";
import { calibrationProbeOutputSchema } from "@eye/shared";
import { getEnv } from "./env";
import { formatFacingContext } from "./facing-prompt";
import type { CaptureViewDoc } from "./types";

const PROMPT = `You are assessing whether a fixed weather-station camera view is suitable to run a SKY calibration soon.
Judge: is it daytime; is the sky mostly clear or only thin clouds (sun likely usable); is the frame heavily occluded by roof, patio, trees, or foreground; can the sun disc or strong glare be seen or inferred reliably.
Be conservative on confidence. suitable_for_calibration_attempt should be true only when there is substantial open sky and conditions could support sun-based or horizon calibration.`;

export async function runCalibrationProbeAnalysis(
  imageUrl: string,
  opts?: { modelId?: string; view?: CaptureViewDoc },
): Promise<{ output: import("@eye/shared").CalibrationProbeOutput; model: string }> {
  const env = getEnv();
  const apiKey = env.AI_GATEWAY_API_KEY;
  if (!apiKey) {
    throw new Error("AI_GATEWAY_API_KEY not configured");
  }
  const model = opts?.modelId ?? env.AI_VISION_MODEL;
  const gateway = createGateway({ apiKey });
  const facing = formatFacingContext(opts?.view);
  const userText = `${facing}\n\n${PROMPT}`;

  const { object } = await generateObject({
    model: gateway(model),
    schema: calibrationProbeOutputSchema,
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

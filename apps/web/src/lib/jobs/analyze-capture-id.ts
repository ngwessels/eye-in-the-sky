import { v4 as uuidv4 } from "uuid";
import { getDb } from "../mongodb";
import { presignGet } from "../s3";
import { runSkyImageAnalysis } from "../analysis";
import { getEnv } from "../env";
import type { CaptureDoc } from "../types";

/** Background job: vision analysis for one capture (science or calibration). */
export async function analyzeCaptureById(captureId: string): Promise<void> {
  const env = getEnv();
  if (!env.AI_GATEWAY_API_KEY) return;

  const db = await getDb();
  const c = await db.collection<CaptureDoc>("captures").findOne({ captureId });
  if (!c || c.kind !== "science") return;
  if (c.analysis != null) return;

  try {
    const url = await presignGet(c.s3Key);
    const { output, model } = await runSkyImageAnalysis(url, { view: c.view });
    const analysis_id = uuidv4();
    await db.collection<CaptureDoc>("captures").updateOne(
      { captureId },
      {
        $set: {
          analysis: output as unknown as CaptureDoc["analysis"],
          analysis_model: model,
          analyzedAt: new Date(),
          analysis_id,
        },
      },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.collection<CaptureDoc>("captures").updateOne(
      { captureId },
      {
        $set: {
          analysis: {
            phenomena: [],
            confidence: 0,
            parse_error: true,
            error: msg,
          } as unknown as CaptureDoc["analysis"],
          analyzedAt: new Date(),
        },
      },
    );
  }
}

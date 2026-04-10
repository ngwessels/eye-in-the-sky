import { getDb } from "../mongodb";
import { presignGet } from "../s3";
import { runCalibrationFrameValidation } from "../calibration-analysis";
import { getEnv } from "../env";
import type { CaptureDoc } from "../types";

/** Background job: AI consistency check for a calibration upload. */
export async function analyzeCalibrationCaptureById(
  captureId: string,
): Promise<void> {
  const env = getEnv();
  if (!env.AI_GATEWAY_API_KEY) return;

  const db = await getDb();
  const c = await db.collection<CaptureDoc>("captures").findOne({ captureId });
  if (!c || c.kind !== "calibration") return;
  if (c.calibration_analyzedAt) return;

  try {
    const url = await presignGet(c.s3Key);
    const { output, model } = await runCalibrationFrameValidation(url);
    await db.collection<CaptureDoc>("captures").updateOne(
      { captureId },
      {
        $set: {
          calibration_ai: output as Record<string, unknown>,
          calibration_analysis_model: model,
          calibration_analyzedAt: new Date(),
        },
      },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.collection<CaptureDoc>("captures").updateOne(
      { captureId },
      {
        $set: {
          calibration_ai: { error: msg, horizon_plausible: false, calibration_consistency_score: 0 },
          calibration_analyzedAt: new Date(),
        },
      },
    );
  }
}

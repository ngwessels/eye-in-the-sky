import { getDb } from "../mongodb";
import type { CaptureDoc } from "../types";
import { presignGet } from "../s3";
import { runSkyImageAnalysis } from "../analysis";
import { getEnv } from "../env";

export async function processPendingCaptures(): Promise<number> {
  const env = getEnv();
  if (!env.AI_GATEWAY_API_KEY) return 0;

  const db = await getDb();
  const list = await db
    .collection<CaptureDoc>("captures")
    .find({
      kind: "science",
      $or: [{ analysis: null }, { analysis: { $exists: false } }],
    })
    .limit(5)
    .toArray();

  let n = 0;
  for (const c of list) {
    try {
      const url = await presignGet(c.s3Key);
      const { output, model } = await runSkyImageAnalysis(url);
      await db.collection<CaptureDoc>("captures").updateOne(
        { captureId: c.captureId },
        {
          $set: {
            analysis: output as unknown as CaptureDoc["analysis"],
            analysis_model: model,
            analyzedAt: new Date(),
          },
        },
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await db.collection<CaptureDoc>("captures").updateOne(
        { captureId: c.captureId },
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
    n += 1;
  }
  return n;
}

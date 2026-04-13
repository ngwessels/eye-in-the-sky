import { getDb } from "./mongodb";
import type { CaptureDoc } from "./types";

/**
 * Analysis may still emit recommended_next_aim; stations are fixed-mount (no pan/tilt),
 * so we never enqueue slew commands — only mark processed.
 */
export async function runClosedLoopTick(): Promise<{ enqueued: number }> {
  const db = await getDb();
  const list = await db
    .collection<CaptureDoc>("captures")
    .find({
      kind: "science",
      analysis: { $ne: null },
      closed_loop_applied: { $ne: true },
      "analysis.parse_error": { $ne: true },
    })
    .limit(25)
    .toArray();

  for (const c of list) {
    const analysis = c.analysis as Record<string, unknown> | undefined;
    if (!analysis || typeof analysis !== "object") continue;
    const rec = analysis.recommended_next_aim as { confidence?: number } | undefined;
    if (!rec || typeof rec.confidence !== "number" || rec.confidence < 0.62) {
      await db.collection("captures").updateOne(
        { captureId: c.captureId },
        { $set: { closed_loop_applied: true } },
      );
      continue;
    }

    await db.collection("captures").updateOne(
      { captureId: c.captureId },
      { $set: { closed_loop_applied: true } },
    );
  }

  return { enqueued: 0 };
}

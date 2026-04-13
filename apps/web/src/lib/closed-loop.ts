import { getDb } from "./mongodb";
import { getEnv } from "./env";
import type { CaptureDoc, StationDoc } from "./types";
import { enqueueCommand } from "./commands";

export async function runClosedLoopTick(): Promise<{ enqueued: number }> {
  const db = await getDb();
  const env = getEnv();
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

  let enqueued = 0;

  for (const c of list) {
    const analysis = c.analysis as Record<string, unknown> | undefined;
    if (!analysis || typeof analysis !== "object") continue;
    const rec = analysis.recommended_next_aim as
      | {
          confidence: number;
          deltaPanDeg?: number;
          deltaTiltDeg?: number;
          absoluteAzimuthDeg?: number;
          absoluteElevationDeg?: number;
        }
      | undefined;
    if (!rec || typeof rec.confidence !== "number" || rec.confidence < 0.62) {
      await db.collection("captures").updateOne(
        { captureId: c.captureId },
        { $set: { closed_loop_applied: true } },
      );
      continue;
    }

    const depth = c.followups_enqueued ?? 0;
    if (depth >= env.MAX_FOLLOWUPS_PER_TRACE) {
      await db.collection("captures").updateOne(
        { captureId: c.captureId },
        { $set: { closed_loop_applied: true } },
      );
      continue;
    }

    const station = await db
      .collection<StationDoc>("stations")
      .findOne({ stationId: c.stationId });
    if (station?.capabilities?.omni_quad) {
      await db.collection("captures").updateOne(
        { captureId: c.captureId },
        { $set: { closed_loop_applied: true } },
      );
      continue;
    }

    const trace = c.trace_id ?? c.captureId;

    if (rec.deltaPanDeg != null || rec.deltaTiltDeg != null) {
      await enqueueCommand({
        stationId: c.stationId,
        type: "aim_delta",
        payload: {
          deltaPanDeg: rec.deltaPanDeg ?? 0,
          deltaTiltDeg: rec.deltaTiltDeg ?? 0,
        },
        trace_id: trace,
        parent_command_id: c.command_id,
        followup_depth: depth + 1,
        selection_reason: "closed_loop_analysis_delta",
      });
      enqueued += 1;
    } else if (
      rec.absoluteAzimuthDeg != null &&
      rec.absoluteElevationDeg != null
    ) {
      await enqueueCommand({
        stationId: c.stationId,
        type: "aim_absolute",
        payload: {
          azimuthDeg: rec.absoluteAzimuthDeg,
          elevationDeg: rec.absoluteElevationDeg,
        },
        trace_id: trace,
        parent_command_id: c.command_id,
        followup_depth: depth + 1,
        selection_reason: "closed_loop_analysis_absolute",
      });
      enqueued += 1;
    }

    await enqueueCommand({
      stationId: c.stationId,
      type: "capture_now",
      payload: {},
      trace_id: trace,
      parent_command_id: c.command_id,
      followup_depth: depth + 1,
      selection_reason: "closed_loop_recapture",
    });
    enqueued += 1;

    await db.collection("captures").updateOne(
      { captureId: c.captureId },
      {
        $set: {
          closed_loop_applied: true,
          followups_enqueued: depth + 1,
        },
      },
    );
  }

  return { enqueued };
}

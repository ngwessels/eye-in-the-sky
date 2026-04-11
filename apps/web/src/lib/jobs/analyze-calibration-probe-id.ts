import { getDb } from "../mongodb";
import { presignGet } from "../s3";
import { runCalibrationProbeAnalysis } from "../calibration-probe-analysis";
import { getEnv } from "../env";
import { enqueueCommand } from "../commands";
import type { CaptureDoc, CommandDoc, StationDoc } from "../types";

async function recentRunCalibrationSince(
  stationId: string,
  since: Date,
): Promise<boolean> {
  const db = await getDb();
  const hit = await db.collection<CommandDoc>("commands").findOne({
    stationId,
    type: "run_calibration",
    createdAt: { $gte: since },
  });
  return hit != null;
}

async function pendingRunCalibration(stationId: string): Promise<boolean> {
  const db = await getDb();
  const hit = await db.collection<CommandDoc>("commands").findOne({
    stationId,
    type: "run_calibration",
    state: "pending",
  });
  return hit != null;
}

/** Vision follow-up for `calibration_probe` captures: update station and maybe enqueue full calibration. */
export async function analyzeCalibrationProbeById(captureId: string): Promise<void> {
  const env = getEnv();
  if (!env.AI_GATEWAY_API_KEY) return;

  const db = await getDb();
  const c = await db.collection<CaptureDoc>("captures").findOne({ captureId });
  if (!c || c.kind !== "calibration_probe") return;
  if (c.analysis != null) return;

  const station = await db.collection<StationDoc>("stations").findOne({
    stationId: c.stationId,
  });
  if (!station) return;

  try {
    const url = await presignGet(c.s3Key);
    const { output, model } = await runCalibrationProbeAnalysis(url, { view: c.view });
    const now = new Date();

    await db.collection<CaptureDoc>("captures").updateOne(
      { captureId },
      {
        $set: {
          analysis: output as unknown as CaptureDoc["analysis"],
          analysis_model: model,
          analyzedAt: now,
        },
      },
    );

    await db.collection<StationDoc>("stations").updateOne(
      { stationId: c.stationId },
      {
        $set: {
          calibration_opportunity: {
            last_probe_at: now,
            last_probe_analysis: output as unknown as Record<string, unknown>,
            last_probe_capture_id: captureId,
            last_probe_model: model,
          },
        },
      },
    );

    const runSince = new Date(now.getTime() - env.CALIBRATION_RUN_MIN_INTERVAL_MS);
    const gate = env.CALIBRATION_PROBE_CONFIDENCE_GATE;
    const ok =
      output.suitable_for_calibration_attempt &&
      output.confidence >= gate &&
      output.is_daytime &&
      !output.heavy_occlusion &&
      output.mostly_clear;

    if (!ok) return;
    if (await pendingRunCalibration(c.stationId)) return;
    if (await recentRunCalibrationSince(c.stationId, runSince)) return;

    await enqueueCommand({
      stationId: c.stationId,
      type: "run_calibration",
      payload: {},
      trace_id: c.trace_id,
      selection_reason: `probe_window_open:confidence=${output.confidence.toFixed(2)}`,
    });

    await db.collection<StationDoc>("stations").updateOne(
      { stationId: c.stationId },
      {
        $set: {
          "calibration.orchestrator": {
            last_evaluation_at: now,
            last_reasons: ["probe_window_open"],
            last_action: "run_calibration_enqueued",
          },
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
            parse_error: true,
            error: msg,
          } as unknown as CaptureDoc["analysis"],
          analyzedAt: new Date(),
        },
      },
    );
  }
}

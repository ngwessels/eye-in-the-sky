import { v4 as uuidv4 } from "uuid";
import { getDb } from "./mongodb";
import type { CaptureDoc, CommandDoc, StationDoc } from "./types";
import { enqueueCommand } from "./commands";
import { getEnv } from "./env";
import { buildSkyProbeAim, scoreRecalibrationNeed } from "./calibration-need";

async function stationHasLowHorizonConsistency(
  stationId: string,
): Promise<boolean> {
  const env = getEnv();
  const need = env.CALIBRATION_HORIZON_LOW_MIN_CAPTURES;
  const db = await getDb();
  const caps = await db
    .collection<CaptureDoc>("captures")
    .find({
      stationId,
      kind: "science",
      analyzedAt: { $exists: true },
      "analysis.horizon_consistency_score": { $exists: true },
      "analysis.parse_error": { $ne: true },
    })
    .sort({ analyzedAt: -1 })
    .limit(need)
    .toArray();

  if (caps.length < need) return false;

  let low = 0;
  for (const x of caps) {
    const s = (x.analysis as { horizon_consistency_score?: number } | null)
      ?.horizon_consistency_score;
    if (typeof s === "number" && s < env.CALIBRATION_HORIZON_LOW_THRESHOLD) {
      low += 1;
    }
  }
  return low >= env.CALIBRATION_HORIZON_LOW_MIN_COUNT;
}

async function hasBlockingPendingCommand(
  stationId: string,
): Promise<boolean> {
  const db = await getDb();
  const hit = await db.collection<CommandDoc>("commands").findOne({
    stationId,
    state: "pending",
    type: { $in: ["calibration_sky_probe", "run_calibration"] },
  });
  return hit != null;
}

async function recentCommandSince(
  stationId: string,
  cmdType: CommandDoc["type"],
  since: Date,
): Promise<boolean> {
  const db = await getDb();
  const hit = await db.collection<CommandDoc>("commands").findOne({
    stationId,
    type: cmdType,
    createdAt: { $gte: since },
  });
  return hit != null;
}

/**
 * Enqueue sky probes for stations that need opportunistic recalibration, when the sun is up
 * and throttles allow. Full `run_calibration` is enqueued from probe vision analysis, not here.
 */
export async function runCalibrationOrchestratorTick(): Promise<{
  enqueued_probes: number;
  stations_evaluated: number;
}> {
  const env = getEnv();
  const db = await getDb();
  const now = new Date();

  const stations = await db
    .collection<StationDoc>("stations")
    .find({
      "location.lat": { $exists: true },
      "location.lon": { $exists: true },
      "gps.degraded": false,
      "calibration.state": { $ne: "pending" },
    })
    .limit(env.CALIBRATION_ORCHESTRATOR_MAX_STATIONS_PER_TICK)
    .toArray();

  let enqueued_probes = 0;
  let stations_evaluated = 0;

  const probeSince = new Date(now.getTime() - env.CALIBRATION_PROBE_MIN_INTERVAL_MS);

  for (const s of stations) {
    if (!s.location) continue;
    stations_evaluated += 1;

    const lowHorizon = await stationHasLowHorizonConsistency(s.stationId);
    const { needed, reasons } = scoreRecalibrationNeed(s, {
      confidenceThreshold: env.CALIBRATION_CONFIDENCE_NEED_THRESHOLD,
      lowHorizonFromCaptures: lowHorizon,
    });
    if (!needed) continue;

    const aim = buildSkyProbeAim(s, now, {
      sunElevMinDeg: env.CALIBRATION_PROBE_SUN_ELEVATION_MIN,
      targetElMin: 40,
      targetElMax: 55,
    });
    if (!aim) continue;

    if (await hasBlockingPendingCommand(s.stationId)) continue;

    const lastProbeAt = s.calibration_opportunity?.last_probe_at;
    if (lastProbeAt && lastProbeAt >= probeSince) continue;

    if (await recentCommandSince(s.stationId, "calibration_sky_probe", probeSince)) {
      continue;
    }

    const trace_id = uuidv4();
    const selection_reason = `orchestrator_sky_probe:${reasons.join(",")}`;

    await enqueueCommand({
      stationId: s.stationId,
      type: "calibration_sky_probe",
      payload: {
        azimuthDeg: aim.azimuthDeg,
        elevationDeg: aim.elevationDeg,
      },
      trace_id,
      selection_reason,
    });

    const nextOrch = {
      last_evaluation_at: now,
      last_reasons: reasons,
      last_action: "sky_probe_enqueued",
    };

    await db.collection<StationDoc>("stations").updateOne(
      { stationId: s.stationId },
      {
        $set: {
          "calibration.orchestrator": nextOrch,
        },
      },
    );

    enqueued_probes += 1;
  }

  return { enqueued_probes, stations_evaluated };
}

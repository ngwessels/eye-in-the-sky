import { v4 as uuidv4 } from "uuid";
import { getDb } from "./mongodb";
import { getEnv } from "./env";
import type { CaptureDoc, StationDoc } from "./types";
import { enqueueCommand } from "./commands";
import { stationEligibleForGeometry } from "./gps-policy";

const GROUND_CRON_REASON_PREFIX = "ground_observation_cron";

/** Latest science capture azimuth for ground sampling; null if none recent enough. */
export function azimuthFromLatestScienceCapture(
  capture: Pick<CaptureDoc, "kind" | "capturedAt" | "view"> | null,
  maxAgeMs: number,
  nowMs: number,
): number | null {
  if (!capture || capture.kind !== "science") return null;
  const az = capture.view?.azimuth_true_deg;
  if (az == null || !Number.isFinite(az)) return null;
  const t = capture.capturedAt?.getTime?.() ?? 0;
  if (!t || nowMs - t > maxAgeMs) return null;
  return az;
}

export async function runGroundObservationTick(): Promise<{ enqueued: number }> {
  const env = getEnv();
  const db = await getDb();
  const stations = await db.collection<StationDoc>("stations").find({}).toArray();

  let enqueued = 0;
  let stationsScheduled = 0;
  const maxStations = env.GROUND_CRON_MAX_STATIONS_PER_TICK;
  const maxAge = env.GROUND_CRON_BEARING_MAX_AGE_MS;
  const now = Date.now();

  for (const station of stations) {
    if (stationsScheduled >= maxStations) break;
    if (!stationEligibleForGeometry(station)) continue;

    const throttle = await db.collection("commands").findOne({
      stationId: station.stationId,
      selection_reason: { $regex: `^${GROUND_CRON_REASON_PREFIX}` },
      createdAt: { $gt: new Date(now - env.GROUND_CRON_MIN_INTERVAL_MS) },
    });
    if (throttle) continue;

    const latest = await db
      .collection<CaptureDoc>("captures")
      .findOne(
        { stationId: station.stationId, kind: "science" },
        { sort: { capturedAt: -1 } },
      );

    const azimuthDeg = azimuthFromLatestScienceCapture(latest, maxAge, now);
    if (azimuthDeg == null) continue;

    const trace_id = uuidv4();
    const elevationDeg = env.GROUND_CRON_ELEVATION_DEG;

    if (!station.capabilities?.omni_quad) {
      await enqueueCommand({
        stationId: station.stationId,
        type: "aim_absolute",
        payload: { azimuthDeg, elevationDeg },
        trace_id,
        selection_reason: `${GROUND_CRON_REASON_PREFIX} aim elev=${elevationDeg}`,
      });
      enqueued += 1;
    }

    await enqueueCommand({
      stationId: station.stationId,
      type: "capture_now",
      payload: {},
      trace_id,
      selection_reason: station.capabilities?.omni_quad
        ? `${GROUND_CRON_REASON_PREFIX} omni_quad capture`
        : `${GROUND_CRON_REASON_PREFIX} capture`,
    });
    enqueued += 1;
    stationsScheduled += 1;
  }

  return { enqueued };
}

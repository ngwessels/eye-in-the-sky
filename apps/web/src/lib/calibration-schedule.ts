import { getDb } from "./mongodb";
import type { StationDoc } from "./types";
import { enqueueCommand } from "./commands";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Enqueue `run_calibration` for stations that have not received one in the last 24h. */
export async function runCalibrationScheduleTick(): Promise<{ enqueued: number }> {
  const db = await getDb();
  const since = new Date(Date.now() - DAY_MS);
  const stations = await db
    .collection<StationDoc>("stations")
    .find({
      "location.lat": { $exists: true },
      "location.lon": { $exists: true },
      "gps.degraded": false,
    })
    .toArray();

  let enqueued = 0;

  for (const s of stations) {
    if (!s.location) continue;

    const recent = await db.collection("commands").findOne({
      stationId: s.stationId,
      type: "run_calibration",
      createdAt: { $gte: since },
    });
    if (recent) continue;

    await enqueueCommand({
      stationId: s.stationId,
      type: "run_calibration",
      payload: {},
      selection_reason: "daily_cron",
    });
    enqueued += 1;
  }

  return { enqueued };
}

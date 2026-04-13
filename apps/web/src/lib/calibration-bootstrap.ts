import type { Db } from "mongodb";
import { enqueueCommand } from "./commands";

/**
 * First time the station has a non-degraded GPS fix and lat/lon, enqueue one calibration.
 * Uses atomic update so concurrent telemetry posts only enqueue once.
 */
export async function maybeEnqueueBootstrapCalibration(
  db: Db,
  stationId: string,
): Promise<void> {
  const r = await db.collection("stations").updateOne(
    {
      stationId,
      "location.lat": { $exists: true },
      "location.lon": { $exists: true },
      "gps.degraded": false,
      $or: [
        { "calibration.bootstrap_calibration_enqueued": { $exists: false } },
        { "calibration.bootstrap_calibration_enqueued": false },
      ],
    },
    { $set: { "calibration.bootstrap_calibration_enqueued": true } },
  );

  if (r.modifiedCount !== 1) {
    return;
  }

  try {
    await enqueueCommand({
      stationId,
      type: "run_calibration",
      payload: {},
      selection_reason: "first_gps_location",
    });
  } catch (err) {
    await db.collection("stations").updateOne(
      { stationId },
      { $set: { "calibration.bootstrap_calibration_enqueued": false } },
    );
    throw err;
  }
}

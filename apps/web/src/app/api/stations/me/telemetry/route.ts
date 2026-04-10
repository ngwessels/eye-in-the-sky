import { NextResponse } from "next/server";
import { telemetryBodySchema } from "@eye/shared";
import { getStationFromAuth } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { assertRateLimit, RateLimitError } from "@/lib/rate-limit";
import { getEnv } from "@/lib/env";
import { applyGpsSnapshotToStation } from "@/lib/gps-policy";
import { validateTelemetryReadings } from "@/lib/telemetry-validate";
import { recomputeQualityTier } from "@/lib/tier";
import type { StationDoc } from "@/lib/types";

const MAX_ANOMALY_FLAGS = 24;

export async function POST(request: Request) {
  const station = await getStationFromAuth(request);
  if (!station) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const env = getEnv();
  try {
    await assertRateLimit(
      station.stationId,
      "/telemetry",
      env.RATE_TELEMETRY_PER_MIN,
    );
  } catch (e) {
    if (e instanceof RateLimitError) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    }
    throw e;
  }

  const json = await request.json();
  const parsed = telemetryBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const validation = validateTelemetryReadings(parsed.data.readings);
  const readings = validation.filteredReadings;

  const db = await getDb();
  const now = new Date();

  const update: Record<string, unknown> = {
    lastSeenAt: now,
  };

  if (parsed.data.time_quality) {
    update.time_quality = {
      synced: parsed.data.time_quality.synced,
      offset_ms_estimate: parsed.data.time_quality.offset_ms_estimate,
      last_ntp_sync: parsed.data.time_quality.last_ntp_sync
        ? new Date(parsed.data.time_quality.last_ntp_sync)
        : undefined,
    };
  }

  if (parsed.data.gps) {
    const gpsPatch = applyGpsSnapshotToStation(station, parsed.data.gps);
    Object.assign(update, gpsPatch);
  }

  const sensorTypes = new Set(station.capabilities?.sensors ?? []);
  for (const r of readings) {
    sensorTypes.add(r.type);
  }
  update["capabilities.sensors"] = [...sensorTypes];

  let anomalyFlags = [...(station.sensor_anomaly_flags ?? [])];
  if (validation.anomalies.length > 0) {
    anomalyFlags = [...anomalyFlags, ...validation.anomalies].slice(
      -MAX_ANOMALY_FLAGS,
    );
    update.sensor_anomaly_flags = anomalyFlags;
  }

  await db.collection<StationDoc>("stations").updateOne(
    { stationId: station.stationId },
    { $set: update },
  );

  const fresh = await db.collection<StationDoc>("stations").findOne({
    stationId: station.stationId,
  });
  if (fresh) {
    const tier = recomputeQualityTier(fresh);
    await db.collection<StationDoc>("stations").updateOne(
      { stationId: station.stationId },
      {
        $set: {
          quality_tier: tier.quality_tier,
          tier_reasons: tier.tier_reasons,
        },
      },
    );
  }

  if (readings.length > 0) {
    await db.collection("sensor_readings").insertOne({
      stationId: station.stationId,
      readings,
      createdAt: now,
    });
  }

  return NextResponse.json({
    ok: true,
    dropped_readings: parsed.data.readings.length - readings.length,
    anomalies: validation.anomalies,
  });
}

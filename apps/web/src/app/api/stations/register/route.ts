import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getEnv } from "@/lib/env";
import { getDb, createIndexes } from "@/lib/mongodb";
import { generateApiKey, fingerprintApiKey } from "@/lib/api-key";
import type { StationDoc } from "@/lib/types";

export async function POST(request: Request) {
  const admin = request.headers.get("x-admin-secret");
  if (!admin || admin !== getEnv().ADMIN_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    await createIndexes();
  } catch {
    /* indexes may already exist */
  }

  let body: { name?: string; omni_quad?: boolean } = {};
  try {
    body = (await request.json()) as { name?: string; omni_quad?: boolean };
  } catch {
    /* empty body */
  }

  const rawKey = generateApiKey();
  const stationId = uuidv4();
  const now = new Date();

  const doc: StationDoc = {
    stationId,
    name: body.name?.trim() || "Station",
    apiKeyFingerprint: fingerprintApiKey(rawKey),
    createdAt: now,
    lastSeenAt: now,
    location_source: "gps",
    gps: {
      fix_type: "none",
      degraded: true,
      last_fix_at: undefined,
      sat_count: 0,
      hdop: 99,
    },
    capabilities: {
      sensors: [],
      panTilt: { panMin: -180, panMax: 180, tiltMin: -10, tiltMax: 90 },
      ...(body.omni_quad === true ? { omni_quad: true } : {}),
    },
    calibration: {
      state: "pending",
      confidence: 0,
      method: [],
    },
    quality_tier: "gps_degraded",
    tier_reasons: ["awaiting_gps_calibration"],
    health: { uploadSuccessEma: 1 },
    sequence: 0,
    sensor_anomaly_flags: [],
  };

  const db = await getDb();
  await db.collection<StationDoc>("stations").insertOne(doc);

  return NextResponse.json({
    stationId,
    apiKey: rawKey,
    message: "Store apiKey securely; it is shown once.",
  });
}
